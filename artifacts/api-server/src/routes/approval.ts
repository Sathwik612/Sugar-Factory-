import { GetApprovalQueueResponse, ReviewDailyRecordBody } from "@workspace/api-zod";
import { and, eq, inArray } from "drizzle-orm";
import { approvalTasks, db, dailyOperations, usersTable } from "@workspace/db";
import { Router, type IRouter } from "express";

import { recordAudit } from "../lib/audit";
import { requireRoles } from "../lib/authz";
import { APPROVAL_STATUS, notifySubmissionDecision } from "../lib/approvals";
import { getDemoFactoryId } from "../lib/demoData";

const router: IRouter = Router();

router.get("/approval-queue", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: dailyOperations.id,
        productionDate: dailyOperations.productionDate,
        shift: dailyOperations.shift,
        status: dailyOperations.status,
        submittedBy: dailyOperations.submittedBy,
        submittedAt: dailyOperations.submittedAt,
        priority: dailyOperations.priority,
        reviewerRole: dailyOperations.reviewerRole,
        username: usersTable.username,
        department: usersTable.department,
      })
      .from(dailyOperations)
      .leftJoin(usersTable, eq(dailyOperations.submittedBy, usersTable.id))
      .where(
        and(
          inArray(dailyOperations.status, ["SUBMITTED", "UNDER_REVIEW"]),
          req.user!.role === "ADMIN"
            ? inArray(dailyOperations.reviewerRole, ["MANAGER", "ADMIN"])
            : eq(dailyOperations.reviewerRole, req.user!.role),
        ),
      );

    const parsed = GetApprovalQueueResponse.parse(
      rows.map((row) => ({
          id: row.id,
          productionDate: row.productionDate,
          shift: row.shift,
          status: row.status,
          submittedBy: row.username ?? row.submittedBy ?? "Unknown operator",
          submittedAt: row.submittedAt ?? new Date(0),
          department: row.department ?? "UNKNOWN",
      })),
    );
    res.json(parsed.map((item, index) => ({
      ...item,
      priority: rows[index]?.priority ?? "NORMAL",
      reviewerRole: rows[index]?.reviewerRole ?? "MANAGER",
    })));
  } catch (error) {
    next(error);
  }
});

router.get("/approval-summary", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    const tasks = await db.select().from(approvalTasks).where(eq(approvalTasks.factoryId, factoryId!));
    const today = new Date().toISOString().slice(0, 10);
    res.json({
      pending: tasks.filter((task) => task.status === APPROVAL_STATUS.PENDING).length,
      highPriority: tasks.filter((task) => [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.IN_REVIEW].includes(task.status as typeof APPROVAL_STATUS.PENDING | typeof APPROVAL_STATUS.IN_REVIEW) && task.priority === "HIGH").length,
      returned: tasks.filter((task) => task.status === APPROVAL_STATUS.RETURNED).length,
      approvedToday: tasks.filter((task) => task.status === APPROVAL_STATUS.APPROVED && task.reviewedAt?.toISOString().slice(0, 10) === today).length,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/approval-queue/:recordId", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const body = ReviewDailyRecordBody.parse(req.body);
    const factoryId = await getDemoFactoryId();
    const [record] = await db
      .select()
      .from(dailyOperations)
      .where(and(eq(dailyOperations.id, String(req.params.recordId)), eq(dailyOperations.factoryId, factoryId!)))
      .limit(1);
    if (!record) {
      res.status(404).json({ error: "Daily record not found." });
      return;
    }
    if (!["SUBMITTED", "UNDER_REVIEW"].includes(record.status)) {
      res.status(409).json({ error: "Only submitted records can be reviewed." });
      return;
    }
    if (record.submittedBy === req.user!.id) {
      res.status(403).json({ error: "A submitter cannot approve or return their own record." });
      return;
    }
    if (req.user!.role !== "ADMIN" && record.reviewerRole && record.reviewerRole !== req.user!.role) {
      res.status(403).json({ error: "This record is assigned to a different reviewer role." });
      return;
    }
    if (body.action === "REJECT" && !body.comments?.trim()) {
      res.status(400).json({ error: "A return reason is required." });
      return;
    }

    const nextStatus =
      body.action === "APPROVE"
        ? "APPROVED"
        : body.action === "START_REVIEW"
          ? "UNDER_REVIEW"
          : "RETURNED";
    const now = new Date();
    const decision = body.action === "APPROVE" ? "APPROVED" : body.action === "REJECT" ? "RETURNED" : null;
    const [updated] = await db
      .update(dailyOperations)
      .set({
        status: nextStatus,
        reviewedBy: req.user!.id,
        reviewedAt: now,
        decision,
        returnReason: body.action === "REJECT" ? body.comments!.trim() : null,
        updatedAt: now,
      })
      .where(eq(dailyOperations.id, record.id))
      .returning();
    const [task] = await db.select().from(approvalTasks).where(eq(approvalTasks.relatedRecordId, record.id)).limit(1);
    if (task) {
      await db
        .update(approvalTasks)
        .set({
          status: body.action === "APPROVE"
            ? APPROVAL_STATUS.APPROVED
            : body.action === "START_REVIEW"
              ? APPROVAL_STATUS.IN_REVIEW
              : APPROVAL_STATUS.RETURNED,
          reviewedAt: now,
          reviewedBy: req.user!.id,
          decision,
          returnReason: body.action === "REJECT" ? body.comments!.trim() : null,
          updatedAt: now,
        })
        .where(eq(approvalTasks.id, task.id));
    }

    await recordAudit(
      req,
      body.action === "APPROVE"
        ? "APPROVED_DAILY_RECORD"
        : body.action === "START_REVIEW"
          ? "STARTED_DAILY_RECORD_REVIEW"
          : "RETURNED_DAILY_RECORD",
      "daily_operations",
      record.id,
      { productionDate: record.productionDate, comments: body.comments ?? null },
    );
    if (body.action === "APPROVE" || body.action === "REJECT") {
      await notifySubmissionDecision(
        req,
        record,
        body.action === "APPROVE" ? "APPROVED" : "RETURNED",
        body.comments,
      );
    }
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
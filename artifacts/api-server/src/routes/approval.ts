import { GetApprovalQueueResponse, ReviewDailyRecordBody } from "@workspace/api-zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, dailyOperations, usersTable } from "@workspace/db";
import { Router, type IRouter } from "express";

import { recordAudit } from "../lib/audit";
import { requireRoles } from "../lib/authz";

const router: IRouter = Router();

router.get("/approval-queue", requireRoles("MANAGER", "ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: dailyOperations.id,
        productionDate: dailyOperations.productionDate,
        shift: dailyOperations.shift,
        status: dailyOperations.status,
        submittedBy: dailyOperations.submittedBy,
        submittedAt: dailyOperations.submittedAt,
        username: usersTable.username,
        department: usersTable.department,
      })
      .from(dailyOperations)
      .leftJoin(usersTable, eq(dailyOperations.submittedBy, usersTable.id))
      .where(inArray(dailyOperations.status, ["SUBMITTED", "UNDER_REVIEW"]));

    res.json(
      GetApprovalQueueResponse.parse(
        rows.map((row) => ({
          id: row.id,
          productionDate: row.productionDate,
          shift: row.shift,
          status: row.status,
          submittedBy: row.username ?? row.submittedBy ?? "Unknown operator",
          submittedAt: row.submittedAt ?? new Date(0),
          department: row.department ?? "UNKNOWN",
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/approval-queue/:recordId", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const body = ReviewDailyRecordBody.parse(req.body);
    const [record] = await db
      .select()
      .from(dailyOperations)
      .where(eq(dailyOperations.id, String(req.params.recordId)))
      .limit(1);
    if (!record) {
      res.status(404).json({ error: "Daily record not found." });
      return;
    }
    if (!["SUBMITTED", "UNDER_REVIEW"].includes(record.status)) {
      res.status(409).json({ error: "Only submitted records can be reviewed." });
      return;
    }

    const nextStatus =
      body.action === "APPROVE"
        ? "APPROVED"
        : body.action === "START_REVIEW"
          ? "UNDER_REVIEW"
          : "DRAFT";
    const [updated] = await db
      .update(dailyOperations)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(dailyOperations.id, record.id))
      .returning();

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
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
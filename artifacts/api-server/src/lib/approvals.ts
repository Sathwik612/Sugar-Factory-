import { and, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import {
  approvalAssignments,
  approvalTasks,
  dailyOperations,
  db,
  usersTable,
} from "@workspace/db";

import { recordAudit } from "./audit";
import { NOTIFICATION_TYPES, notifyUser, notifyUsers } from "./notifications";

export const APPROVAL_STATUS = {
  PENDING: "PENDING",
  IN_REVIEW: "IN_REVIEW",
  APPROVED: "APPROVED",
  RETURNED: "RETURNED",
} as const;

export async function resolveApprovalAudience(factoryId: string, department: string) {
  const [assignment] = await db
    .select()
    .from(approvalAssignments)
    .where(
      and(
        eq(approvalAssignments.factoryId, factoryId),
        eq(approvalAssignments.department, department),
        eq(approvalAssignments.active, true),
      ),
    )
    .limit(1);
  const reviewerRole = assignment?.reviewerRole ?? (department === "MANAGEMENT" ? "ADMIN" : "MANAGER");
  const reviewers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.role, [reviewerRole]));
  return { reviewerRole, reviewerIds: reviewers.map((reviewer) => reviewer.id) };
}

export async function assignApprovalTask(
  req: Request,
  record: typeof dailyOperations.$inferSelect,
  department: string,
) {
  const { reviewerRole, reviewerIds } = await resolveApprovalAudience(record.factoryId, department);
  const priority = record.priority || "NORMAL";
  const taskValues = {
    factoryId: record.factoryId,
    relatedRecordId: record.id,
    productionDate: record.productionDate,
    department,
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt ?? new Date(),
    reviewerRole,
    reviewerId: reviewerIds[0] ?? null,
    status: APPROVAL_STATUS.PENDING,
    reviewedAt: null,
    reviewedBy: null,
    decision: null,
    returnReason: null,
    priority,
    updatedAt: new Date(),
  };
  const [task] = await db
    .insert(approvalTasks)
    .values(taskValues)
    .onConflictDoUpdate({
      target: approvalTasks.relatedRecordId,
      set: taskValues,
    })
    .returning();
  await db
    .update(dailyOperations)
    .set({
      reviewerRole,
      reviewedBy: null,
      reviewedAt: null,
      decision: null,
      returnReason: null,
    })
    .where(eq(dailyOperations.id, record.id));
  await recordAudit(req, "APPROVAL_ASSIGNED", "approval_task", task.id, {
    relatedRecordId: record.id,
    department,
    reviewerRole,
    reviewerCount: reviewerIds.length,
    priority,
  });
  await notifyUsers(req, reviewerIds, {
    factoryId: record.factoryId,
    type: NOTIFICATION_TYPES.APPROVAL_REQUIRED,
    severity: priority === "HIGH" ? "WARNING" : "INFO",
    title: `${department[0]?.toUpperCase()}${department.slice(1).toLowerCase()} data requires approval`,
    message: `Data for ${record.productionDate}, ${record.shift} shift, has been submitted and is awaiting review.`,
    entityType: "approval_task",
    entityId: task.id,
    actionUrl: `/approval-queue?record=${record.id}`,
    dedupeKey: `approval:${record.id}:submitted:${record.submittedAt?.toISOString() ?? record.updatedAt.toISOString()}`,
  });
  return task;
}

export async function notifySubmissionDecision(
  req: Request,
  record: typeof dailyOperations.$inferSelect,
  decision: "APPROVED" | "RETURNED",
  reason?: string | null,
) {
  const approved = decision === "APPROVED";
  await notifyUser(req, record.submittedBy, {
    factoryId: record.factoryId,
    type: approved ? NOTIFICATION_TYPES.DATA_APPROVED : NOTIFICATION_TYPES.DATA_RETURNED,
    severity: approved ? "INFO" : "WARNING",
    title: approved ? "Daily Operations submission approved" : "Daily Operations submission returned",
    message: approved
      ? `Your ${record.shift} shift submission for ${record.productionDate} was approved.`
      : `Your ${record.shift} shift submission for ${record.productionDate} was returned for correction. Reason: ${reason}`,
    entityType: "daily_operations",
    entityId: record.id,
    actionUrl: `/daily-operations?date=${record.productionDate}&shift=${record.shift}`,
    dedupeKey: `daily-operations:${record.id}:${decision}:${new Date().toISOString()}`,
  });
}
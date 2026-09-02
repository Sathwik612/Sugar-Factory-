import { db, auditLogsTable } from "@workspace/db";
import type { Request } from "express";

export async function recordAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string | null,
  details?: Record<string, unknown>,
) {
  if (!req.user) return;
  await db.insert(auditLogsTable).values({
    userId: req.user.id,
    role: req.user.role,
    department: req.user.department,
    action,
    entityType,
    entityId,
    details: details ?? null,
  });
}
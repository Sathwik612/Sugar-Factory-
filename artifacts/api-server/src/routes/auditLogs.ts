import { ListAuditLogsResponse } from "@workspace/api-zod";
import { desc } from "drizzle-orm";
import { auditLogsTable, db } from "@workspace/db";
import { Router, type IRouter } from "express";

import { requireRoles } from "../lib/authz";

const router: IRouter = Router();

router.get("/audit-logs", requireRoles("MANAGER", "ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(100);
    res.json(
      ListAuditLogsResponse.parse(
        rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          role: row.role,
          department: row.department,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          details: row.details,
          createdAt: row.createdAt,
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, notificationPreferences, notifications } from "@workspace/db";

import { recordAudit } from "../lib/audit";
import { getDemoFactoryId } from "../lib/demoData";
import { getOrCreatePreferences } from "../lib/notifications";
import { requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();

router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId || !req.user) {
      res.status(503).json({ error: "No factory has been configured." });
      return;
    }
    const items = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, req.user.id), eq(notifications.factoryId, factoryId)))
      .orderBy(desc(notifications.createdAt))
      .limit(80);
    const categories = {
      approvals: items.filter((item) => ["APPROVAL_REQUIRED"].includes(item.type) && !item.isRead).length,
      operationalAlerts: items.filter((item) => ["CRITICAL_ALERT", "WARNING_ALERT", "ALERT_ESCALATED"].includes(item.type) && !item.isRead).length,
      dataChanges: items.filter((item) => ["DATA_SUBMITTED", "DATA_RETURNED", "DATA_APPROVED", "DATA_REJECTED"].includes(item.type) && !item.isRead).length,
      actions: items.filter((item) => ["ACTION_ASSIGNED", "ACTION_OVERDUE", "MAINTENANCE_PRIORITY", "QUALITY_HOLD", "STORES_REORDER"].includes(item.type) && !item.isRead).length,
      system: items.filter((item) => item.type === "SYSTEM_NOTIFICATION" && !item.isRead).length,
    };
    res.json({
      items,
      unreadCount: items.filter((item) => !item.isRead).length,
      categories,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/notifications/:id/read", requireAuth, async (req, res, next) => {
  try {
    const [updated] = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.id, String(req.params.id)), eq(notifications.userId, req.user!.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Notification not found." });
      return;
    }
    await recordAudit(req, "NOTIFICATION_READ", "notification", updated.id, { notificationType: updated.type });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/read-all", requireAuth, async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured." });
      return;
    }
    const updated = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.userId, req.user!.id), eq(notifications.factoryId, factoryId), eq(notifications.isRead, false)))
      .returning({ id: notifications.id });
    await recordAudit(req, "NOTIFICATIONS_MARKED_READ", "notification", null, { count: updated.length });
    res.json({ updated: updated.length });
  } catch (error) {
    next(error);
  }
});

router.get("/notification-preferences", requireAuth, async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured." });
      return;
    }
    res.json(await getOrCreatePreferences(req.user!.id, factoryId));
  } catch (error) {
    next(error);
  }
});

router.patch("/notification-preferences", requireAuth, async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured." });
      return;
    }
    const existing = await getOrCreatePreferences(req.user!.id, factoryId);
    if (!existing) {
      res.status(500).json({ error: "Notification preferences could not be initialized." });
      return;
    }
    const allowed = [
      "inAppEnabled",
      "approvalsEnabled",
      "operationalAlertsEnabled",
      "criticalAlertsEnabled",
      "dataReturnsEnabled",
      "dataApprovalsEnabled",
      "maintenanceAlertsEnabled",
      "storesAlertsEnabled",
      "qualityAlertsEnabled",
    ] as const;
    const changes: Record<string, boolean | Date> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (typeof req.body?.[key] === "boolean") changes[key] = req.body[key];
    }
    const [updated] = await db
      .update(notificationPreferences)
      .set(changes)
      .where(eq(notificationPreferences.id, existing.id))
      .returning();
    await recordAudit(req, "UPDATED_NOTIFICATION_PREFERENCES", "notification_preferences", updated.id);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
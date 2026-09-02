import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, notificationPreferences, notifications, pushSubscriptions } from "@workspace/db";

import { recordAudit } from "../lib/audit";
import { getDemoFactoryId } from "../lib/demoData";
import {
  getOrCreatePreferences,
  getWebPushConfigStatus,
  isSupportedPushEndpoint,
} from "../lib/notifications";
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
      "webPushEnabled",
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

router.get("/push/config", requireAuth, (_req, res) => {
  res.json(getWebPushConfigStatus());
});

router.get("/push-subscriptions", requireAuth, async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
        updatedAt: pushSubscriptions.updatedAt,
        lastUsedAt: pushSubscriptions.lastUsedAt,
        revokedAt: pushSubscriptions.revokedAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, req.user!.id));
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post("/push-subscriptions", requireAuth, async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
    const p256dh = typeof req.body?.keys?.p256dh === "string" ? req.body.keys.p256dh.trim() : "";
    const auth = typeof req.body?.keys?.auth === "string" ? req.body.keys.auth.trim() : "";
    if (
      !factoryId ||
      !isSupportedPushEndpoint(endpoint) ||
      !p256dh ||
      p256dh.length > 512 ||
      !auth ||
      auth.length > 256
    ) {
      res.status(400).json({ error: "A valid web-push subscription is required." });
      return;
    }
    const saved = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint))
        .limit(1);
      if (existing && existing.userId !== req.user!.id) return null;
      if (existing) {
        const [updated] = await tx
          .update(pushSubscriptions)
          .set({
            factoryId,
            p256dh,
            auth,
            userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
            revokedAt: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(pushSubscriptions.id, existing.id),
            eq(pushSubscriptions.userId, req.user!.id),
          ))
          .returning({ id: pushSubscriptions.id, createdAt: pushSubscriptions.createdAt });
        return updated ?? null;
      }
      const [created] = await tx
        .insert(pushSubscriptions)
        .values({
          userId: req.user!.id,
          factoryId,
          endpoint,
          p256dh,
          auth,
          userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: pushSubscriptions.id, createdAt: pushSubscriptions.createdAt });
      return created ?? null;
    });
    if (!saved) {
      res.status(409).json({
        error: "This push subscription belongs to another account. Unsubscribe this browser before enabling it here.",
      });
      return;
    }
    await db
      .update(notificationPreferences)
      .set({ webPushEnabled: true, updatedAt: new Date() })
      .where(and(eq(notificationPreferences.userId, req.user!.id), eq(notificationPreferences.factoryId, factoryId)));
    await recordAudit(req, "WEB_PUSH_SUBSCRIBED", "push_subscription", saved.id);
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

router.delete("/push-subscriptions/:id", requireAuth, async (req, res, next) => {
  try {
    const [revoked] = await db
      .update(pushSubscriptions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(pushSubscriptions.id, String(req.params.id)), eq(pushSubscriptions.userId, req.user!.id)))
      .returning({ id: pushSubscriptions.id });
    if (!revoked) {
      res.status(404).json({ error: "Push subscription not found." });
      return;
    }
    await recordAudit(req, "WEB_PUSH_REVOKED", "push_subscription", revoked.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
import { and, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Request } from "express";
import {
  db,
  notificationPreferences,
  notifications,
  pushDeliveryAttempts,
  pushSubscriptions,
  usersTable,
} from "@workspace/db";
import webPush from "web-push";

import { logger } from "./logger";

export const NOTIFICATION_TYPES = {
  DATA_SUBMITTED: "DATA_SUBMITTED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  DATA_RETURNED: "DATA_RETURNED",
  DATA_APPROVED: "DATA_APPROVED",
  DATA_REJECTED: "DATA_REJECTED",
  CRITICAL_ALERT: "CRITICAL_ALERT",
  WARNING_ALERT: "WARNING_ALERT",
  ALERT_ESCALATED: "ALERT_ESCALATED",
  ALERT_RESOLVED: "ALERT_RESOLVED",
  ACTION_ASSIGNED: "ACTION_ASSIGNED",
  ACTION_OVERDUE: "ACTION_OVERDUE",
  MAINTENANCE_PRIORITY: "MAINTENANCE_PRIORITY",
  QUALITY_HOLD: "QUALITY_HOLD",
  STORES_REORDER: "STORES_REORDER",
  SYSTEM_NOTIFICATION: "SYSTEM_NOTIFICATION",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
export type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";
export const NOTIFICATION_CHANNELS = ["IN_APP", "WEB_PUSH"] as const;

const OPERATIONAL_ALERT_TYPES = new Set<NotificationType>([
  NOTIFICATION_TYPES.CRITICAL_ALERT,
  NOTIFICATION_TYPES.WARNING_ALERT,
  NOTIFICATION_TYPES.ALERT_ESCALATED,
  NOTIFICATION_TYPES.ALERT_RESOLVED,
]);

type NotificationInput = {
  factoryId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: string;
  entityId?: string | null;
  actionUrl?: string | null;
  dedupeKey: string;
};

type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

type PushNotificationRow = typeof notifications.$inferSelect;
const PUSH_DELIVERY_BATCH_SIZE = 100;
const PUSH_DELIVERY_MAX_ATTEMPTS = 3;
const PUSH_DELIVERY_LEASE_MS = 5 * 60_000;
const PUSH_DELIVERY_POLL_MS = 30_000;
let queueProcessing: Promise<void> | null = null;
let deliveryWorkerTimer: NodeJS.Timeout | null = null;

function getPushConfig(): PushConfig | null {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function getWebPushConfigStatus() {
  const config = getPushConfig();
  return { enabled: Boolean(config), publicKey: config?.publicKey ?? null };
}

function configureWebPush(config: PushConfig) {
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
}

function deliveryError(error: unknown) {
  const statusCode = error && typeof error === "object" && "statusCode" in error &&
    typeof error.statusCode === "number" ? error.statusCode : null;
  if (statusCode === 404 || statusCode === 410) {
    return { statusCode, errorCode: "SUBSCRIPTION_EXPIRED" };
  }
  if (statusCode === 400) {
    return { statusCode, errorCode: "INVALID_SUBSCRIPTION" };
  }
  return { statusCode, errorCode: "WEB_PUSH_DELIVERY_FAILED" };
}

function retryableDeliveryFailure(statusCode: number | null) {
  return statusCode === null || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

async function processQueuedWebPushDeliveries(requestId: string | undefined): Promise<void> {
  const config = getPushConfig();
  if (!config) return;

  try {
    configureWebPush(config);
    await db
      .update(pushDeliveryAttempts)
      .set({
        status: "QUEUED",
        claimedAt: null,
        nextAttemptAt: new Date(),
        errorCode: "STALE_CLAIM_RECOVERED",
      })
      .where(and(
        eq(pushDeliveryAttempts.status, "SENDING"),
        lt(pushDeliveryAttempts.claimedAt, new Date(Date.now() - PUSH_DELIVERY_LEASE_MS)),
      ));

    while (true) {
      const queued = await db
        .select({
          attempt: pushDeliveryAttempts,
          notification: notifications,
        })
        .from(pushDeliveryAttempts)
        .innerJoin(notifications, eq(pushDeliveryAttempts.notificationId, notifications.id))
        .where(and(
          eq(pushDeliveryAttempts.status, "QUEUED"),
          lte(pushDeliveryAttempts.nextAttemptAt, new Date()),
        ))
        .limit(PUSH_DELIVERY_BATCH_SIZE);
      if (!queued.length) break;

      for (const item of queued) {
        const claimedAt = new Date();
        const [claimed] = await db
          .update(pushDeliveryAttempts)
          .set({
            status: "SENDING",
            claimedAt,
            attemptedAt: claimedAt,
            attemptCount: sql`${pushDeliveryAttempts.attemptCount} + 1`,
          })
          .where(and(eq(pushDeliveryAttempts.id, item.attempt.id), eq(pushDeliveryAttempts.status, "QUEUED")))
          .returning({
            id: pushDeliveryAttempts.id,
            attemptCount: pushDeliveryAttempts.attemptCount,
          });
        if (!claimed) continue;

        const [activeSubscription] = await db
          .select()
          .from(pushSubscriptions)
          .where(and(
            eq(pushSubscriptions.id, item.attempt.subscriptionId),
            eq(pushSubscriptions.userId, item.attempt.userId),
            eq(pushSubscriptions.factoryId, item.attempt.factoryId),
            isNull(pushSubscriptions.revokedAt),
          ))
          .limit(1);
        if (!activeSubscription) {
          await db
            .update(pushDeliveryAttempts)
            .set({
              status: "FAILED",
              claimedAt: null,
              errorCode: "SUBSCRIPTION_UNAVAILABLE",
              completedAt: new Date(),
            })
            .where(eq(pushDeliveryAttempts.id, claimed.id));
          continue;
        }

        try {
          const response = await webPush.sendNotification(
            {
              endpoint: activeSubscription.endpoint,
              keys: {
                p256dh: activeSubscription.p256dh,
                auth: activeSubscription.auth,
              },
            },
            JSON.stringify({
              title: item.notification.title,
              body: item.notification.message,
              url: item.notification.actionUrl ?? "/",
              tag: `critical-${item.notification.id}`,
            }),
            { TTL: 3600, urgency: "high" },
          );
          const responseStatus = typeof response?.statusCode === "number" ? response.statusCode : null;
          await db
            .update(pushDeliveryAttempts)
            .set({
              status: "SENT",
              responseStatus,
              claimedAt: null,
              errorCode: null,
              completedAt: new Date(),
            })
            .where(eq(pushDeliveryAttempts.id, claimed.id));
          await db
            .update(pushSubscriptions)
            .set({ lastUsedAt: new Date(), updatedAt: new Date() })
            .where(eq(pushSubscriptions.id, activeSubscription.id));
          logger.info({
            requestId,
            channel: "WEB_PUSH",
            notificationId: item.notification.id,
            subscriptionId: activeSubscription.id,
            responseStatus,
          }, "Critical web-push notification delivered");
        } catch (error) {
          const failure = deliveryError(error);
          const willRetry = retryableDeliveryFailure(failure.statusCode) &&
            claimed.attemptCount < PUSH_DELIVERY_MAX_ATTEMPTS;
          const retryDelayMs = 30_000 * (2 ** Math.max(0, claimed.attemptCount - 1));
          await db
            .update(pushDeliveryAttempts)
            .set({
              status: willRetry ? "QUEUED" : "FAILED",
              responseStatus: failure.statusCode,
              claimedAt: null,
              nextAttemptAt: willRetry ? new Date(Date.now() + retryDelayMs) : new Date(),
              errorCode: failure.errorCode,
              completedAt: willRetry ? null : new Date(),
            })
            .where(eq(pushDeliveryAttempts.id, claimed.id));
          if (failure.errorCode === "SUBSCRIPTION_EXPIRED") {
            await db
              .update(pushSubscriptions)
              .set({ revokedAt: new Date(), updatedAt: new Date() })
              .where(and(eq(pushSubscriptions.id, activeSubscription.id), isNull(pushSubscriptions.revokedAt)));
          }
          logger.warn({
            requestId,
            channel: "WEB_PUSH",
            notificationId: item.notification.id,
            subscriptionId: activeSubscription.id,
            responseStatus: failure.statusCode,
            errorCode: failure.errorCode,
            willRetry,
          }, "Critical web-push notification delivery failed");
        }
      }
      if (queued.length < PUSH_DELIVERY_BATCH_SIZE) break;
    }
  } catch {
    logger.error({ requestId, channel: "WEB_PUSH", errorCode: "QUEUE_PROCESSING_FAILED" }, "Critical web-push delivery queue could not be processed");
  }
}

function triggerPushDeliveryProcessing(requestId: string | undefined) {
  if (queueProcessing) return;
  queueProcessing = processQueuedWebPushDeliveries(requestId).finally(() => {
    queueProcessing = null;
  });
}

export function isSupportedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "fcm.googleapis.com" ||
      hostname === "updates.push.services.mozilla.com" ||
      hostname === "push.services.mozilla.com" ||
      hostname === "web.push.apple.com" ||
      hostname.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

function shouldQueueCriticalPush(
  preference: typeof notificationPreferences.$inferSelect | undefined,
  input: NotificationInput,
) {
  return input.severity === "CRITICAL" && preference?.webPushEnabled === true;
}

async function createNotificationWithPushOutbox(
  userId: string,
  input: NotificationInput,
  queuePush: boolean,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(notifications)
      .values({ userId, ...input })
      .onConflictDoNothing()
      .returning();
    if (!row || !queuePush) return row;

    const subscriptions = await tx
      .select()
      .from(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.factoryId, input.factoryId),
        isNull(pushSubscriptions.revokedAt),
      ));
    if (subscriptions.length) {
      await tx
        .insert(pushDeliveryAttempts)
        .values(subscriptions.map((subscription) => ({
          notificationId: row.id,
          subscriptionId: subscription.id,
          userId,
          factoryId: input.factoryId,
          status: "QUEUED",
        })))
        .onConflictDoNothing();
    }
    return row;
  });
}

function preferenceAllows(
  preference: typeof notificationPreferences.$inferSelect | undefined,
  input: Pick<NotificationInput, "type" | "severity">,
) {
  if (preference?.inAppEnabled === false) return false;
  if (input.type === NOTIFICATION_TYPES.APPROVAL_REQUIRED && preference?.approvalsEnabled === false) return false;
  if (input.type === NOTIFICATION_TYPES.DATA_RETURNED && preference?.dataReturnsEnabled === false) return false;
  if (input.type === NOTIFICATION_TYPES.DATA_APPROVED && preference?.dataApprovalsEnabled === false) return false;
  if (
    OPERATIONAL_ALERT_TYPES.has(input.type) &&
    preference?.operationalAlertsEnabled === false
  ) return false;
  if (input.severity === "CRITICAL" && preference?.criticalAlertsEnabled === false) return false;
  if (input.type === NOTIFICATION_TYPES.QUALITY_HOLD && preference?.qualityAlertsEnabled === false) return false;
  if (input.type === NOTIFICATION_TYPES.STORES_REORDER && preference?.storesAlertsEnabled === false) return false;
  if (input.type === NOTIFICATION_TYPES.MAINTENANCE_PRIORITY && preference?.maintenanceAlertsEnabled === false) return false;
  return true;
}

export async function notifyUsers(
  req: Request,
  userIds: string[],
  input: NotificationInput,
) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return [];
  const preferences = await db
    .select()
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.factoryId, input.factoryId), inArray(notificationPreferences.userId, uniqueUserIds)));
  const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
  const created: PushNotificationRow[] = [];
  let queuedPush = false;
  for (const userId of uniqueUserIds) {
    const preference = preferenceByUser.get(userId);
    if (!preferenceAllows(preference, input)) continue;
    const queuePush = shouldQueueCriticalPush(preference, input);
    const row = await createNotificationWithPushOutbox(userId, input, queuePush);
    if (row) {
      created.push(row);
      queuedPush ||= queuePush;
      // Notifications are operational events, so they are visible in the
      // same audit stream as the action that produced them.
      if (req.user) {
        const { recordAudit } = await import("./audit");
        await recordAudit(req, "NOTIFICATION_CREATED", "notification", row.id, {
          notificationType: input.type,
          recipientId: userId,
          dedupeKey: input.dedupeKey,
        });
      }
    }
  }
  if (queuedPush) triggerPushDeliveryProcessing(String(req.id));
  return created;
}

export async function notifyRoles(
  req: Request,
  factoryId: string,
  roles: string[],
  input: Omit<NotificationInput, "factoryId">,
) {
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.role, roles));
  return notifyUsers(req, users.map((user) => user.id), { ...input, factoryId });
}

export async function notifyUser(
  req: Request,
  userId: string | null | undefined,
  input: NotificationInput,
) {
  return userId ? notifyUsers(req, [userId], input) : [];
}

export async function getOrCreatePreferences(userId: string, factoryId: string) {
  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.factoryId, factoryId)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(notificationPreferences)
    .values({ userId, factoryId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [retried] = await db
    .select()
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.factoryId, factoryId)))
    .limit(1);
  return retried;
}

export function startPushDeliveryWorker() {
  if (deliveryWorkerTimer) return;
  if (!getPushConfig()) {
    logger.warn({ channel: "WEB_PUSH" }, "Critical web-push delivery worker is disabled: VAPID configuration is incomplete");
    return;
  }
  triggerPushDeliveryProcessing("startup");
  deliveryWorkerTimer = setInterval(
    () => triggerPushDeliveryProcessing("scheduled"),
    PUSH_DELIVERY_POLL_MS,
  );
  deliveryWorkerTimer.unref();
}
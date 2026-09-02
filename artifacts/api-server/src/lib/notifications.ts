import { and, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import {
  db,
  notificationPreferences,
  notifications,
  usersTable,
} from "@workspace/db";

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
export const NOTIFICATION_CHANNELS = ["IN_APP", "WEB_PUSH", "EMAIL", "SMS", "WHATSAPP"] as const;

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
  const created = [];
  for (const userId of uniqueUserIds) {
    if (!preferenceAllows(preferenceByUser.get(userId), input)) continue;
    const [row] = await db
      .insert(notifications)
      .values({ userId, ...input })
      .onConflictDoNothing()
      .returning();
    if (row) {
      created.push(row);
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
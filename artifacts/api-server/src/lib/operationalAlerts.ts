import { and, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import { db, factorySettings, maintenanceWorkOrders, operationalAlerts, qualitySamples, storeMovements } from "@workspace/db";

import { recordAudit } from "./audit";
import { NOTIFICATION_TYPES, notifyRoles, type NotificationType } from "./notifications";

type AlertSeverity = "WARNING" | "CRITICAL";
type Direction = "above" | "below";

type ThresholdConfig = {
  warning?: number;
  critical?: number;
  direction?: Direction;
};

type Observation = {
  factoryId: string;
  productionDate: string;
  kpiCode: string;
  title: string;
  detail: string;
  actual: number | null;
  unit?: string;
  threshold?: ThresholdConfig | null;
  forcedSeverity?: AlertSeverity | null;
  resolveRegardless?: boolean;
  sourceEntityType: string;
  sourceEntityId: string;
};

type NumericObservation = Omit<Observation, "threshold"> & {
  threshold: ThresholdConfig | null;
};

const OPEN_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const;
const ALERT_RULE_VERSION = "thresholds.v1";

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asThreshold(value: unknown): ThresholdConfig | null {
  const object = asObject(value);
  const warning = asNumber(object.warning);
  const critical = asNumber(object.critical);
  if (warning === null && critical === null) return null;
  const direction = object.direction === "above" || object.direction === "below"
    ? object.direction
    : undefined;
  return { warning: warning ?? undefined, critical: critical ?? undefined, direction };
}

function thresholdFor(
  thresholds: Record<string, unknown>,
  code: string,
  aliases: string[] = [],
): ThresholdConfig | null {
  for (const candidate of [code, ...aliases]) {
    const direct = asThreshold(thresholds[candidate]);
    if (direct) return direct;
  }

  const [group, field] = code.split("_", 2);
  const nested = asObject(thresholds[group]);
  if (field) {
    for (const candidate of [field, code, ...aliases]) {
      const found = asThreshold(nested[candidate]);
      if (found) return found;
    }
  }
  return null;
}

function defaultDirection(code: string): Direction {
  return ["downtime", "steam_consumption"].includes(code) ? "above" : "below";
}

function severityFor(
  actual: number | null,
  threshold: ThresholdConfig | null,
  forcedSeverity: AlertSeverity | null = null,
  code = "",
): AlertSeverity | null {
  if (forcedSeverity) return forcedSeverity;
  if (actual === null || !threshold) return null;
  const direction = threshold.direction ?? defaultDirection(code);
  const breaches = (limit: number | undefined) =>
    limit === undefined ? false : direction === "above" ? actual > limit : actual < limit;
  if (breaches(threshold.critical)) return "CRITICAL";
  if (breaches(threshold.warning)) return "WARNING";
  return null;
}

function severityRank(severity: AlertSeverity): number {
  return severity === "CRITICAL" ? 2 : 1;
}

function mergeSeverity(left: AlertSeverity | null, right: AlertSeverity | null): AlertSeverity | null {
  if (!left) return right;
  if (!right) return left;
  return severityRank(left) >= severityRank(right) ? left : right;
}

function notificationTypeFor(observation: Observation, severity: AlertSeverity): NotificationType {
  if (observation.kpiCode.startsWith("quality_status:")) return NOTIFICATION_TYPES.QUALITY_HOLD;
  if (observation.kpiCode.startsWith("store:")) return NOTIFICATION_TYPES.STORES_REORDER;
  if (observation.kpiCode.startsWith("maintenance:")) return NOTIFICATION_TYPES.MAINTENANCE_PRIORITY;
  return severity === "CRITICAL" ? NOTIFICATION_TYPES.CRITICAL_ALERT : NOTIFICATION_TYPES.WARNING_ALERT;
}

async function notifyAlertAudience(
  req: Request,
  alertId: string,
  observation: Observation,
  type: NotificationType,
  severity: AlertSeverity | "INFO",
  title: string,
  message: string,
  stateKey: string,
) {
  await notifyRoles(
    req,
    observation.factoryId,
    severity === "CRITICAL" ? ["MANAGER", "ADMIN"] : ["MANAGER"],
    {
      type,
      severity,
      title,
      message,
      entityType: "operational_alert",
      entityId: alertId,
      actionUrl: `/operations-suite?date=${observation.productionDate}`,
      dedupeKey: `operational-alert:${alertId}:${stateKey}`,
    },
  );
}

async function syncObservation(req: Request, observation: Observation): Promise<void> {
  // Missing measurements are unknown, not healthy. Only an explicit terminal
  // condition such as a completed maintenance order may resolve without a value.
  if (observation.actual === null && !observation.resolveRegardless) return;
  const threshold = observation.threshold ?? null;
  const severity = observation.resolveRegardless
    ? null
    : severityFor(observation.actual, threshold, observation.forcedSeverity, observation.kpiCode);
  const [existing] = await db
    .select()
    .from(operationalAlerts)
    .where(
      and(
        eq(operationalAlerts.factoryId, observation.factoryId),
        eq(operationalAlerts.productionDate, observation.productionDate),
        eq(operationalAlerts.kpiCode, observation.kpiCode),
        inArray(operationalAlerts.status, [...OPEN_STATUSES]),
      ),
    )
    .limit(1);

  if (!severity) {
    if (!existing) return;
    const [resolved] = await db
      .update(operationalAlerts)
      .set({
        status: "RESOLVED",
        resolvedBy: req.user?.id ?? null,
        resolvedAt: new Date(),
        observedValue: observation.actual?.toFixed(4) ?? null,
      })
      .where(eq(operationalAlerts.id, existing.id))
      .returning();
    await recordAudit(req, "RESOLVED_OPERATIONAL_ALERT", "operational_alert", resolved.id, {
      ruleVersion: ALERT_RULE_VERSION,
      kpiCode: observation.kpiCode,
      reason: "A later valid observation returned inside the warning limit.",
      actual: observation.actual,
      sourceEntityType: observation.sourceEntityType,
      sourceEntityId: observation.sourceEntityId,
    });
    await notifyAlertAudience(
      req,
      resolved.id,
      observation,
      NOTIFICATION_TYPES.ALERT_RESOLVED,
      "INFO",
      `${observation.title} resolved`,
      `The latest valid observation is back inside the configured operating limit for ${observation.productionDate}.`,
      "RESOLVED",
    );
    return;
  }

  const thresholdValue = severity === "CRITICAL" ? threshold?.critical : threshold?.warning;
  if (!existing) {
    const [created] = await db
      .insert(operationalAlerts)
      .values({
        factoryId: observation.factoryId,
        productionDate: observation.productionDate,
        kpiCode: observation.kpiCode,
        severity,
        title: observation.title,
        detail: observation.detail,
        status: "OPEN",
        observedValue: observation.actual?.toFixed(4) ?? null,
        threshold: thresholdValue?.toFixed(4) ?? null,
        direction: threshold?.direction ?? defaultDirection(observation.kpiCode),
        sourceEntityType: observation.sourceEntityType,
        sourceEntityId: observation.sourceEntityId,
        isDemo: false,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      await syncObservation(req, observation);
      return;
    }
    await recordAudit(req, "RAISED_OPERATIONAL_ALERT", "operational_alert", created.id, {
      ruleVersion: ALERT_RULE_VERSION,
      severity,
      kpiCode: observation.kpiCode,
      actual: observation.actual,
      threshold: thresholdValue,
      direction: threshold?.direction ?? defaultDirection(observation.kpiCode),
      sourceEntityType: observation.sourceEntityType,
      sourceEntityId: observation.sourceEntityId,
    });
    await notifyAlertAudience(
      req,
      created.id,
      observation,
      notificationTypeFor(observation, severity),
      severity,
      severity === "CRITICAL" ? `Critical: ${observation.title}` : observation.title,
      `${observation.detail} Observed value: ${observation.actual ?? "unavailable"} for ${observation.productionDate}.`,
      `OPEN:${severity}`,
    );
    return;
  }

  if (severityRank(severity) > severityRank(existing.severity as AlertSeverity)) {
    const [updated] = await db
      .update(operationalAlerts)
      .set({
        severity,
        title: observation.title,
        detail: observation.detail,
        status: "OPEN",
        observedValue: observation.actual?.toFixed(4) ?? null,
        threshold: thresholdValue?.toFixed(4) ?? null,
        direction: threshold?.direction ?? defaultDirection(observation.kpiCode),
        sourceEntityType: observation.sourceEntityType,
        sourceEntityId: observation.sourceEntityId,
        acknowledgedBy: null,
        acknowledgedAt: null,
      })
      .where(eq(operationalAlerts.id, existing.id))
      .returning();
    await recordAudit(req, "ESCALATED_OPERATIONAL_ALERT", "operational_alert", updated.id, {
      ruleVersion: ALERT_RULE_VERSION,
      previousSeverity: existing.severity,
      severity,
      kpiCode: observation.kpiCode,
      actual: observation.actual,
      threshold: thresholdValue,
      sourceEntityType: observation.sourceEntityType,
      sourceEntityId: observation.sourceEntityId,
    });
    await notifyAlertAudience(
      req,
      updated.id,
      observation,
      NOTIFICATION_TYPES.ALERT_ESCALATED,
      severity,
      `Escalated: ${observation.title}`,
      `This alert escalated from ${existing.severity} to ${severity}. Observed value: ${observation.actual ?? "unavailable"}.`,
      `ESCALATED:${severity}`,
    );
    return;
  }

  await db
    .update(operationalAlerts)
    .set({
      title: observation.title,
      detail: observation.detail,
      observedValue: observation.actual?.toFixed(4) ?? null,
      threshold: thresholdValue?.toFixed(4) ?? null,
      direction: threshold?.direction ?? defaultDirection(observation.kpiCode),
      sourceEntityType: observation.sourceEntityType,
      sourceEntityId: observation.sourceEntityId,
    })
    .where(eq(operationalAlerts.id, existing.id));
}

async function settingsThresholds(factoryId: string): Promise<Record<string, unknown>> {
  const [settings] = await db
    .select({ kpiThresholds: factorySettings.kpiThresholds })
    .from(factorySettings)
    .where(eq(factorySettings.factoryId, factoryId))
    .limit(1);
  return asObject(settings?.kpiThresholds);
}

function numericObservation(
  base: Omit<NumericObservation, "threshold">,
  threshold: ThresholdConfig | null,
): NumericObservation {
  return { ...base, threshold };
}

export async function evaluateDailyOperationAlerts(
  req: Request,
  input: {
    factoryId: string;
    productionDate: string;
    sourceEntityId: string;
    values: Record<string, number | null>;
  },
): Promise<void> {
  const thresholds = await settingsThresholds(input.factoryId);
  const definitions: Array<[string, string, string, string]> = [
    ["recovery", "Recovery below operating limit", "Submitted recovery is outside the configured operating limit.", "%"],
    ["downtime", "Downtime above operating limit", "Submitted hours lost are outside the configured operating limit.", "h"],
    ["power_generated", "Power generation below operating limit", "Submitted power generation is outside the configured operating limit.", "kWh"],
    ["steam_consumption", "Steam consumption above operating limit", "Submitted steam consumption is outside the configured operating limit.", "t/t cane"],
    ["cane_crushed", "Cane crushed below operating limit", "Submitted cane crushed is outside the configured operating limit.", "t"],
    ["sugar_produced", "Sugar produced below operating limit", "Submitted sugar produced is outside the configured operating limit.", "t"],
  ];
  for (const [code, title, detail, unit] of definitions) {
    const threshold = thresholdFor(thresholds, code);
    if (!threshold) continue;
    await syncObservation(req, numericObservation({
      factoryId: input.factoryId,
      productionDate: input.productionDate,
      kpiCode: code,
      title,
      detail,
      actual: input.values[code] ?? null,
      unit,
      sourceEntityType: "daily_operations",
      sourceEntityId: input.sourceEntityId,
    }, threshold));
  }
}

export async function evaluateQualitySampleAlerts(
  req: Request,
  sample: typeof qualitySamples.$inferSelect,
): Promise<void> {
  const thresholds = await settingsThresholds(sample.factoryId);
  const values: Array<[string, number | null, string]> = [
    ["brix", asNumber(sample.brix), "%"],
    ["pol", asNumber(sample.pol), "%"],
    ["purity", asNumber(sample.purity), "%"],
  ];
  for (const [code, actual, unit] of values) {
    const threshold = thresholdFor(thresholds, `quality_${code}`, [code]);
    if (!threshold) continue;
    await syncObservation(req, numericObservation({
      factoryId: sample.factoryId,
      productionDate: sample.productionDate,
      kpiCode: `quality_${code}`,
      title: `${code[0].toUpperCase()}${code.slice(1)} outside operating limit`,
      detail: `${sample.sampleType} sample is outside the configured ${code} limit.`,
      actual,
      unit,
      sourceEntityType: "quality_sample",
      sourceEntityId: sample.id,
    }, threshold));
  }

  const statusCode = `quality_status:${sample.sampleType.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const statusThreshold = thresholdFor(thresholds, "quality_status");
  await syncObservation(req, {
    factoryId: sample.factoryId,
    productionDate: sample.productionDate,
    kpiCode: statusCode,
    title: `${sample.sampleType} quality sample on hold`,
    detail: `${sample.sampleType} sample is on hold and requires laboratory review.`,
    actual: sample.status === "HOLD" ? 1 : 0,
    threshold: sample.status === "HOLD" ? null : statusThreshold,
    forcedSeverity: sample.status === "HOLD" ? "WARNING" : null,
    sourceEntityType: "quality_sample",
    sourceEntityId: sample.id,
  });
}

function materialKey(material: string): string {
  return material.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown";
}

export async function evaluateStoreMovementAlerts(
  req: Request,
  movement: typeof storeMovements.$inferSelect,
): Promise<void> {
  const movements = await db
    .select()
    .from(storeMovements)
    .where(and(eq(storeMovements.factoryId, movement.factoryId), eq(storeMovements.material, movement.material)));
  const currentStock = movements.reduce((total, row) => {
    const quantity = asNumber(row.quantity) ?? 0;
    return total + (row.movementType === "ISSUE" ? -quantity : quantity);
  }, 0);
  const thresholds = await settingsThresholds(movement.factoryId);
  const stores = asObject(thresholds.stores ?? thresholds.inventory);
  const configured = asThreshold(stores[movement.material]) ?? thresholdFor(
    thresholds,
    "stores",
    ["inventory", "store_stock"],
  );
  const reorderLevel = asNumber(movement.reorderLevel);
  const threshold = configured ?? (reorderLevel === null ? null : {
    warning: reorderLevel,
    direction: "below" as const,
  });
  if (!threshold) return;
  await syncObservation(req, numericObservation({
    factoryId: movement.factoryId,
    productionDate: movement.productionDate,
    kpiCode: `store:${materialKey(movement.material)}`,
    title: `${movement.material} stock below reorder level`,
    detail: `Calculated ${movement.material} stock is below the configured reorder limit.`,
    actual: currentStock,
    unit: movement.unit,
    sourceEntityType: "store_movement",
    sourceEntityId: movement.id,
  }, threshold));
}

export async function evaluateMaintenanceAlerts(
  req: Request,
  workOrder: typeof maintenanceWorkOrders.$inferSelect,
): Promise<void> {
  if (!workOrder.productionDate) return;
  const thresholds = await settingsThresholds(workOrder.factoryId);
  const configured = thresholdFor(thresholds, "maintenance_hours_lost", ["maintenance"]);
  const hoursLost = asNumber(workOrder.hoursLost);
  const thresholdSeverity = severityFor(hoursLost, configured, null, "maintenance_hours_lost");
  const prioritySeverity: AlertSeverity | null =
    workOrder.priority === "CRITICAL" ? "CRITICAL" : workOrder.priority === "HIGH" ? "WARNING" : null;
  const forcedSeverity = workOrder.status === "DONE"
    ? null
    : mergeSeverity(prioritySeverity, thresholdSeverity);
  await syncObservation(req, {
    factoryId: workOrder.factoryId,
    productionDate: workOrder.productionDate,
    kpiCode: `maintenance:${materialKey(workOrder.asset)}`,
    title: `${workOrder.asset} requires maintenance attention`,
    detail: workOrder.status === "DONE"
      ? `${workOrder.asset} work order is complete and the condition is resolved.`
      : `${workOrder.asset} work order is ${workOrder.priority.toLowerCase()} priority.`,
    actual: hoursLost,
    threshold: workOrder.status === "DONE" ? null : configured,
    forcedSeverity,
    resolveRegardless: workOrder.status === "DONE",
    sourceEntityType: "maintenance_work_order",
    sourceEntityId: workOrder.id,
  });
}
import { and, asc, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  dailyOperations,
  factories,
  kpiTargets,
  kpiValues,
  lineageReferences,
  maintenanceWorkOrders,
  operationalActions,
  operationalAlerts,
  productionDays,
  qualitySamples,
  sourceFiles,
  storeMovements,
  factorySettings,
} from "@workspace/db";
import { db } from "@workspace/db";

import { recordAudit } from "../lib/audit";
import { requireRoles, type Role } from "../lib/authz";
import { getDemoFactoryId } from "../lib/demoData";
import {
  evaluateMaintenanceAlerts,
  evaluateQualitySampleAlerts,
  evaluateStoreMovementAlerts,
} from "../lib/operationalAlerts";

const router: IRouter = Router();
const allOperators: Role[] = [
  "PRODUCTION_OPERATOR",
  "QUALITY_OPERATOR",
  "ENGINEERING_OPERATOR",
  "STORES_OPERATOR",
  "MANAGER",
  "ADMIN",
];
const leadership: Role[] = ["MANAGER", "ADMIN"];

const asNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const asDate = (value: unknown, fallback = "2026-08-30") => {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  return date;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

router.get("/operations-suite", requireRoles(...allOperators), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No demo factory has been configured." });
      return;
    }
    const productionDate = asDate(req.query.date);
    const [settings, targets, handovers, samples, movements, maintenance, alerts, sourceRows, day] =
      await Promise.all([
        db.select().from(factorySettings).where(eq(factorySettings.factoryId, factoryId)).limit(1),
        db.select().from(kpiTargets).where(and(eq(kpiTargets.factoryId, factoryId), eq(kpiTargets.productionDate, productionDate))).orderBy(asc(kpiTargets.code)),
        db.select().from(operationalActions).where(and(eq(operationalActions.factoryId, factoryId), eq(operationalActions.productionDate, productionDate))).orderBy(desc(operationalActions.createdAt)).limit(40),
        db.select().from(qualitySamples).where(and(eq(qualitySamples.factoryId, factoryId), eq(qualitySamples.productionDate, productionDate))).orderBy(desc(qualitySamples.createdAt)).limit(40),
        db.select().from(storeMovements).where(and(eq(storeMovements.factoryId, factoryId), eq(storeMovements.productionDate, productionDate))).orderBy(desc(storeMovements.createdAt)).limit(40),
        db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.factoryId, factoryId)).orderBy(desc(maintenanceWorkOrders.createdAt)).limit(40),
        db.select().from(operationalAlerts).where(and(eq(operationalAlerts.factoryId, factoryId), eq(operationalAlerts.productionDate, productionDate))).orderBy(desc(operationalAlerts.createdAt)).limit(40),
        db.select().from(sourceFiles).where(eq(sourceFiles.factoryId, factoryId)),
        db.select().from(productionDays).where(and(eq(productionDays.factoryId, factoryId), eq(productionDays.productionDate, productionDate))).limit(1),
      ]);

    const [kpis, lineage, operationRows] = await Promise.all([
      day[0]
        ? db.select().from(kpiValues).where(eq(kpiValues.productionDayId, day[0].id)).orderBy(asc(kpiValues.code))
        : [],
      day[0]
        ? db.select().from(lineageReferences).where(eq(lineageReferences.productionDayId, day[0].id)).orderBy(asc(lineageReferences.kpiCode))
        : [],
      db.select().from(dailyOperations).where(eq(dailyOperations.factoryId, factoryId)).orderBy(desc(dailyOperations.productionDate)).limit(60),
    ]);

    const pareto = new Map<string, { cause: string; hours: number; occurrences: number }>();
    for (const operation of operationRows) {
      for (const stoppage of jsonArray(operation.stoppages)) {
        const cause = String(stoppage.cause || "Unclassified");
        const hours = asNumber(stoppage.durationHours) ?? 0;
        const current = pareto.get(cause) ?? { cause, hours: 0, occurrences: 0 };
        current.hours += hours;
        current.occurrences += 1;
        pareto.set(cause, current);
      }
    }
    const sectionValues = operationRows.flatMap((row) => [
      ["Production", Object.keys(jsonObject(row.production)).length],
      ["Quality", Object.keys(jsonObject(row.quality)).length],
      ["Engineering", Object.keys(jsonObject(row.timeAccount)).length + Object.keys(jsonObject(row.energy)).length],
      ["Stores", jsonArray(row.materials).length],
    ]);
    const departmentQuality = ["Production", "Quality", "Engineering", "Stores"].map((department) => {
      const values = sectionValues.filter(([name]) => name === department).map(([, count]) => count as number);
      const populated = values.filter((count) => count > 0).length;
      return { department, completeness: values.length ? Math.round((populated / values.length) * 100) : 0 };
    });

    res.json({
      factory: (await db.select({ name: factories.name }).from(factories).where(eq(factories.id, factoryId)).limit(1))[0]?.name,
      productionDate,
      settings: settings[0] ?? {
        season: "2025-26",
        shiftConfig: ["A", "B", "C", "GENERAL"],
        kpiThresholds: {},
        targetDefaults: {},
      },
      targets: targets.map((target) => ({ ...target, target: Number(target.target) })),
      handovers,
      qualitySamples: samples.map((sample) => ({ ...sample, brix: asNumber(sample.brix), pol: asNumber(sample.pol), purity: asNumber(sample.purity) })),
      storeMovements: movements.map((movement) => ({ ...movement, quantity: Number(movement.quantity), reorderLevel: asNumber(movement.reorderLevel) })),
      maintenance: maintenance.map((item) => ({ ...item, hoursLost: asNumber(item.hoursLost) })),
      alerts,
      kpis: kpis.map((kpi) => ({ ...kpi, value: asNumber(kpi.value), comparisonValue: asNumber(kpi.comparisonValue) })),
      lineage,
      downtimePareto: [...pareto.values()].sort((a, b) => b.hours - a.hours).slice(0, 10).map((item) => ({ ...item, hours: Number(item.hours.toFixed(2)) })),
      dataQuality: {
        score: Math.min(100, Math.round((sourceRows.length ? sourceRows.filter((file) => file.status !== "FAILED").length / sourceRows.length : 0) * 70 + (operationRows.length ? 30 : 0))),
        sourceFiles: sourceRows.length,
        failedSources: sourceRows.filter((file) => file.status === "FAILED").length,
        departments: departmentQuality,
        checks: [
          { label: "Source registry connected", status: sourceRows.length > 0 ? "PASS" : "WARN" },
          { label: "Daily operations available", status: operationRows.length > 0 ? "PASS" : "WARN" },
          { label: "Current-day production record", status: day.length > 0 ? "PASS" : "WARN" },
          { label: "Failed source files", status: sourceRows.some((file) => file.status === "FAILED") ? "WARN" : "PASS" },
        ],
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/operations-suite/handover", requireRoles(...allOperators), async (req, res, next) => {
  try {
    const { productionDate, shift, title, detail, dueDate } = req.body ?? {};
    if (!title || !detail) {
      res.status(400).json({ error: "A handover title and detail are required." });
      return;
    }
    const factoryId = await getDemoFactoryId();
    const [created] = await db.insert(operationalActions).values({
      factoryId: factoryId!,
      productionDate: asDate(productionDate),
      shift: shift || "GENERAL",
      department: req.user!.department,
      kind: "HANDOVER",
      title: String(title).slice(0, 160),
      detail: String(detail).slice(0, 2000),
      dueDate: dueDate ? asDate(dueDate) : null,
      createdBy: req.user!.id,
      isDemo: true,
    }).returning();
    await recordAudit(req, "CREATED_HANDOVER", "operational_action", created.id);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.patch("/operations-suite/actions/:id", requireRoles(...allOperators), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No demo factory has been configured." });
      return;
    }
    const [existing] = await db.select().from(operationalActions).where(and(
      eq(operationalActions.id, String(req.params.id)),
      eq(operationalActions.factoryId, factoryId),
    )).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Action not found." });
      return;
    }
    if (!leadership.includes(req.user!.role as Role) && existing.department !== req.user!.department) {
      res.status(403).json({ error: "Only the owning department can update this action." });
      return;
    }
    const status = ["OPEN", "IN_PROGRESS", "DONE"].includes(req.body?.status) ? req.body.status : "IN_PROGRESS";
    const [updated] = await db.update(operationalActions).set({
      status,
      completedAt: status === "DONE" ? new Date() : null,
    }).where(and(
      eq(operationalActions.id, existing.id),
      eq(operationalActions.factoryId, factoryId),
    )).returning();
    await recordAudit(req, "UPDATED_HANDOVER_STATUS", "operational_action", updated.id, { status });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/operations-suite/quality", requireRoles("QUALITY_OPERATOR", ...leadership), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    const [created] = await db.insert(qualitySamples).values({
      factoryId: factoryId!,
      productionDate: asDate(req.body?.productionDate),
      shift: req.body?.shift || "GENERAL",
      sampleType: String(req.body?.sampleType || "Mixed juice"),
      brix: asNumber(req.body?.brix)?.toFixed(3),
      pol: asNumber(req.body?.pol)?.toFixed(3),
      purity: asNumber(req.body?.purity)?.toFixed(3),
      status: ["PASS", "HOLD", "PENDING"].includes(req.body?.status) ? req.body.status : "PENDING",
      notes: req.body?.notes ? String(req.body.notes).slice(0, 1000) : null,
      createdBy: req.user!.id,
      isDemo: true,
    }).returning();
    await recordAudit(req, "CREATED_QUALITY_SAMPLE", "quality_sample", created.id);
    await evaluateQualitySampleAlerts(req, created);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.post("/operations-suite/stores", requireRoles("STORES_OPERATOR", ...leadership), async (req, res, next) => {
  try {
    const quantity = asNumber(req.body?.quantity);
    if (!req.body?.material || quantity === null || quantity < 0) {
      res.status(400).json({ error: "Material and a non-negative quantity are required." });
      return;
    }
    const factoryId = await getDemoFactoryId();
    const [created] = await db.insert(storeMovements).values({
      factoryId: factoryId!,
      productionDate: asDate(req.body?.productionDate),
      material: String(req.body.material).slice(0, 120),
      movementType: ["RECEIPT", "ISSUE", "ADJUSTMENT"].includes(req.body?.movementType) ? req.body.movementType : "ISSUE",
      quantity: quantity.toFixed(4),
      unit: String(req.body?.unit || "kg"),
      reorderLevel: asNumber(req.body?.reorderLevel)?.toFixed(4) ?? null,
      notes: req.body?.notes ? String(req.body.notes).slice(0, 1000) : null,
      createdBy: req.user!.id,
      isDemo: true,
    }).returning();
    await recordAudit(req, "CREATED_STORE_MOVEMENT", "store_movement", created.id);
    await evaluateStoreMovementAlerts(req, created);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.post("/operations-suite/maintenance", requireRoles("ENGINEERING_OPERATOR", ...leadership), async (req, res, next) => {
  try {
    if (!req.body?.asset || !req.body?.issue) {
      res.status(400).json({ error: "Asset and issue are required." });
      return;
    }
    const factoryId = await getDemoFactoryId();
    const [created] = await db.insert(maintenanceWorkOrders).values({
      factoryId: factoryId!,
      productionDate: req.body?.productionDate ? asDate(req.body.productionDate) : null,
      asset: String(req.body.asset).slice(0, 160),
      issue: String(req.body.issue).slice(0, 2000),
      workType: ["PLANNED", "BREAKDOWN", "INSPECTION"].includes(req.body?.workType) ? req.body.workType : "BREAKDOWN",
      priority: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(req.body?.priority) ? req.body.priority : "MEDIUM",
      status: "OPEN",
      hoursLost: asNumber(req.body?.hoursLost)?.toFixed(2) ?? null,
      assignedTo: req.body?.assignedTo ? String(req.body.assignedTo).slice(0, 120) : null,
      createdBy: req.user!.id,
      isDemo: true,
    }).returning();
    await recordAudit(req, "CREATED_MAINTENANCE_ORDER", "maintenance_work_order", created.id);
    await evaluateMaintenanceAlerts(req, created);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.patch("/operations-suite/maintenance/:id", requireRoles("ENGINEERING_OPERATOR", ...leadership), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No demo factory has been configured." });
      return;
    }
    const [existing] = await db.select().from(maintenanceWorkOrders).where(and(
      eq(maintenanceWorkOrders.id, String(req.params.id)),
      eq(maintenanceWorkOrders.factoryId, factoryId),
    )).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Maintenance order not found." });
      return;
    }
    const status = ["OPEN", "IN_PROGRESS", "DONE"].includes(req.body?.status) ? req.body.status : "IN_PROGRESS";
    const [updated] = await db.update(maintenanceWorkOrders).set({
      status,
      completedAt: status === "DONE" ? new Date() : null,
    }).where(and(
      eq(maintenanceWorkOrders.id, existing.id),
      eq(maintenanceWorkOrders.factoryId, factoryId),
    )).returning();
    await recordAudit(req, "UPDATED_MAINTENANCE_STATUS", "maintenance_work_order", updated.id, { status });
    await evaluateMaintenanceAlerts(req, updated);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/operations-suite/targets", requireRoles(...leadership), async (req, res, next) => {
  try {
    const target = asNumber(req.body?.target);
    if (!req.body?.code || target === null) {
      res.status(400).json({ error: "KPI code and target are required." });
      return;
    }
    const factoryId = await getDemoFactoryId();
    const date = asDate(req.body?.productionDate);
    const shift = String(req.body?.shift || "ALL");
    const [existing] = await db.select().from(kpiTargets).where(and(eq(kpiTargets.factoryId, factoryId!), eq(kpiTargets.productionDate, date), eq(kpiTargets.shift, shift), eq(kpiTargets.code, String(req.body.code)))).limit(1);
    const [saved] = existing
      ? await db.update(kpiTargets).set({ target: target.toFixed(4), updatedAt: new Date() }).where(eq(kpiTargets.id, existing.id)).returning()
      : await db.insert(kpiTargets).values({
        factoryId: factoryId!,
        productionDate: date,
        shift,
        code: String(req.body.code),
        label: String(req.body.label || req.body.code),
        target: target.toFixed(4),
        unit: String(req.body.unit || ""),
        createdBy: req.user!.id,
        isDemo: true,
      }).returning();
    await recordAudit(req, existing ? "UPDATED_KPI_TARGET" : "CREATED_KPI_TARGET", "kpi_target", saved.id);
    res.status(existing ? 200 : 201).json(saved);
  } catch (error) {
    next(error);
  }
});

router.patch("/operations-suite/settings", requireRoles("ADMIN"), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    const [existing] = await db.select().from(factorySettings).where(eq(factorySettings.factoryId, factoryId!)).limit(1);
    const values = {
      season: String(req.body?.season || "2025-26").slice(0, 32),
      shiftConfig: Array.isArray(req.body?.shiftConfig) ? req.body.shiftConfig.slice(0, 12) : ["A", "B", "C", "GENERAL"],
      kpiThresholds: jsonObject(req.body?.kpiThresholds),
      targetDefaults: jsonObject(req.body?.targetDefaults),
      updatedBy: req.user!.id,
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await db.update(factorySettings).set(values).where(eq(factorySettings.id, existing.id)).returning()
      : await db.insert(factorySettings).values({ factoryId: factoryId!, ...values }).returning();
    await recordAudit(req, "UPDATED_FACTORY_SETTINGS", "factory_settings", saved.id);
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.patch("/operations-suite/alerts/:id/acknowledge", requireRoles(...leadership), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No demo factory has been configured." });
      return;
    }
    const [existing] = await db.select().from(operationalAlerts)
      .where(and(
        eq(operationalAlerts.id, String(req.params.id)),
        eq(operationalAlerts.factoryId, factoryId),
      ))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Alert not found." });
      return;
    }
    if (existing.status === "RESOLVED") {
      res.status(409).json({ error: "Resolved alerts cannot be acknowledged." });
      return;
    }
    if (existing.status === "ACKNOWLEDGED") {
      res.json(existing);
      return;
    }
    const [updated] = await db.update(operationalAlerts).set({
      status: "ACKNOWLEDGED",
      acknowledgedBy: req.user!.id,
      acknowledgedAt: new Date(),
    }).where(and(
      eq(operationalAlerts.id, existing.id),
      eq(operationalAlerts.factoryId, factoryId),
    )).returning();
    await recordAudit(req, "ACKNOWLEDGED_ALERT", "operational_alert", updated.id);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
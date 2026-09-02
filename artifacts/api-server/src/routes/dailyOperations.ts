import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { anomalies, dailyOperations, kpiValues, productionDays, trendPoints } from "@workspace/db";
import { getDemoFactoryId } from "../lib/demoData";
import { requireAuth } from "../middlewares/authMiddleware";
import { canEditSection } from "../lib/authz";
import { recordAudit } from "../lib/audit";
import { evaluateDailyOperationAlerts } from "../lib/operationalAlerts";

const router: IRouter = Router();

const asNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

function validateBody(body: Record<string, unknown>) {
  const production = asObject(body.production);
  const timeAccount = asObject(body.timeAccount);
  const caneCrushed = asNumber(production.caneCrushed);
  const sugarProduced = asNumber(production.sugarProduced);
  const availableHours = asNumber(timeAccount.availableHours);
  const hoursWorked = asNumber(timeAccount.hoursWorked);
  const errors: string[] = [];

  if (typeof body.productionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.productionDate)) {
    errors.push("Production date is required.");
  }
  if (caneCrushed !== null && caneCrushed < 0) errors.push("Cane crushed cannot be negative.");
  if (sugarProduced !== null && sugarProduced < 0) errors.push("Sugar produced cannot be negative.");
  if (caneCrushed !== null && caneCrushed === 0 && sugarProduced !== null && sugarProduced > 0) {
    errors.push("Sugar produced cannot be greater than zero when cane crushed is zero.");
  }
  if (availableHours !== null && hoursWorked !== null && hoursWorked > availableHours) {
    errors.push("Hours worked cannot exceed available hours.");
  }

  for (const stoppage of asArray(body.stoppages)) {
    const item = asObject(stoppage);
    if (item.startTime && item.endTime && String(item.endTime) <= String(item.startTime)) {
      errors.push("Every stoppage end time must be after its start time.");
      break;
    }
  }
  return { errors, production, timeAccount, caneCrushed, sugarProduced, availableHours, hoursWorked };
}

function calculatePayload(body: Record<string, unknown>, validation: ReturnType<typeof validateBody>) {
  const energy = asObject(body.energy);
  const efficiency = asObject(body.efficiency);
  const powerGenerated = asNumber(energy.powerGenerated ?? validation.production.powerGenerated);
  const powerUsed = asNumber(energy.powerUsed);
  const steamConsumption = asNumber(energy.steamConsumption);
  const recovery =
    validation.caneCrushed && validation.sugarProduced !== null
      ? (validation.sugarProduced / validation.caneCrushed) * 100
      : null;
  const hoursLost =
    validation.availableHours !== null && validation.hoursWorked !== null
      ? Math.max(0, validation.availableHours - validation.hoursWorked)
      : asNumber(validation.timeAccount.hoursLost);
  const powerExported =
    powerGenerated !== null && powerUsed !== null ? Math.max(0, powerGenerated - powerUsed) : null;
  const powerKwhPerMtCane =
    powerUsed !== null && validation.caneCrushed && validation.caneCrushed > 0
      ? powerUsed / validation.caneCrushed
      : asNumber(efficiency.powerKwhPerMtCane);
  const stoppages = asArray(body.stoppages).map((stoppage) => {
    const item = asObject(stoppage);
    const start = typeof item.startTime === "string" ? item.startTime : "";
    const end = typeof item.endTime === "string" ? item.endTime : "";
    const [startHours, startMinutes] = start.split(":").map(Number);
    const [endHours, endMinutes] = end.split(":").map(Number);
    let durationHours: number | null = null;
    if ([startHours, startMinutes, endHours, endMinutes].every(Number.isFinite)) {
      let minutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
      if (minutes < 0) minutes += 24 * 60;
      durationHours = minutes / 60;
    }
    return { ...item, durationHours };
  });
  const stoppageHours = stoppages.reduce(
    (total, item) => total + (asNumber(asObject(item).durationHours) ?? 0),
    0,
  );

  return {
    production: { ...validation.production, recovery },
    efficiency: { ...efficiency, powerKwhPerMtCane },
    timeAccount: { ...validation.timeAccount, hoursLost, stoppageHours },
    energy: { ...energy, powerGenerated, powerUsed, powerExported, steamConsumption },
    quality: asObject(body.quality),
    stoppages,
    materials: asArray(body.materials),
  };
}

async function upsertCanonicalKpi(
  factoryId: string,
  productionDayId: string,
  code: string,
  label: string,
  value: number | null,
  unit: string,
  status: string,
) {
  const [existing] = await db
    .select({ id: kpiValues.id })
    .from(kpiValues)
    .where(and(eq(kpiValues.productionDayId, productionDayId), eq(kpiValues.code, code)))
    .limit(1);
  const data = {
    factoryId,
    productionDayId,
    code,
    label,
    value: value === null ? null : value.toFixed(2),
    unit,
    status,
    comparisonLabel: "vs yesterday",
    comparisonValue: null,
    sourceCount: 1,
  };
  if (existing) {
    await db.update(kpiValues).set(data).where(eq(kpiValues.id, existing.id));
  } else {
    await db.insert(kpiValues).values(data);
  }
}

async function refreshSubmittedComparisons(factoryId: string, productionDate: string) {
  const days = await db
    .select()
    .from(productionDays)
    .where(eq(productionDays.factoryId, factoryId))
    .orderBy(asc(productionDays.productionDate));
  const currentDayIndex = days.findIndex((day) => day.productionDate === productionDate);
  const currentDay = days[currentDayIndex];
  if (!currentDay) return;
  const previousDay = currentDayIndex > 0 ? days[currentDayIndex - 1] : undefined;
  const currentRows = await db
    .select()
    .from(kpiValues)
    .where(and(eq(kpiValues.factoryId, factoryId), eq(kpiValues.productionDayId, currentDay.id)));
  const previousRows = previousDay
    ? await db
        .select()
        .from(kpiValues)
        .where(and(eq(kpiValues.factoryId, factoryId), eq(kpiValues.productionDayId, previousDay.id)))
    : [];
  const baselines: Record<string, number> = {
    recovery: 9.72,
    downtime: 9.1,
    power_generated: 11910,
    steam_consumption: 3.24,
  };
  for (const row of currentRows) {
    if (row.value === null) continue;
    const current = Number(row.value);
    const previous = previousRows.find((candidate) => candidate.code === row.code);
    const comparison =
      row.code === "cane_crushed" || row.code === "sugar_produced"
        ? previous?.value === null || previous?.value === undefined
          ? null
          : current - Number(previous.value)
        : baselines[row.code] === undefined
          ? null
          : current - baselines[row.code];
    await db
      .update(kpiValues)
      .set({ comparisonValue: comparison === null ? null : comparison.toFixed(2) })
      .where(eq(kpiValues.id, row.id));
  }
}

router.get("/daily-operations/:productionDate", requireAuth, async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const shift = typeof req.query.shift === "string" ? req.query.shift : "GENERAL";
    const [record] = await db
      .select()
      .from(dailyOperations)
      .where(
        and(
          eq(dailyOperations.factoryId, factoryId),
          eq(dailyOperations.productionDate, String(req.params.productionDate)),
          eq(dailyOperations.shift, shift),
        ),
      )
      .limit(1);
    res.json(record ?? null);
  } catch (error) {
    next(error);
  }
});

router.post("/daily-operations", requireAuth, async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const actor = req.user;
    const body = asObject(req.body);
    const shift = typeof body.shift === "string" && body.shift ? body.shift : "GENERAL";
    const [existingRecord] = await db
      .select()
      .from(dailyOperations)
      .where(
        and(
          eq(dailyOperations.factoryId, factoryId),
          eq(dailyOperations.productionDate, body.productionDate as string),
          eq(dailyOperations.shift, shift),
        ),
      )
      .limit(1);

    if (
      existingRecord?.status === "APPROVED" &&
      actor.role !== "MANAGER" &&
      actor.role !== "ADMIN"
    ) {
      res.status(409).json({ error: "Approved records cannot be edited by operators." });
      return;
    }

    const scopedBody = {
      ...body,
      production: canEditSection(actor, "production")
        ? body.production
        : existingRecord?.production ?? {},
      quality: canEditSection(actor, "quality")
        ? body.quality
        : existingRecord?.quality ?? {},
      efficiency: canEditSection(actor, "engineering")
        ? body.efficiency
        : existingRecord?.efficiency ?? {},
      timeAccount: canEditSection(actor, "engineering")
        ? body.timeAccount
        : existingRecord?.timeAccount ?? {},
      stoppages: canEditSection(actor, "engineering")
        ? body.stoppages
        : existingRecord?.stoppages ?? [],
      energy: canEditSection(actor, "engineering")
        ? body.energy
        : existingRecord?.energy ?? {},
      materials: canEditSection(actor, "stores")
        ? body.materials
        : existingRecord?.materials ?? [],
    };
    const validation = validateBody(scopedBody);
    if (validation.errors.length) {
      res.status(400).json({ error: "Validation failed", issues: validation.errors });
      return;
    }

    const status = body.status === "SUBMITTED" ? "SUBMITTED" : "DRAFT";
    const submittedBy =
      status === "SUBMITTED" ? actor.id : existingRecord?.submittedBy ?? null;
    const calculated = calculatePayload(scopedBody, validation);
    const now = new Date();
    const [record] = await db
      .insert(dailyOperations)
      .values({
        factoryId,
        productionDate: body.productionDate as string,
        season: typeof body.season === "string" ? body.season : "2025-26",
        shift,
        status,
        source: "MANUAL_ENTRY",
        submittedBy,
        submittedAt: status === "SUBMITTED" ? now : null,
        production: calculated.production,
        quality: calculated.quality,
        efficiency: calculated.efficiency,
        timeAccount: calculated.timeAccount,
        stoppages: calculated.stoppages,
        energy: calculated.energy,
        materials: calculated.materials,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          dailyOperations.factoryId,
          dailyOperations.productionDate,
          dailyOperations.shift,
        ],
        set: {
          season: typeof body.season === "string" ? body.season : "2025-26",
          status,
          source: "MANUAL_ENTRY",
          submittedBy,
          submittedAt: status === "SUBMITTED" ? now : null,
          production: calculated.production,
          quality: calculated.quality,
          efficiency: calculated.efficiency,
          timeAccount: calculated.timeAccount,
          stoppages: calculated.stoppages,
          energy: calculated.energy,
          materials: calculated.materials,
          updatedAt: now,
        },
      })
      .returning();

    await recordAudit(
      req,
      status === "SUBMITTED" ? "SUBMITTED_DAILY_RECORD" : "SAVED_DAILY_RECORD",
      "daily_operations",
      record.id,
      { productionDate: record.productionDate, shift: record.shift, status },
    );

    if (status === "SUBMITTED") {
      let [day] = await db
        .select()
        .from(productionDays)
        .where(
          and(
            eq(productionDays.factoryId, factoryId),
            eq(productionDays.productionDate, body.productionDate as string),
          ),
        )
        .limit(1);
      if (!day) {
        [day] = await db
          .insert(productionDays)
          .values({
            factoryId,
            productionDate: body.productionDate as string,
            dataStatus: "COMPLETE",
          })
          .returning();
      } else {
        await db
          .update(productionDays)
          .set({ dataStatus: "COMPLETE" })
          .where(eq(productionDays.id, day.id));
      }

      const production = calculated.production as Record<string, number | null>;
      const energy = calculated.energy as Record<string, number | null>;
      const timeAccount = calculated.timeAccount as Record<string, number | null>;
      await upsertCanonicalKpi(factoryId, day.id, "cane_crushed", "Cane Crushed", asNumber(production.caneCrushed), "t", "GOOD");
      await upsertCanonicalKpi(factoryId, day.id, "sugar_produced", "Sugar Produced", asNumber(production.sugarProduced), "t", "GOOD");
      await upsertCanonicalKpi(factoryId, day.id, "recovery", "Recovery", asNumber(production.recovery), "%", asNumber(production.recovery) !== null && asNumber(production.recovery)! < 9.4 ? "CRITICAL" : "GOOD");
      await upsertCanonicalKpi(factoryId, day.id, "downtime", "Downtime", asNumber(timeAccount.hoursLost), "h", asNumber(timeAccount.hoursLost) !== null && asNumber(timeAccount.hoursLost)! > 10 ? "WATCH" : "GOOD");
      await upsertCanonicalKpi(factoryId, day.id, "power_generated", "Power Generated", asNumber(energy.powerGenerated), "kWh", "GOOD");
      await upsertCanonicalKpi(factoryId, day.id, "steam_consumption", "Steam Consumption", asNumber(energy.steamConsumption), "t/t cane", "GOOD");

      const recovery = asNumber(production.recovery);
      const caneCrushed = asNumber(production.caneCrushed);
      const downtime = asNumber(timeAccount.hoursLost);
      const [trend] = await db
        .select({ id: trendPoints.id })
        .from(trendPoints)
        .where(
          and(
            eq(trendPoints.factoryId, factoryId),
            eq(trendPoints.productionDate, body.productionDate as string),
          ),
        )
        .limit(1);
      const trendData = {
        factoryId,
        productionDate: body.productionDate as string,
        recovery: recovery?.toFixed(2) ?? null,
        caneCrushed: caneCrushed?.toFixed(2) ?? null,
        downtime: downtime?.toFixed(2) ?? null,
      };
      if (trend) await db.update(trendPoints).set(trendData).where(eq(trendPoints.id, trend.id));
      else await db.insert(trendPoints).values(trendData);

      await refreshSubmittedComparisons(factoryId, body.productionDate as string);
      await evaluateDailyOperationAlerts(req, {
        factoryId,
        productionDate: body.productionDate as string,
        sourceEntityId: record.id,
        values: {
          cane_crushed: asNumber(production.caneCrushed),
          sugar_produced: asNumber(production.sugarProduced),
          recovery: asNumber(production.recovery),
          downtime: asNumber(timeAccount.hoursLost),
          power_generated: asNumber(energy.powerGenerated),
          steam_consumption: asNumber(energy.steamConsumption),
        },
      });
      await db.delete(anomalies).where(
        and(eq(anomalies.factoryId, factoryId), eq(anomalies.productionDayId, day.id)),
      );
      const recoveryValue = asNumber(production.recovery);
      const downtimeValue = asNumber(timeAccount.hoursLost);
      const anomalyRows = [];
      if (recoveryValue !== null && recoveryValue < 9.4) {
        anomalyRows.push({
          factoryId,
          productionDayId: day.id,
          kpiCode: "recovery",
          severity: "CRITICAL",
          title: "Recovery below baseline",
          detail: "Submitted recovery is below the configured review threshold.",
          acknowledged: false,
        });
      }
      if (downtimeValue !== null && downtimeValue > 10) {
        anomalyRows.push({
          factoryId,
          productionDayId: day.id,
          kpiCode: "downtime",
          severity: "WARNING",
          title: "Downtime above baseline",
          detail: "Submitted hours lost are above the configured review threshold.",
          acknowledged: false,
        });
      }
      if (anomalyRows.length) await db.insert(anomalies).values(anomalyRows);
    }

    res.status(200).json(record);
  } catch (error) {
    next(error);
  }
});

export default router;
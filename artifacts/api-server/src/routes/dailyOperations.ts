import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { dailyOperations, kpiValues, productionDays, trendPoints } from "@workspace/db";
import { getDemoFactoryId } from "../lib/demoData";
import { requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();
router.use(requireAuth);

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

  return {
    production: { ...validation.production, recovery },
    efficiency: { ...efficiency, powerKwhPerMtCane },
    timeAccount: { ...validation.timeAccount, hoursLost },
    energy: { ...energy, powerGenerated, powerUsed, powerExported, steamConsumption },
    quality: asObject(body.quality),
    stoppages: asArray(body.stoppages),
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

router.get("/daily-operations/:productionDate", async (req, res, next) => {
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
          eq(dailyOperations.productionDate, req.params.productionDate),
          eq(dailyOperations.shift, shift),
        ),
      )
      .limit(1);
    res.json(record ?? null);
  } catch (error) {
    next(error);
  }
});

router.post("/daily-operations", async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const body = asObject(req.body);
    const validation = validateBody(body);
    if (validation.errors.length) {
      res.status(400).json({ error: "Validation failed", issues: validation.errors });
      return;
    }

    const status = body.status === "SUBMITTED" ? "SUBMITTED" : "DRAFT";
    const shift = typeof body.shift === "string" && body.shift ? body.shift : "GENERAL";
    const calculated = calculatePayload(body, validation);
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
        submittedBy: status === "SUBMITTED" ? req.user.id : null,
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
          submittedBy: status === "SUBMITTED" ? req.user.id : null,
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
    }

    res.status(200).json(record);
  } catch (error) {
    next(error);
  }
});

export default router;
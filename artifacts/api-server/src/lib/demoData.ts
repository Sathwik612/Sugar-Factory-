import { and, asc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  anomalies,
  factories,
  kpiValues,
  lineageReferences,
  processingEvents,
  productionDays,
  sourceFiles,
  trendPoints,
  validationIssues,
} from "@workspace/db";

const dates = [
  "2026-08-01",
  "2026-08-02",
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
  "2026-08-30",
];

const sourceTemplates = [
  ["production_30082026.xlsx", "Production", "PROCESSED", 184320, 0],
  ["cane_crushing_30082026.xlsx", "Cane Crushing", "PROCESSED", 92304, 0],
  ["recovery_30082026.xlsx", "Recovery", "WARNING", 142880, 1],
  ["power_steam_30082026.xlsx", "Power & Steam", "PROCESSED", 210442, 0],
  ["downtime_30082026.xlsx", "Downtime", "FAILED", 80412, 2],
] as const;

export async function seedDemoData() {
  const existing = await db
    .select({ id: factories.id })
    .from(factories)
    .where(eq(factories.isDemo, true))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(factories)
      .set({ name: "Bilagi Sugar Mill Ltd. — Badagandi" })
      .where(eq(factories.id, existing[0].id));
    await extendDemoHistory(existing[0].id);
    await refreshDemoComparisons(existing[0].id);
    return existing[0].id;
  }

  const [factory] = await db
    .insert(factories)
    .values({
      name: "Bilagi Sugar Mill Ltd. — Badagandi",
      timezone: "Asia/Kolkata",
      isDemo: true,
    })
    .returning({ id: factories.id });

  const dayRows = await db
    .insert(productionDays)
    .values(
      dates.map((productionDate, index) => ({
        factoryId: factory.id,
        productionDate,
        dataStatus: index === dates.length - 1 ? "PARTIAL" : "COMPLETE",
      })),
    )
    .returning({ id: productionDays.id, productionDate: productionDays.productionDate });

  const dayByDate = new Map(dayRows.map((day) => [day.productionDate, day.id]));
  const currentDate = dates[dates.length - 1];
  const latestDayId = dayByDate.get(currentDate)!;

  const kpiRows = dates.flatMap((productionDate, index) => {
    const caneCrushed = 6980 + index * 42 + (index % 2 ? -76 : 54);
    const sugarProduced = 674 + index * 4.2 + (index === dates.length - 1 ? -16 : 0);
    const recovery = (sugarProduced / caneCrushed) * 100;
    const downtime = 8.4 + (index % 3) * 0.7 + (index === dates.length - 1 ? 2.5 : 0);
    const powerGenerated = 11840 + index * 95 - (index === dates.length - 1 ? 620 : 0);
    const steamConsumption = 3.18 + (index % 2) * 0.06 + (index === dates.length - 1 ? 0.28 : 0);
    const dayId = dayByDate.get(productionDate)!;
    const previousCane = index > 0 ? 6980 + (index - 1) * 42 + ((index - 1) % 2 ? -76 : 54) : null;
    const previousSugar = index > 0 ? 674 + (index - 1) * 4.2 : null;

    return [
      {
        factoryId: factory.id,
        productionDayId: dayId,
        code: "cane_crushed",
        label: "Cane Crushed",
        value: caneCrushed.toFixed(2),
        unit: "t",
        status: "GOOD",
        comparisonLabel: "vs yesterday",
        comparisonValue: previousCane === null ? null : (caneCrushed - previousCane).toFixed(2),
        sourceCount: 1,
      },
      {
        factoryId: factory.id,
        productionDayId: dayId,
        code: "sugar_produced",
        label: "Sugar Produced",
        value: sugarProduced.toFixed(2),
        unit: "t",
        status: index === dates.length - 1 ? "WATCH" : "GOOD",
        comparisonLabel: "vs yesterday",
        comparisonValue: previousSugar === null ? null : (sugarProduced - previousSugar).toFixed(2),
        sourceCount: 1,
      },
      {
        factoryId: factory.id,
        productionDayId: dayId,
        code: "recovery",
        label: "Recovery",
        value: recovery.toFixed(2),
        unit: "%",
        status: index === dates.length - 1 ? "CRITICAL" : "GOOD",
        comparisonLabel: "vs 7-day avg",
        comparisonValue: (recovery - 9.72).toFixed(2),
        sourceCount: 2,
      },
      {
        factoryId: factory.id,
        productionDayId: dayId,
        code: "downtime",
        label: "Downtime",
        value: downtime.toFixed(2),
        unit: "h",
        status: index === dates.length - 1 ? "CRITICAL" : "GOOD",
        comparisonLabel: "vs 7-day avg",
        comparisonValue: (downtime - 9.1).toFixed(2),
        sourceCount: 1,
      },
      {
        factoryId: factory.id,
        productionDayId: dayId,
        code: "power_generated",
        label: "Power Generated",
        value: powerGenerated.toFixed(2),
        unit: "kWh",
        status: index === dates.length - 1 ? "WATCH" : "GOOD",
        comparisonLabel: "vs 7-day avg",
        comparisonValue: (powerGenerated - 11910).toFixed(2),
        sourceCount: 1,
      },
      {
        factoryId: factory.id,
        productionDayId: dayId,
        code: "steam_consumption",
        label: "Steam Consumption",
        value: steamConsumption.toFixed(2),
        unit: "t/t cane",
        status: index === dates.length - 1 ? "WATCH" : "GOOD",
        comparisonLabel: "vs 7-day avg",
        comparisonValue: (steamConsumption - 3.24).toFixed(2),
        sourceCount: 1,
      },
    ];
  });

  await db.insert(kpiValues).values(kpiRows);
  await db.insert(trendPoints).values(
    dates.map((productionDate, index) => ({
      factoryId: factory.id,
      productionDate,
      recovery: (9.58 + index * 0.035 - (index === dates.length - 1 ? 0.18 : 0)).toFixed(2),
      caneCrushed: (6980 + index * 42 + (index % 2 ? -76 : 54)).toFixed(2),
      downtime: (8.4 + (index % 3) * 0.7 + (index === dates.length - 1 ? 2.5 : 0)).toFixed(2),
    })),
  );

  const sourceRows = await db
    .insert(sourceFiles)
    .values(
      sourceTemplates.map(([filename, reportType, status, sizeBytes, issueCount], index) => ({
        factoryId: factory.id,
        filename,
        reportType,
        reportingDate: currentDate,
        status,
        sizeBytes,
        sha256: `demo-${index + 1}-${filename.replace(/[^a-z0-9]/gi, "").toLowerCase()}`,
        synthetic: true,
        issueCount,
      })),
    )
    .returning({ id: sourceFiles.id, filename: sourceFiles.filename });

  const sourceByName = new Map(sourceRows.map((source) => [source.filename, source.id]));
  for (const source of sourceRows) {
    await db.insert(processingEvents).values([
      { sourceFileId: source.id, status: "RECEIVED", note: "Synthetic fixture received" },
      { sourceFileId: source.id, status: "HASHED", note: "SHA-256 recorded" },
      {
        sourceFileId: source.id,
        status: source.filename.startsWith("downtime") ? "FAILED" : "PROCESSED",
        note: source.filename.startsWith("downtime")
          ? "Two rows could not be normalized"
          : "Canonical records stored",
      },
    ]);
  }

  const failedSourceId = sourceByName.get("downtime_30082026.xlsx")!;
  await db.insert(validationIssues).values([
    {
      sourceFileId: failedSourceId,
      severity: "ERROR",
      code: "MISSING_UNIT",
      message: "Downtime unit was not declared in the workbook.",
      location: "Downtime!H18",
    },
    {
      sourceFileId: failedSourceId,
      severity: "WARNING",
      code: "UNUSUAL_VALUE",
      message: "One downtime entry is above the configured daily review range.",
      location: "Downtime!H22",
    },
  ]);

  await db.insert(anomalies).values([
    {
      factoryId: factory.id,
      productionDayId: latestDayId,
      kpiCode: "recovery",
      severity: "CRITICAL",
      title: "Recovery below baseline",
      detail: "Recovery is 1.9% below the available 7-day average. Review the recovery workbook and cane quality inputs.",
      acknowledged: false,
    },
    {
      factoryId: factory.id,
      productionDayId: latestDayId,
      kpiCode: "downtime",
      severity: "WARNING",
      title: "Downtime above baseline",
      detail: "Downtime is 2.5 hours above the available 7-day average.",
      acknowledged: false,
    },
    {
      factoryId: factory.id,
      productionDayId: latestDayId,
      kpiCode: "power_generated",
      severity: "WARNING",
      title: "Power generation lower than usual",
      detail: "Power generation is below the available 7-day average. The power workbook is available for review.",
      acknowledged: false,
    },
  ]);

  await db.insert(lineageReferences).values([
    {
      factoryId: factory.id,
      productionDayId: latestDayId,
      kpiCode: "recovery",
      canonicalField: "sugar_produced",
      fileId: sourceByName.get("production_30082026.xlsx")!,
      sheet: "Production",
      sourceRow: 12,
      sourceColumn: "F",
      rawValue: "658.00",
      formula: "Sugar Produced / Cane Crushed × 100",
    },
    {
      factoryId: factory.id,
      productionDayId: latestDayId,
      kpiCode: "recovery",
      canonicalField: "cane_crushed",
      fileId: sourceByName.get("cane_crushing_30082026.xlsx")!,
      sheet: "Crushing",
      sourceRow: 12,
      sourceColumn: "D",
      rawValue: "7210.00",
      formula: "Sugar Produced / Cane Crushed × 100",
    },
    {
      factoryId: factory.id,
      productionDayId: latestDayId,
      kpiCode: "downtime",
      canonicalField: "downtime",
      fileId: failedSourceId,
      sheet: "Downtime",
      sourceRow: 22,
      sourceColumn: "H",
      rawValue: "11.90",
      formula: "Sum of validated downtime hours",
    },
  ]);

  return factory.id;
}

async function extendDemoHistory(factoryId: string) {
  const existingDays = await db
    .select({ id: productionDays.id, productionDate: productionDays.productionDate })
    .from(productionDays)
    .where(eq(productionDays.factoryId, factoryId));
  const existingDates = new Set(existingDays.map((day) => day.productionDate));
  const missingDates = dates.filter((productionDate) => !existingDates.has(productionDate));
  if (!missingDates.length) return;

  const dayRows = await db
    .insert(productionDays)
    .values(
      missingDates.map((productionDate) => ({
        factoryId,
        productionDate,
        dataStatus: "COMPLETE",
      })),
    )
    .returning({ id: productionDays.id, productionDate: productionDays.productionDate });

  const dayByDate = new Map(dayRows.map((day) => [day.productionDate, day.id]));
  const kpiRows = missingDates.flatMap((productionDate) => {
    const index = dates.indexOf(productionDate);
    const caneCrushed = 6980 + index * 42 + (index % 2 ? -76 : 54);
    const sugarProduced = 674 + index * 4.2;
    const recovery = (sugarProduced / caneCrushed) * 100;
    const downtime = 8.4 + (index % 3) * 0.7;
    const powerGenerated = 11840 + index * 95;
    const steamConsumption = 3.18 + (index % 2) * 0.06;
    const dayId = dayByDate.get(productionDate)!;
    return [
      { factoryId, productionDayId: dayId, code: "cane_crushed", label: "Cane Crushed", value: caneCrushed.toFixed(2), unit: "t", status: "GOOD", comparisonLabel: "vs yesterday", comparisonValue: null, sourceCount: 1 },
      { factoryId, productionDayId: dayId, code: "sugar_produced", label: "Sugar Produced", value: sugarProduced.toFixed(2), unit: "t", status: "GOOD", comparisonLabel: "vs yesterday", comparisonValue: null, sourceCount: 1 },
      { factoryId, productionDayId: dayId, code: "recovery", label: "Recovery", value: recovery.toFixed(2), unit: "%", status: "GOOD", comparisonLabel: "vs 7-day avg", comparisonValue: null, sourceCount: 2 },
      { factoryId, productionDayId: dayId, code: "downtime", label: "Downtime", value: downtime.toFixed(2), unit: "h", status: "GOOD", comparisonLabel: "vs 7-day avg", comparisonValue: null, sourceCount: 1 },
      { factoryId, productionDayId: dayId, code: "power_generated", label: "Power Generated", value: powerGenerated.toFixed(2), unit: "kWh", status: "GOOD", comparisonLabel: "vs 7-day avg", comparisonValue: null, sourceCount: 1 },
      { factoryId, productionDayId: dayId, code: "steam_consumption", label: "Steam Consumption", value: steamConsumption.toFixed(2), unit: "t/t cane", status: "GOOD", comparisonLabel: "vs 7-day avg", comparisonValue: null, sourceCount: 1 },
    ];
  });
  await db.insert(kpiValues).values(kpiRows);
  await db.insert(trendPoints).values(
    missingDates.map((productionDate) => {
      const index = dates.indexOf(productionDate);
      return {
        factoryId,
        productionDate,
        recovery: (9.58 + index * 0.035).toFixed(2),
        caneCrushed: (6980 + index * 42 + (index % 2 ? -76 : 54)).toFixed(2),
        downtime: (8.4 + (index % 3) * 0.7).toFixed(2),
      };
    }),
  );
}

async function refreshDemoComparisons(factoryId: string) {
  const days = await db
    .select()
    .from(productionDays)
    .where(eq(productionDays.factoryId, factoryId))
    .orderBy(asc(productionDays.productionDate));
  const dayIndexById = new Map(days.map((day, index) => [day.id, index]));
  const rows = await db.select().from(kpiValues).where(eq(kpiValues.factoryId, factoryId));

  for (const row of rows) {
    const currentValue = row.value === null ? null : Number(row.value);
    if (currentValue === null) continue;
    const index = dayIndexById.get(row.productionDayId) ?? 0;
    const previousDay = index > 0 ? days[index - 1] : undefined;
    const previous = previousDay
      ? rows.find(
          (candidate) =>
            candidate.productionDayId === previousDay.id && candidate.code === row.code,
        )
      : undefined;
    const baselineByCode: Record<string, number> = {
      recovery: 9.72,
      downtime: 9.1,
      power_generated: 11910,
      steam_consumption: 3.24,
    };
    const comparison =
      row.code === "cane_crushed" || row.code === "sugar_produced"
        ? previous?.value === null || previous?.value === undefined
          ? null
          : currentValue - Number(previous.value)
        : baselineByCode[row.code] === undefined
          ? null
          : currentValue - baselineByCode[row.code];
    await db
      .update(kpiValues)
      .set({ comparisonValue: comparison === null ? null : comparison.toFixed(2) })
      .where(eq(kpiValues.id, row.id));
  }
}

export async function getDemoFactoryId() {
  const factory = await db
    .select({ id: factories.id })
    .from(factories)
    .where(eq(factories.isDemo, true))
    .limit(1);
  return factory[0]?.id ?? null;
}

export async function getProductionDay(factoryId: string, productionDate?: string) {
  const rows = await db
    .select()
    .from(productionDays)
    .where(
      productionDate
        ? and(eq(productionDays.factoryId, factoryId), eq(productionDays.productionDate, productionDate))
        : eq(productionDays.factoryId, factoryId),
    )
    .orderBy(asc(productionDays.productionDate))
    .limit(productionDate ? 1 : 100);
  return productionDate ? rows[0] : rows[rows.length - 1];
}
import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { GetDailyReportLineageResponse, GetDailyReportResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  anomalies,
  factories,
  kpiValues,
  lineageReferences,
  productionDays,
  sourceFiles,
} from "@workspace/db";
import { getDemoFactoryId } from "../lib/demoData";
import { requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();
router.use(requireAuth);

const toNumber = (value: string | null) => (value === null ? null : Number(value));

router.get("/reports/daily/:productionDate", async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const day = (await db
      .select()
      .from(productionDays)
      .where(
        and(
          eq(productionDays.factoryId, factoryId),
          eq(productionDays.productionDate, req.params.productionDate),
        ),
      )
      .limit(1))[0];
    if (!day) {
      res.status(404).json({ error: "Report not available for this production date." });
      return;
    }
    const factory = (await db.select().from(factories).where(eq(factories.id, factoryId)).limit(1))[0];
    const days = await db
      .select()
      .from(productionDays)
      .where(eq(productionDays.factoryId, factoryId))
      .orderBy(asc(productionDays.productionDate));
    const dayIndex = days.findIndex((candidate) => candidate.id === day.id);
    const previousDay = dayIndex > 0 ? days[dayIndex - 1] : undefined;
    const [kpis, previousKpis, exceptions, lineage, files] = await Promise.all([
      db.select().from(kpiValues).where(eq(kpiValues.productionDayId, day.id)).orderBy(asc(kpiValues.code)),
      previousDay
        ? db.select().from(kpiValues).where(eq(kpiValues.productionDayId, previousDay.id))
        : Promise.resolve([]),
      db.select().from(anomalies).where(eq(anomalies.productionDayId, day.id)),
      db.select().from(lineageReferences).where(eq(lineageReferences.productionDayId, day.id)),
      db.select().from(sourceFiles).where(eq(sourceFiles.factoryId, factoryId)),
    ]);
    const previousByCode = new Map(previousKpis.map((kpi) => [kpi.code, kpi.value]));
    const fileNames = new Map(files.map((file) => [file.id, file.filename]));
    const report = {
      id: `report-${day.productionDate}`,
      factory: factory.name,
      productionDate: day.productionDate,
      reportVersion: "phase-1-demo.1",
      generatedAt: new Date().toISOString(),
      executiveSummary:
        "Production data is available with a partial-data flag. Recovery and downtime are the priority exceptions for manager review.",
      scorecard: kpis.map((kpi) => ({
        code: kpi.code,
        label: kpi.label,
        today: toNumber(kpi.value),
        unit: kpi.unit,
        yesterday: toNumber(previousByCode.get(kpi.code) ?? null),
        baseline: kpi.code === "recovery" ? 9.72 : kpi.code === "downtime" ? 9.1 : null,
        baselineLabel: kpi.comparisonLabel,
        status: kpi.status,
      })),
      exceptions: exceptions.map((item) => ({
        id: item.id,
        severity: item.severity,
        title: item.title,
        detail: item.detail,
        kpiCode: item.kpiCode,
        acknowledged: item.acknowledged,
      })),
      downtime: [
        { label: "Mill stoppage", hours: 5.2, share: 0.437 },
        { label: "Boiler interruption", hours: 3.7, share: 0.311 },
        { label: "Changeover", hours: 3.0, share: 0.252 },
      ],
      sources: lineage.map((item) => ({
        kpiCode: item.kpiCode,
        canonicalField: item.canonicalField,
        fileId: item.fileId,
        filename: fileNames.get(item.fileId) ?? "source workbook",
        sheet: item.sheet,
        sourceRow: item.sourceRow,
        sourceColumn: item.sourceColumn,
        rawValue: item.rawValue,
        formula: item.formula,
      })),
    };
    res.json(GetDailyReportResponse.parse(report));
  } catch (error) {
    next(error);
  }
});

router.get("/reports/daily/:productionDate/lineage", async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    const day = factoryId
      ? (await db
          .select()
          .from(productionDays)
          .where(eq(productionDays.productionDate, req.params.productionDate))
          .limit(1))[0]
      : undefined;
    if (!day) {
      res.status(404).json({ error: "Lineage is not available for this production date." });
      return;
    }
    const rows = await db.select().from(lineageReferences).where(eq(lineageReferences.productionDayId, day.id));
    res.json(
      GetDailyReportLineageResponse.parse(
        rows.map((item) => ({
          kpiCode: item.kpiCode,
          canonicalField: item.canonicalField,
          fileId: item.fileId,
          filename: "source workbook",
          sheet: item.sheet,
          sourceRow: item.sourceRow,
          sourceColumn: item.sourceColumn,
          rawValue: item.rawValue,
          formula: item.formula,
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
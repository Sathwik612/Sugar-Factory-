import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { GetDashboardQueryParams, GetDashboardResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { anomalies, factories, kpiValues, sourceFiles, trendPoints } from "@workspace/db";
import { getDemoFactoryId, getProductionDay } from "../lib/demoData";

const router: IRouter = Router();

const numberOrNull = (value: string | number | null) =>
  value === null ? null : Number(value);

router.get("/dashboard", async (req, res, next) => {
  try {
    const params = GetDashboardQueryParams.parse(req.query);
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const factory = (await db.select().from(factories).where(eq(factories.id, factoryId)).limit(1))[0];
    const day = await getProductionDay(
      factoryId,
      params.date ? params.date.toISOString().slice(0, 10) : undefined,
    );
    if (!day) {
      res.status(404).json({ error: "No production day is available." });
      return;
    }

    const [kpis, exceptions, trend] = await Promise.all([
      db.select().from(kpiValues).where(eq(kpiValues.productionDayId, day.id)).orderBy(asc(kpiValues.code)),
      db.select().from(anomalies).where(eq(anomalies.productionDayId, day.id)).orderBy(desc(anomalies.severity)),
      db.select().from(trendPoints).where(eq(trendPoints.factoryId, factoryId)).orderBy(asc(trendPoints.productionDate)),
    ]);

    const sourceRows = await db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.factoryId, factoryId));
    const result = {
      factory: factory.name,
      productionDate: day.productionDate,
      dataStatus: day.dataStatus,
      kpis: kpis.map((kpi) => ({
        code: kpi.code,
        label: kpi.label,
        value: numberOrNull(kpi.value),
        unit: kpi.unit,
        status: kpi.status,
        comparisonLabel: kpi.comparisonLabel,
        comparisonValue: numberOrNull(kpi.comparisonValue),
        available: kpi.value !== null,
        sourceCount: kpi.sourceCount,
      })),
      exceptions: exceptions.map((item) => ({
        id: item.id,
        severity: item.severity,
        title: item.title,
        detail: item.detail,
        kpiCode: item.kpiCode,
        acknowledged: item.acknowledged,
      })),
      trend: trend.map((point) => ({
        date: point.productionDate,
        recovery: numberOrNull(point.recovery),
        caneCrushed: numberOrNull(point.caneCrushed),
        downtime: numberOrNull(point.downtime),
      })),
      ingestion: {
        processed: sourceRows.filter((file) => file.status === "PROCESSED").length,
        warnings: sourceRows.filter((file) => file.status === "WARNING").length,
        failed: sourceRows.filter((file) => file.status === "FAILED").length,
        lastUpdated: new Date().toISOString(),
      },
    };
    res.json(GetDashboardResponse.parse(result));
  } catch (error) {
    next(error);
  }
});

export default router;
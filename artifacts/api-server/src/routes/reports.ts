import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { GetDailyReportLineageResponse, GetDailyReportResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  anomalies,
  dailyOperations,
  factories,
  kpiValues,
  lineageReferences,
  productionDays,
  sourceFiles,
} from "@workspace/db";
import { getDemoFactoryId } from "../lib/demoData";
import { requireRoles } from "../lib/authz";

const router: IRouter = Router();

const toNumber = (value: string | null) => (value === null ? null : Number(value));

router.get("/reports/daily/:productionDate", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
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
          eq(productionDays.productionDate, String(req.params.productionDate)),
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
    const [kpis, previousKpis, exceptions, lineage, files, historicalKpis, operation] = await Promise.all([
      db.select().from(kpiValues).where(eq(kpiValues.productionDayId, day.id)).orderBy(asc(kpiValues.code)),
      previousDay
        ? db.select().from(kpiValues).where(eq(kpiValues.productionDayId, previousDay.id))
        : Promise.resolve([]),
      db.select().from(anomalies).where(eq(anomalies.productionDayId, day.id)),
      db.select().from(lineageReferences).where(eq(lineageReferences.productionDayId, day.id)),
      db.select().from(sourceFiles).where(eq(sourceFiles.factoryId, factoryId)),
      db.select().from(kpiValues).where(eq(kpiValues.factoryId, factoryId)),
      db.select().from(dailyOperations).where(and(
        eq(dailyOperations.factoryId, factoryId),
        eq(dailyOperations.productionDate, day.productionDate),
      )).orderBy(desc(dailyOperations.updatedAt)).limit(1),
    ]);
    const previousByCode = new Map(previousKpis.map((kpi) => [kpi.code, kpi.value]));
    const fileNames = new Map(files.map((file) => [file.id, file.filename]));
    const historyByCode = new Map<string, number[]>();
    for (const historical of historicalKpis) {
      const numeric = toNumber(historical.value);
      if (numeric === null) continue;
      const values = historyByCode.get(historical.code) ?? [];
      values.push(numeric);
      historyByCode.set(historical.code, values);
    }
    const canonicalOperation = operation[0];
    const stoppages = canonicalOperation && Array.isArray(canonicalOperation.stoppages)
      ? canonicalOperation.stoppages.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
    const stoppageTotal = stoppages.reduce((total, item) => {
      const duration = Number(item.durationHours);
      return total + (Number.isFinite(duration) ? duration : 0);
    }, 0);
    const report = {
      id: `report-${day.productionDate}`,
      factory: factory.name,
      productionDate: day.productionDate,
      reportVersion: "phase-1.1",
      generatedAt: new Date().toISOString(),
      executiveSummary:
        "Production data is available with a partial-data flag. Recovery and downtime are the priority exceptions for manager review.",
      scorecard: kpis.map((kpi) => ({
        code: kpi.code,
        label: kpi.label,
        today: toNumber(kpi.value),
        unit: kpi.unit,
        yesterday: toNumber(previousByCode.get(kpi.code) ?? null),
         baseline: (() => {
           const values = historyByCode.get(kpi.code) ?? [];
           return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
         })(),
         baselineLabel: historyByCode.has(kpi.code) ? "Historical average" : "No baseline",
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
      downtime: stoppages.length
        ? stoppages.map((item) => {
            const hours = Number(item.durationHours);
            return {
              label: String(item.cause ?? "Uncategorised stoppage"),
              hours: Number.isFinite(hours) ? hours : 0,
              share: stoppageTotal > 0 && Number.isFinite(hours) ? hours / stoppageTotal : 0,
            };
          })
        : [],
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

router.get("/reports/daily/:productionDate/pdf", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const productionDate = String(req.params.productionDate);
    const [factory, day] = await Promise.all([
      db.select().from(factories).where(eq(factories.id, factoryId)).limit(1),
      db.select().from(productionDays).where(and(
        eq(productionDays.factoryId, factoryId),
        eq(productionDays.productionDate, productionDate),
      )).limit(1),
    ]);
    if (!day[0] || !factory[0]) {
      res.status(404).json({ error: "Report not available for this production date." });
      return;
    }
    const [kpis, exceptions, lineage, operation] = await Promise.all([
      db.select().from(kpiValues).where(eq(kpiValues.productionDayId, day[0].id)).orderBy(asc(kpiValues.code)),
      db.select().from(anomalies).where(eq(anomalies.productionDayId, day[0].id)),
      db.select().from(lineageReferences).where(eq(lineageReferences.productionDayId, day[0].id)),
      db.select().from(dailyOperations).where(and(
        eq(dailyOperations.factoryId, factoryId),
        eq(dailyOperations.productionDate, productionDate),
      )).orderBy(desc(dailyOperations.updatedAt)).limit(1),
    ]);
    const document = new PDFDocument({ size: "A4", margin: 48, info: {
      Title: `Daily management report — ${productionDate}`,
      Author: "Sugar Factory Intelligence",
      Subject: "Bilagi Sugar Mill Ltd. operational report",
    }});
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="sugar-factory-report-${productionDate}.pdf"`);
    document.pipe(res);
    document.fontSize(18).fillColor("#173f35").text("Sugar Factory Intelligence");
    document.moveDown(0.25).fontSize(11).fillColor("#4b5563").text(factory[0].name);
    document.fontSize(14).fillColor("#111827").text(`Daily management report — ${productionDate}`);
    document.moveDown(0.5).fontSize(9).fillColor("#6b7280").text("Season 2025–26 · report version phase-1.1 · generated by the application");
    document.moveDown(1).fontSize(12).fillColor("#173f35").text("KPI scorecard");
    document.moveDown(0.3);
    for (const kpi of kpis) {
      const value = toNumber(kpi.value);
      document.fontSize(10).fillColor("#111827").text(
        `${kpi.label}: ${value === null ? "—" : value.toFixed(2)} ${kpi.unit} · ${kpi.status}`,
      );
    }
    document.moveDown(1).fontSize(12).fillColor("#173f35").text("Recorded exceptions");
    document.moveDown(0.3);
    if (!exceptions.length) {
      document.fontSize(10).fillColor("#374151").text("No exceptions were recorded.");
    } else {
      for (const item of exceptions) {
        document.fontSize(10).fillColor("#111827").text(`${item.severity} — ${item.title}`);
        document.fontSize(9).fillColor("#4b5563").text(item.detail, { indent: 12 });
      }
    }
    document.moveDown(1).fontSize(12).fillColor("#173f35").text("Downtime register");
    const operationStoppages = operation[0] && Array.isArray(operation[0].stoppages)
      ? operation[0].stoppages.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
    if (!operationStoppages.length) {
      document.moveDown(0.3).fontSize(10).fillColor("#374151").text("No stoppage detail was recorded.");
    } else {
      for (const item of operationStoppages) {
        document.moveDown(0.2).fontSize(10).fillColor("#111827").text(
          `${String(item.cause ?? "Uncategorised stoppage")} — ${String(item.durationHours ?? 0)} h`,
        );
      }
    }
    document.moveDown(1).fontSize(12).fillColor("#173f35").text("Lineage");
    document.moveDown(0.3).fontSize(9).fillColor("#374151").text(
      `${lineage.length} canonical source reference(s) recorded. Source cells remain available in the application lineage view.`,
    );
    document.end();
  } catch (error) {
    next(error);
  }
});

router.get("/reports/daily/:productionDate/lineage", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const factoryId = await getDemoFactoryId();
    const day = factoryId
      ? (await db
          .select()
          .from(productionDays)
          .where(eq(productionDays.productionDate, String(req.params.productionDate)))
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
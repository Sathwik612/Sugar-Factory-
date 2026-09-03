import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import {
  GetSourceFileParams,
  GetSourceFileResponse,
  ListSourceFilesQueryParams,
  ListSourceFilesResponse,
  UploadSourceFileResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  dailyOperations,
  lineageReferences,
  processingEvents,
  productionDays,
  sourceFiles,
  validationIssues,
} from "@workspace/db";
import { getDemoFactoryId } from "../lib/demoData";
import { requireRoles } from "../lib/authz";
import { recordAudit } from "../lib/audit";
import { calculateImportedRow, inspectWorkbook, WORKBOOK_MAPPING_VERSION, WORKBOOK_PARSER_VERSION } from "../lib/workbookImport";
import { readSourceFile } from "../lib/sourceFileStorage";

const router: IRouter = Router();
const maxUploadBytes = Number(process.env.SOURCE_FILE_MAX_BYTES ?? 10 * 1024 * 1024);

router.get("/source-files", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const params = ListSourceFilesQueryParams.parse(req.query);
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const rows = await db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.factoryId, factoryId))
      .orderBy(desc(sourceFiles.uploadedAt))
      .limit(params.limit ?? 25);
    const filtered = params.status ? rows.filter((row) => row.status === params.status) : rows;
    res.json(
      ListSourceFilesResponse.parse(
        filtered.map((row) => ({
          id: row.id,
          filename: row.filename,
          reportType: row.reportType,
          reportingDate: row.reportingDate,
          status: row.status,
          uploadedAt: row.uploadedAt.toISOString(),
          sizeBytes: row.sizeBytes,
          sha256: row.sha256,
          synthetic: row.synthetic,
          issueCount: row.issueCount,
        workbookSheets: row.workbookSheets,
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/source-files/:fileId", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const params = GetSourceFileParams.parse(req.params);
    const row = (await db.select().from(sourceFiles).where(eq(sourceFiles.id, params.fileId)).limit(1))[0];
    if (!row) {
      res.status(404).json({ error: "Source file not found." });
      return;
    }
    const [events, issues] = await Promise.all([
      db.select().from(processingEvents).where(eq(processingEvents.sourceFileId, row.id)).orderBy(asc(processingEvents.at)),
      db.select().from(validationIssues).where(eq(validationIssues.sourceFileId, row.id)),
    ]);
    res.json(
      GetSourceFileResponse.parse({
        id: row.id,
        filename: row.filename,
        reportType: row.reportType,
        reportingDate: row.reportingDate,
        status: row.status,
        uploadedAt: row.uploadedAt.toISOString(),
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        synthetic: row.synthetic,
        issueCount: row.issueCount,
         sheets: Array.isArray(row.workbookSheets) && row.workbookSheets.length
           ? row.workbookSheets.map((sheet) => typeof sheet === "string" ? sheet : String((sheet as { name?: unknown }).name ?? "Unnamed sheet"))
           : row.reportType === "Downtime" ? ["Downtime"] : [row.reportType, "Summary"],
        issues: issues.map((issue) => ({
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          location: issue.location,
        })),
        processingHistory: events.map((event) => ({
          status: event.status,
          at: event.at.toISOString(),
          note: event.note,
        })),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/source-files/:fileId/preview", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const row = (await db.select().from(sourceFiles).where(eq(sourceFiles.id, String(req.params.fileId))).limit(1))[0];
    if (!row) {
      res.status(404).json({ error: "Source file not found." });
      return;
    }
    const issues = await db.select().from(validationIssues).where(eq(validationIssues.sourceFileId, row.id));
    const sheets = Array.isArray(row.workbookSheets) ? row.workbookSheets : [];
    const previewRows = Array.isArray(row.previewRows) ? row.previewRows : [];
    const mapping = row.mapping && typeof row.mapping === "object" && !Array.isArray(row.mapping) ? row.mapping : {};
    res.json({
      id: row.id,
      filename: row.filename,
      status: row.status,
      parserVersion: row.parserVersion,
      mappingVersion: row.mappingVersion,
      sheets,
      mapping,
      previewRows,
      issues,
      validRowCount: previewRows.length,
      errorCount: issues.filter((issue) => issue.severity === "ERROR").length,
      warningCount: issues.filter((issue) => issue.severity === "WARNING").length,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/source-files/upload",
  requireRoles("MANAGER", "ADMIN"),
  async (req, res, next) => {
    try {
    const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath : "";
    const filename = typeof req.body?.filename === "string" ? req.body.filename.trim() : "";
    const sizeBytes = Number(req.body?.sizeBytes);
    const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : null;
    if (!objectPath || !filename || !Number.isFinite(sizeBytes)) {
      res.status(400).json({ error: "Register the uploaded workbook object with objectPath, filename, and sizeBytes." });
      return;
    }
    const extension = filename.toLowerCase().slice(filename.lastIndexOf("."));
    if (![".xlsx", ".xls"].includes(extension)) {
      res.status(400).json({ error: "Only .xlsx and .xls workbooks are supported." });
      return;
    }
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const bytes = await readSourceFile(objectPath);
    if (bytes.length > maxUploadBytes || Math.abs(bytes.length - sizeBytes) > 0) {
      res.status(400).json({ error: "The uploaded object size does not match the registered metadata or exceeds the limit." });
      return;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicate = (await db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.sha256, sha256))
      .limit(1))[0];
    if (duplicate) {
      res.status(202).json(
        UploadSourceFileResponse.parse({
          id: duplicate.id,
          filename: duplicate.filename,
          reportType: duplicate.reportType,
          reportingDate: duplicate.reportingDate,
          status: "DUPLICATE",
          uploadedAt: duplicate.uploadedAt.toISOString(),
          sizeBytes: duplicate.sizeBytes,
          sha256: duplicate.sha256,
          synthetic: duplicate.synthetic,
          issueCount: duplicate.issueCount,
        }),
      );
      return;
    }
    const storageKey = objectPath;
    let inspection;
    try {
      inspection = inspectWorkbook(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workbook could not be parsed.";
      const [failed] = await db
        .insert(sourceFiles)
        .values({
          factoryId,
          uploadedBy: req.user?.id,
          filename: safeName,
          reportType: "Daily Operations",
          status: "FAILED",
          sizeBytes: bytes.length,
          sha256,
          storageKey,
          contentType,
          parserVersion: WORKBOOK_PARSER_VERSION,
          mappingVersion: WORKBOOK_MAPPING_VERSION,
          workbookSheets: [],
          previewRows: [],
          synthetic: false,
          issueCount: 1,
        })
        .returning();
      await db.insert(processingEvents).values([
        { sourceFileId: failed.id, status: "RECEIVED", note: "Workbook upload received" },
        { sourceFileId: failed.id, status: "HASHED", note: "SHA-256 calculated from uploaded bytes" },
        { sourceFileId: failed.id, status: "FAILED", note: message },
      ]);
      await db.insert(validationIssues).values({
        sourceFileId: failed.id,
        severity: "ERROR",
        code: "WORKBOOK_PARSE_FAILED",
        message,
        location: "workbook",
      });
      await recordAudit(req, "SOURCE_FILE_FAILED", "source_file", failed.id, { reason: "WORKBOOK_PARSE_FAILED" });
      res.status(202).json({
        id: failed.id,
        filename: failed.filename,
        reportType: failed.reportType,
        reportingDate: failed.reportingDate,
        status: failed.status,
        uploadedAt: failed.uploadedAt.toISOString(),
        sizeBytes: failed.sizeBytes,
        sha256: failed.sha256,
        synthetic: failed.synthetic,
        issueCount: failed.issueCount,
      });
      return;
    }
    const errors = inspection.issues.filter((issue) => issue.severity === "ERROR");
    const warnings = inspection.issues.filter((issue) => issue.severity === "WARNING");
    const reportingDate = inspection.rows[0]?.productionDate ?? null;
    const status = errors.length ? "FAILED" : "VALIDATING";
    const [created] = await db
      .insert(sourceFiles)
      .values({
        factoryId,
        uploadedBy: req.user?.id,
        filename: safeName,
        reportType: "Daily Operations",
        reportingDate,
        status,
        sizeBytes: bytes.length,
        sha256,
        storageKey,
        contentType,
        parserVersion: WORKBOOK_PARSER_VERSION,
        mappingVersion: WORKBOOK_MAPPING_VERSION,
        workbookSheets: inspection.sheets,
        previewRows: inspection.rows.slice(0, 20),
        mapping: inspection.mapping,
        synthetic: false,
        issueCount: inspection.issues.length,
      })
      .returning();
    await db.insert(processingEvents).values([
      { sourceFileId: created.id, status: "RECEIVED", note: "Workbook upload received" },
      { sourceFileId: created.id, status: "HASHED", note: "SHA-256 calculated from uploaded bytes" },
      { sourceFileId: created.id, status: "PARSING", note: `${inspection.sheets.length} sheet(s) inspected` },
      { sourceFileId: created.id, status, note: `${inspection.rows.length} valid row(s), ${errors.length} error(s), ${warnings.length} warning(s)` },
    ]);
    if (inspection.issues.length) {
      await db.insert(validationIssues).values(
        inspection.issues.map((issue) => ({
          sourceFileId: created.id,
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          location: issue.location,
          details: issue.details ?? null,
        })),
      );
    }
    await recordAudit(req, "SOURCE_FILE_REGISTERED", "source_file", created.id, {
      sha256,
      sizeBytes: bytes.length,
      status,
      validRowCount: inspection.rows.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    });
    res.status(202).json(
      UploadSourceFileResponse.parse({
        id: created.id,
        filename: created.filename,
          reportType: created.reportType,
        reportingDate: created.reportingDate,
        status: created.status,
        uploadedAt: created.uploadedAt.toISOString(),
        sizeBytes: created.sizeBytes,
        sha256: created.sha256,
        synthetic: created.synthetic,
        issueCount: created.issueCount,
      }),
    );
  } catch (error) {
    next(error);
  }
  },
);

router.post("/source-files/:fileId/import", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  let claimed = false;
  try {
    const source = (await db.select().from(sourceFiles).where(eq(sourceFiles.id, String(req.params.fileId))).limit(1))[0];
    if (!source) {
      res.status(404).json({ error: "Source file not found." });
      return;
    }
    if (source.status === "PROCESSED" && source.importedAt) {
      res.status(200).json({ sourceFileId: source.id, status: "IMPORTED", importedCount: 0, alreadyImported: true });
      return;
    }
    if (source.status === "IMPORTING") {
      res.status(409).json({ error: "This source file is already being imported by another request.", code: "IMPORT_IN_PROGRESS" });
      return;
    }
    if (!source.storageKey) {
      res.status(409).json({ error: "This source record does not have retained workbook bytes." });
      return;
    }
    const bytes = await readSourceFile(source.storageKey);
    const inspection = inspectWorkbook(bytes);
    const errors = inspection.issues.filter((issue) => issue.severity === "ERROR");
    if (errors.length) {
      res.status(409).json({
        error: "Import cannot proceed until workbook validation errors are corrected.",
        issues: errors,
      });
      return;
    }
    const factoryId = source.factoryId;
    const conflicts: Array<{ productionDate: string; shift: string }> = [];
    for (const row of inspection.rows) {
      const existing = await db
        .select({ id: dailyOperations.id })
        .from(dailyOperations)
        .where(and(
          eq(dailyOperations.factoryId, factoryId),
          eq(dailyOperations.productionDate, row.productionDate),
          eq(dailyOperations.shift, row.shift),
        ))
        .limit(1);
      if (existing.length) conflicts.push({ productionDate: row.productionDate, shift: row.shift });
    }
    if (conflicts.length) {
      res.status(409).json({
        error: "Import would conflict with existing Daily Operations records. No records were changed.",
        code: "IMPORT_CONFLICT",
        conflicts,
      });
      return;
    }
    const [claim] = await db.update(sourceFiles)
      .set({ status: "IMPORTING" })
      .where(and(eq(sourceFiles.id, source.id), ne(sourceFiles.status, "PROCESSED"), ne(sourceFiles.status, "IMPORTING")))
      .returning();
    if (!claim) {
      res.status(409).json({ error: "This source file is already being imported by another request.", code: "IMPORT_IN_PROGRESS" });
      return;
    }
    claimed = true;

    const imported = await db.transaction(async (tx) => {
      let count = 0;
      for (const rawRow of inspection.rows) {
        const row = calculateImportedRow(rawRow);
        const [day] = await tx
          .insert(productionDays)
          .values({ factoryId, productionDate: row.productionDate, dataStatus: "PARTIAL" })
          .onConflictDoNothing()
          .returning();
        const productionDay = day ?? (await tx
          .select()
          .from(productionDays)
          .where(and(eq(productionDays.factoryId, factoryId), eq(productionDays.productionDate, row.productionDate)))
          .limit(1))[0];
        if (!productionDay) throw new Error(`Could not create production day for ${row.productionDate}.`);
        const [record] = await tx.insert(dailyOperations).values({
          factoryId,
          productionDate: row.productionDate,
          season: row.season,
          shift: row.shift,
          status: "DRAFT",
          source: "EXCEL_IMPORT",
          submittedBy: req.user?.id ?? null,
          production: row.production,
          quality: row.quality,
          efficiency: row.efficiency,
          timeAccount: row.timeAccount,
          energy: row.energy,
          stoppages: row.stoppages,
          materials: row.materials,
        }).returning();
        const lineageFields: Array<[string, string, unknown, string]> = [
          ["cane_crushed", "production.caneCrushed", row.production.caneCrushed, inspection.mapping.caneCrushed ?? "unknown"],
          ["sugar_produced", "production.sugarProduced", row.production.sugarProduced, inspection.mapping.sugarProduced ?? "unknown"],
          ["recovery", "production.recovery", row.production.recovery, "derived"],
        ];
        await tx.insert(lineageReferences).values(lineageFields.map(([kpiCode, canonicalField, rawValue, sourceColumn]) => ({
          factoryId,
          productionDayId: productionDay.id,
          kpiCode,
          canonicalField,
          fileId: source.id,
          sheet: row.sourceLocation.sheet,
          sourceRow: row.sourceLocation.row,
          sourceColumn,
          rawValue: String(rawValue ?? ""),
          formula: kpiCode === "recovery" ? "(sugar produced / cane crushed) × 100" : "source value",
        })));
        await tx.insert(processingEvents).values({
          sourceFileId: source.id,
          status: "IMPORTED",
          note: `Daily Operations draft ${record.id} created from ${row.sourceLocation.sheet} row ${row.sourceLocation.row}`,
        });
        count += 1;
      }
      await tx.update(sourceFiles).set({
        status: "PROCESSED",
        importedAt: new Date(),
        issueCount: inspection.issues.length,
      }).where(eq(sourceFiles.id, source.id));
      return count;
    });
    await recordAudit(req, "SOURCE_FILE_IMPORTED", "source_file", source.id, { importedCount: imported });
    res.json({ sourceFileId: source.id, status: "IMPORTED", importedCount: imported, alreadyImported: false });
  } catch (error) {
    if (claimed) {
      await db.update(sourceFiles).set({ status: "VALIDATING" }).where(eq(sourceFiles.id, String(req.params.fileId))).catch(() => undefined);
    }
    next(error);
  }
});

export default router;
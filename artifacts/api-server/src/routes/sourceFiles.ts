import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import {
  GetSourceFileParams,
  GetSourceFileResponse,
  ListSourceFilesQueryParams,
  ListSourceFilesResponse,
  UploadSourceFileBody,
  UploadSourceFileResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { processingEvents, sourceFiles, validationIssues } from "@workspace/db";
import { getDemoFactoryId } from "../lib/demoData";
import { requireRoles } from "../lib/authz";

const router: IRouter = Router();

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
        sheets: row.reportType === "Downtime" ? ["Downtime"] : [row.reportType, "Summary"],
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

router.post("/source-files/upload", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const body = UploadSourceFileBody.parse(req.body);
    const factoryId = await getDemoFactoryId();
    if (!factoryId) {
      res.status(503).json({ error: "No factory has been configured yet." });
      return;
    }
    const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const sha256 = createHash("sha256").update(`${safeName}:${body.sizeBytes}`).digest("hex");
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
    const [created] = await db
      .insert(sourceFiles)
      .values({
        factoryId,
        filename: safeName,
        reportType: "Pending review",
        status: "RECEIVED",
        sizeBytes: body.sizeBytes,
        sha256,
        synthetic: false,
        issueCount: 0,
      })
      .returning();
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
});

export default router;
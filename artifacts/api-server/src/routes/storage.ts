import { Router, type IRouter } from "express";
import { requireRoles } from "../lib/authz";
import { requestSourceUpload } from "../lib/sourceFileStorage";

const router: IRouter = Router();

router.post("/storage/uploads/request-url", requireRoles("MANAGER", "ADMIN"), async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const size = Number(req.body?.size);
    const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "application/octet-stream";
    const maxBytes = Number(process.env.SOURCE_FILE_MAX_BYTES ?? 10 * 1024 * 1024);
    if (!name || !Number.isFinite(size) || size <= 0 || size > maxBytes) {
      res.status(400).json({ error: `A file between 1 byte and ${Math.round(maxBytes / 1024 / 1024)} MB is required.` });
      return;
    }
    const extension = name.toLowerCase().slice(name.lastIndexOf("."));
    if (![".xlsx", ".xls"].includes(extension)) {
      res.status(400).json({ error: "Only .xlsx and .xls workbooks are supported." });
      return;
    }
    const upload = await requestSourceUpload();
    res.json({ ...upload, metadata: { name, size, contentType } });
  } catch (error) {
    next(error);
  }
});

export default router;
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  try {
    const timeoutMs = Number(process.env.READINESS_TIMEOUT_MS ?? "3000");
    await Promise.race([
      pool.query("select 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Readiness timeout")), timeoutMs)),
    ]);
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

export async function checkReadiness(
  query: () => Promise<unknown> = () => pool.query("select 1"),
  timeoutMs = Number(process.env.READINESS_TIMEOUT_MS ?? "3000"),
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Readiness timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  if (await checkReadiness()) {
    res.json({ status: "ready" });
    return;
  }
  res.status(503).json({ status: "not_ready" });
});

export default router;

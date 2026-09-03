import app from "./app";
import { logger } from "./lib/logger";
import { seedDemoData } from "./lib/demoData";
import { seedDemoUsers } from "./routes/auth";
import { closeDatabase } from "@workspace/db";
import { startPushDeliveryWorker } from "./lib/notifications";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  const shouldSeedDemo = process.env.SEED_DEMO_DATA === "true" || process.env.NODE_ENV !== "production";
  if (shouldSeedDemo) {
    await seedDemoUsers();
    await seedDemoData();
  }
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
    if (process.env.DISABLE_PUSH_DELIVERY_WORKER !== "true") {
      startPushDeliveryWorker();
    }
  });
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");
    const forceTimer = setTimeout(() => {
      logger.error({ signal }, "Graceful shutdown timed out");
      process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS ?? "10000"));
    forceTimer.unref();
    server.close(async (error) => {
      if (error) logger.error({ err: error }, "HTTP server close failed");
      try {
        await closeDatabase();
        logger.info({ signal }, "Database pool closed");
        clearTimeout(forceTimer);
        process.exit(error ? 1 : 0);
      } catch (dbError) {
        logger.error({ err: dbError }, "Database pool close failed");
        process.exit(1);
      }
    });
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException");
  });
  process.once("unhandledRejection", (error) => {
    logger.fatal({ err: error }, "Unhandled rejection");
    void shutdown("unhandledRejection");
  });
}

start().catch((error) => {
  logger.error({ error }, "Unable to start API server");
  process.exit(1);
});

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
const hasPgConfig = Boolean(
  process.env.PGHOST &&
    process.env.PGUSER &&
    process.env.PGPASSWORD &&
    process.env.PGDATABASE,
);

if (!databaseUrl && !hasPgConfig) {
  throw new Error(
    "Database configuration is missing. Set DATABASE_URL or the platform PG* variables.",
  );
}

export const pool = new Pool(
  databaseUrl
    ? {
        connectionString: databaseUrl,
        max: Number(process.env.PGPOOL_MAX ?? "10"),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? "30000"),
        connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? "5000"),
        statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? "30000"),
        keepAlive: true,
      }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? "5432"),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        max: Number(process.env.PGPOOL_MAX ?? "10"),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? "30000"),
        connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? "5000"),
        statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? "30000"),
        keepAlive: true,
      },
);
export const db = drizzle(pool, { schema });

let closing: Promise<void> | null = null;
export function closeDatabase() {
  closing ??= pool.end();
  return closing;
}

export * from "./schema";

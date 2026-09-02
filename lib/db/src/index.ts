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
    ? { connectionString: databaseUrl }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? "5432"),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
      },
);
export const db = drizzle(pool, { schema });

export * from "./schema";

import { defineConfig } from "drizzle-kit";
import path from "path";

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

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: databaseUrl
    ? { url: databaseUrl }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? "5432"),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
      },
});

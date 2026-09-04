import crypto from "node:crypto";
import pg from "pg";

const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || "admin").trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || `${username}@local.invalid`).trim().toLowerCase();

if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  throw new Error("BOOTSTRAP_ADMIN_USERNAME must contain 3-32 lowercase letters, numbers, dots, underscores, or hyphens.");
}
if (password.length < 12 || password.includes("replace-with")) {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be a real password with at least 12 characters.");
}

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || "5432"),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    };

const salt = crypto.randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
const client = new pg.Client(config);

await client.connect();
try {
  const existing = await client.query("SELECT id FROM users WHERE username = $1 LIMIT 1", [username]);
  if (existing.rowCount) {
    console.log(`Bootstrap administrator "${username}" already exists; no password was changed.`);
  } else {
    await client.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, role, department, is_demo)
       VALUES ($1, $2, $3, 'System', 'Administrator', 'ADMIN', 'ADMINISTRATION', false)`,
      [username, email, passwordHash],
    );
    console.log(`Bootstrap administrator "${username}" created.`);
  }
} finally {
  await client.end();
}
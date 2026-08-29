/**
 * Apply the dashboard admin tables migration (LOGIN-3.10).
 * Run: pnpm --filter @wpt/backend exec tsx src/db/apply-dashboard-migration.ts
 *
 * Executes src/db/migrations/004_dashboard_tables.sql against DATABASE_URL.
 * Creates `dashboard_admins` (DB-2.5) and `dashboard_sessions` (DB-2.6).
 */

import pg from "pg";
import type { PoolConfig } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env from backend root (mirrors migrate-users.ts).
try {
  const env = readFileSync(resolve(import.meta.dirname, "../../.env"), "utf-8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env not found — rely on shell env */ }

const { Pool } = pg;

const MIGRATION_PATH = resolve(
  import.meta.dirname,
  "./migrations/004_dashboard_tables.sql",
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in apps/backend/.env or pass it as an env var.");
    process.exit(1);
  }

  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  // Force IPv4 — pg defaults to IPv6 (preferred) which fails with ENETUNREACH
  // on networks without an IPv6 route to the Supabase host.
  const pool = new Pool({
    connectionString: url,
    family: 4,
  } as PoolConfig);

  console.log("Applying 004_dashboard_tables.sql ...");
  await pool.query(sql);
  console.log("Migration applied.\n");

  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('dashboard_admins', 'dashboard_sessions')
    ORDER BY table_name
  `);
  console.log("Verified tables:");
  for (const row of res.rows) {
    console.log(`  - ${row.table_name}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

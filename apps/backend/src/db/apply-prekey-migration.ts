/**
 * Apply the ENC-4.1 prekey tables migration.
 * Run: pnpm --filter @wpt/backend exec tsx src/db/apply-prekey-migration.ts
 *
 * Executes src/db/migrations/006_prekey_tables.sql against DATABASE_URL.
 * Creates `devices` (DB-2.x prerequisite) + `signed_prekeys` +
 * `one_time_prekeys` (public-key scaffolding only — no private key columns).
 */

import pg from "pg";
import type { PoolConfig } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env from backend root (mirrors apply-audit-log-migration.ts).
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
  "./migrations/006_prekey_tables.sql",
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in apps/backend/.env or pass it as an env var.");
    process.exit(1);
  }

  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  // Force IPv4 — pg defaults to IPv6 which fails with ECONNREFUSED on networks
  // without an IPv6 route to the Supabase host (same fix as other migrations).
  const pool = new Pool({
    connectionString: url,
    family: 4,
  } as PoolConfig);

  console.log("Applying 006_prekey_tables.sql ...");
  await pool.query(sql);
  console.log("Migration applied.\n");

  for (const table of ["devices", "signed_prekeys", "one_time_prekeys"]) {
    const res = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
      `,
      [table],
    );
    console.log(`${table} columns:`);
    for (const row of res.rows) {
      console.log(`  - ${row.column_name}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
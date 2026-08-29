/**
 * Seed dashboard admin test accounts (LOGIN-3.10).
 *
 * Run: pnpm --filter @wpt/backend exec tsx src/db/seed-dashboard-admins.ts
 *
 * Inserts three test dashboard admins (all with password: "Admin@123"):
 *   - samson@wpt.internal    role: owner
 *   - arjun@wpt.internal     role: admin
 *   - qa-intern@wpt.internal role: admin (is_test_account = true)
 *
 * The bcrypt hash is generated at runtime — never commit a raw password or
 * a precomputed hash to the repo.
 */

import pg from "pg";
import type { PoolConfig } from "pg";
import bcrypt from "bcrypt";
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
const PASSWORD = "Admin@123";

const SEED_ADMINS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    email: "samson@wpt.internal",
    role: "owner",
    isTestAccount: false,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    email: "arjun@wpt.internal",
    role: "admin",
    isTestAccount: false,
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    email: "qa-intern@wpt.internal",
    role: "admin",
    isTestAccount: true,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in apps/backend/.env or pass it as an env var.");
    process.exit(1);
  }

  // Force IPv4 — pg defaults to IPv6 (preferred) which fails with ENETUNREACH
  // on networks without an IPv6 route to the Supabase host.
  const pool = new Pool({
    connectionString: url,
    family: 4,
  } as PoolConfig);

  // Generate ONE bcrypt hash for all seed admins (same password).
  const hash = await bcrypt.hash(PASSWORD, 12);
  console.log(`Password: ${PASSWORD}`);
  console.log(`Bcrypt hash (rounds=12): ${hash}\n`);

  for (const admin of SEED_ADMINS) {
    const exists = await pool.query(
      "SELECT id FROM dashboard_admins WHERE id = $1",
      [admin.id],
    );
    if (exists.rows.length > 0) {
      await pool.query(
        `UPDATE dashboard_admins
         SET email = $2, password_hash = $3, role = $4, is_test_account = $5, updated_at = now()
         WHERE id = $1`,
        [admin.id, admin.email, hash, admin.role, admin.isTestAccount],
      );
      console.log(`Updated: ${admin.email} (${admin.role})`);
    } else {
      await pool.query(
        `INSERT INTO dashboard_admins (id, email, password_hash, role, is_test_account)
         VALUES ($1, $2, $3, $4, $5)`,
        [admin.id, admin.email, hash, admin.role, admin.isTestAccount],
      );
      console.log(`Inserted: ${admin.email} (${admin.role})`);
    }
  }

  await pool.end();
  console.log("\nDone. You can now log in at POST /api/v1/admin/login");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

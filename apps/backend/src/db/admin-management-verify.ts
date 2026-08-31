/**
 * ENC-verify for the dashboard admin management fix (LOGIN-3.10).
 * Run: pnpm --filter @wpt/backend exec tsx src/db/admin-management-verify.ts
 *
 * Proves the "create dashboard admin" bug is fixed end-to-end:
 *   1. Owner mints a dashboard token.
 *   2. POST /admin/admins actually CREATES the admin row (201), with a bcrypt
 *      password hash and an audit_log entry in the same transaction.
 *   3. The created admin can log in (password verifies).
 *   4. GET /admin/admins lists it.
 *   5. DELETE /admin/admins/:id removes it; deleting the LAST owner is refused.
 * Self-cleaning.
 */

import express from "express";
import pg from "pg";
import type { PoolConfig } from "pg";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import adminRouter from "../routes/admin.js";
import { issueDashboardAccessToken } from "../auth/dashboard-jwt.js";

const { Pool } = pg;

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

if (!process.env.DASHBOARD_JWT_SECRET) {
  console.error("DASHBOARD_JWT_SECRET not set.");
  process.exit(1);
}

const OWNER_ID = "11111111-1111-1111-1111-111111111111"; // samson@wpt.internal (owner)
const OWNER_EMAIL = "samson@wpt.internal";
const OWNER_PASSWORD = "Admin@123";

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures += 1; console.error(`  FAIL  ${label}`); }
}

interface AdminListRow { email?: string }

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL not set."); process.exit(1); }
  const pool = new Pool({ connectionString: url, family: 4 } as PoolConfig);
  const client = await pool.connect();

  const NEW_EMAIL = `managed-${Date.now().toString(36)}@wpt.internal`;
  const NEW_PASSWORD = "ComplexPass123!";

  let httpServer: Server | null = null;
  let createdId: string | null = null;

  try {
    // Ensure the seeded owner exists.
    await client.query(
      `INSERT INTO dashboard_admins (id, email, password_hash, role, is_test_account)
       VALUES ($1, $2, $3, 'owner', false)
       ON CONFLICT (id) DO NOTHING`,
      [OWNER_ID, OWNER_EMAIL, await bcrypt.hash(OWNER_PASSWORD, 12)],
    );

    const app = express();
    app.use(express.json());
    app.use("/admin", adminRouter);
    httpServer = createServer(app);
    await new Promise<void>((r) => httpServer!.listen(0, r));
    const port = (httpServer.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const ownerToken = await issueDashboardAccessToken({
      adminId: OWNER_ID, email: OWNER_EMAIL, role: "owner", isTestAccount: false,
      sessionId: randomUUID(),
    });

    console.log("\n[1] POST /admin/admins (create)");
    const create = await fetch(`${base}/admin/admins`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: NEW_EMAIL, password: NEW_PASSWORD, role: "admin" }),
    });
    const createBody = await create.json();
    assert(create.status === 201, `create -> 201 (got ${create.status} ${createBody.error ?? ""})`);
    assert(!!createBody.admin?.id, "create returns the new admin id");
    createdId = createBody.admin?.id ?? null;

    // DB: row exists, hash is bcrypt.
    const row = await client.query(
      "SELECT id, email, password_hash, role FROM dashboard_admins WHERE email = $1",
      [NEW_EMAIL],
    );
    assert(row.rows.length === 1, "admin row actually inserted in the database");
    if (row.rows[0]) {
      const matches = await bcrypt.compare(NEW_PASSWORD, row.rows[0].password_hash);
      assert(matches, "stored hash verifies against the password (bcrypt, not plaintext)");
      assert(!row.rows[0].password_hash.includes(NEW_PASSWORD), "password not stored in plaintext");
      assert(row.rows[0].role === "admin", "role persisted as admin");
    }

    // audit log written in same transaction.
    const audit = await client.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE event_type = 'admin_admin_created' AND metadata->>'targetEmail' = $1",
      [NEW_EMAIL],
    );
    assert(audit.rows[0].n >= 1, "audit_log entry written for the create action");

    console.log("\n[2] Created admin can log in");
    const login = await fetch(`${base}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: NEW_EMAIL, password: NEW_PASSWORD }),
    });
    const loginBody = await login.json();
    assert(login.status === 200, `new admin logs in -> 200 (got ${login.status})`);
    assert(!!loginBody.accessToken, "login returns a dashboard access token");

    console.log("\n[3] Duplicate email -> 409");
    const dup = await fetch(`${base}/admin/admins`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: NEW_EMAIL, password: NEW_PASSWORD }),
    });
    const dupBody = await dup.json();
    assert(dup.status === 409 && dupBody.error === "EMAIL_ALREADY_EXISTS", `duplicate -> 409 EMAIL_ALREADY_EXISTS (got ${dup.status})`);

    console.log("\n[4] GET /admin/admins lists it");
    const list = await fetch(`${base}/admin/admins`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const listBody = await list.json();
    const found = listBody.admins?.some(
      (a: AdminListRow) => a.email === NEW_EMAIL,
    );
    assert(list.status === 200 && found === true, "list includes the new admin");

    console.log("\n[5] DELETE creates admin cannot delete the LAST owner");
    // Only the seeded owner exists; deleting it (the last owner) must be refused.
    const delOwner = await fetch(`${base}/admin/admins/${OWNER_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const delOwnerBody = await delOwner.json();
    void delOwnerBody;
    assert(delOwner.status === 400, `cannot delete the last owner (got ${delOwner.status})`);

    if (createdId) {
      console.log("\n[6] DELETE /admin/admins/:id (admin)");
      const del = await fetch(`${base}/admin/admins/${createdId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const delBody = await del.json();
      assert(del.status === 200 && delBody.success === true, `delete admin -> 200 (got ${del.status})`);
      const gone = await client.query("SELECT id FROM dashboard_admins WHERE id = $1", [createdId]);
      assert(gone.rows.length === 0, "admin row removed from the database");
    }

    console.log("\n[7] Non-owner cannot manage admins (401/403)");
    // A token with role 'admin' (not owner) must be rejected.
    const nonOwnerToken = await issueDashboardAccessToken({
      adminId: randomUUID(), email: "arjun@wpt.internal", role: "admin", isTestAccount: false,
      sessionId: randomUUID(),
    });
    const forbidden = await fetch(`${base}/admin/admins`, {
      method: "POST",
      headers: { Authorization: `Bearer ${nonOwnerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@wpt.internal", password: "SomePassword1" }),
    });
    assert(forbidden.status === 403, `non-owner create -> 403 (got ${forbidden.status})`);

    if (failures === 0) console.log("\nALL CHECKS PASSED (ADMIN MANAGEMENT VERIFY)");
    else { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1); }
  } finally {
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
    if (createdId) await client.query("DELETE FROM dashboard_admins WHERE id = $1", [createdId]).catch(() => undefined);
    await client.query("DELETE FROM dashboard_admins WHERE email = $1", [NEW_EMAIL]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error("VERIFY failed:", err); process.exit(1); });

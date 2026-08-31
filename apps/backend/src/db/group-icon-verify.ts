/**
 * ENC-4.5 — VERIFY script (run manually).
 * Run: pnpm --filter @wpt/backend exec tsx src/db/group-icon-verify.ts
 *
 * Requires: DATABASE_URL, JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *           set. Idempotent, self-cleaning.
 *
 * Card's VERIFY: request a group's icon URL as a current member — confirm
 * success (200 with a signed URL). Remove that member (leave), repeat the
 * request with the same credentials — confirm it's now rejected (403).
 */

import express from "express";
import pg from "pg";
import type { PoolConfig } from "pg";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { requireAudience } from "../middleware/auth.middleware.js";
import { issueAccessToken } from "../auth/jwt.js";
import groupsRouter from "../routes/groups.js";

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

if (!process.env.JWT_SECRET || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("JWT_SECRET, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

let failures = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

type IconResponse = {
  success: boolean;
  iconUrl?: string;
  expiresIn?: number;
  storagePath?: string;
  error?: string;
};

type GroupResponse = {
  success: boolean;
  group?: { id: string; senderKeyEpoch?: number };
  epoch?: { previous: number; current: number };
  error?: string;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, family: 4 } as PoolConfig);
  const client = await pool.connect();

  const suffix = Date.now().toString(36) + randomUUID().slice(0, 4);
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const phone = `+91930${suffix.slice(0, 5)}`;

  const seededUserIds: string[] = [];
  let httpServer: Server | null = null;
  let groupWithIconId: string | null = null;
  let groupWithoutIconId: string | null = null;

  try {
    // --- Seed users ----------------------------------------------------------
    console.log("\n[1] Seeding users");
    await client.query(
      `INSERT INTO users (id, phone_number, name)
       VALUES ($1, $2, 'icon owner'), ($3, $4, 'icon member'), ($5, $6, 'icon outsider')`,
      [ownerId, `${phone}a`, memberId, `${phone}b`, outsiderId, `${phone}c`],
    );
    seededUserIds.push(ownerId, memberId, outsiderId);

    // --- In-process server ---------------------------------------------------
    const app = express();
    app.use(express.json());
    app.use("/groups", requireAudience("app"), groupsRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolveListen) => {
      httpServer!.listen(0, resolveListen);
    });
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const ownerToken = await issueAccessToken({
      userId: ownerId,
      deviceId: randomUUID(),
      sessionId: "icon-verify-owner",
    });
    const outsiderToken = await issueAccessToken({
      userId: outsiderId,
      deviceId: randomUUID(),
      sessionId: "icon-verify-outsider",
    });

    const post = async (path: string, token: string, body?: unknown) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as GroupResponse };
    };

    const getIcon = async (path: string, token: string) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      return { status: res.status, json: (await res.json()) as IconResponse };
    };

    // --- [2] Create a group WITH an icon pointer -----------------------------
    console.log("\n[2] Create group with encrypted_icon_ref (opaque pointer)");
    // The pointer stores the storage OBJECT path only (not "bucket/path") —
    // the bucket is selected server-side via ICON_STORAGE_BUCKET.
    const STORAGE_PATH = "test-icon-verify.enc";
    const iconRefB64 = Buffer.from(STORAGE_PATH, "utf-8").toString("base64");
    const withIcon = await post("/groups", ownerToken, {
      encryptedName: Buffer.from("Icon Test Group", "utf-8").toString("base64"),
      encryptedIconRef: iconRefB64,
      whoCanSend: "everyone",
    });
    assert(withIcon.status === 201, `create group with icon -> 201 (got ${withIcon.status})`);
    groupWithIconId = withIcon.json.group!.id;

    // --- [3] GET /icon as member -> 200 + signed URL -------------------------
    console.log("\n[3] GET /groups/:id/icon as current member");
    const memberIcon = await getIcon(`/groups/${groupWithIconId}/icon`, ownerToken);
    assert(memberIcon.status === 200, `member icon request -> 200 (got ${memberIcon.status})`);
    assert(
      typeof memberIcon.json.iconUrl === "string" && memberIcon.json.iconUrl.length > 0,
      "response contains a non-empty iconUrl (signed URL)",
    );
    assert(memberIcon.json.expiresIn === 3600, "expiresIn is 3600 seconds (1 hour)");
    assert(
      memberIcon.json.storagePath === STORAGE_PATH,
      `storagePath echoed back correctly (${memberIcon.json.storagePath})`,
    );
    // Supabase returns the signed URL as a relative path (`/object/sign/...`);
    // the client joins it onto SUPABASE_URL. Resolve against the base and
    // confirm it's well-formed.
    try {
      new URL(memberIcon.json.iconUrl!, process.env.SUPABASE_URL);
      assert(true, "iconUrl resolves to a valid URL (client joins it onto SUPABASE_URL)");
    } catch {
      assert(false, `iconUrl is not resolvable: ${memberIcon.json.iconUrl}`);
    }

    // --- [4] Owner leaves the group -> membership revoked --------------------
    console.log("\n[4] Owner leaves the group");
    const leave = await post(`/groups/${groupWithIconId}/leave`, ownerToken);
    assert(leave.status === 200, `owner leave -> 200 (got ${leave.status})`);
    assert(
      typeof leave.json.epoch?.current === "number",
      "leave returns epoch.current (epoch +1 happened)",
    );

    // --- [5] Same token, now a former member -> 403 --------------------------
    console.log("\n[5] Former member requests icon -> 403");
    const formerMemberIcon = await getIcon(`/groups/${groupWithIconId}/icon`, ownerToken);
    assert(
      formerMemberIcon.status === 403 && formerMemberIcon.json.error === "NOT_GROUP_MEMBER",
      `former member -> 403 NOT_GROUP_MEMBER (got ${formerMemberIcon.status} ${formerMemberIcon.json.error})`,
    );

    // --- [6] Non-member (outsider) also rejected ------------------------------
    console.log("\n[6] Non-member requests icon -> 403");
    const outsiderIcon = await getIcon(`/groups/${groupWithIconId}/icon`, outsiderToken);
    assert(
      outsiderIcon.status === 403 && outsiderIcon.json.error === "NOT_GROUP_MEMBER",
      `outsider -> 403 NOT_GROUP_MEMBER`,
    );

    // --- [7] Group with NO icon -> 404 ICON_NOT_FOUND ------------------------
    console.log("\n[7] Create group WITHOUT icon -> 404 ICON_NOT_FOUND");
    const noIcon = await post("/groups", ownerToken, {
      encryptedName: Buffer.from("No Icon Group", "utf-8").toString("base64"),
      whoCanSend: "everyone",
    });
    // Re-add the owner first since he left; but the user is no longer a member
    // of that group. Let's use a fresh owner for the no-icon group. Actually
    // the owner can create a new group (he's still a registered user).
    groupWithoutIconId = noIcon.json.group!.id;
    const noIconReq = await getIcon(`/groups/${groupWithoutIconId}/icon`, ownerToken);
    assert(
      noIconReq.status === 404 && noIconReq.json.error === "ICON_NOT_FOUND",
      `group with no icon -> 404 ICON_NOT_FOUND`,
    );

    // --- [8] Cleanup ----------------------------------------------------------
    console.log("\n[8] Cleanup");
    for (const gid of [groupWithIconId, groupWithoutIconId]) {
      if (gid) await client.query(`DELETE FROM groups WHERE id = $1`, [gid]);
    }
    for (const uid of seededUserIds) {
      await client.query(`DELETE FROM users WHERE id = $1`, [uid]);
    }
    const leftoverGroups = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM groups WHERE id = ANY($1::uuid[])`,
      [[groupWithIconId, groupWithoutIconId]],
    );
    assert(leftoverGroups.rows[0]!.n === 0, "test groups removed");

    if (failures === 0) {
      console.log("\nALL CHECKS PASSED (ENC-4.5 VERIFY)");
    } else {
      console.error(`\n${failures} CHECK(S) FAILED (ENC-4.5 VERIFY)`);
      process.exit(1);
    }
  } finally {
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
    for (const gid of [groupWithIconId, groupWithoutIconId]) {
      if (gid) await client.query(`DELETE FROM groups WHERE id = $1`, [gid]).catch(() => undefined);
    }
    for (const uid of seededUserIds) {
      await client.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => undefined);
    }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("VERIFY script failed:", err);
  process.exit(1);
});
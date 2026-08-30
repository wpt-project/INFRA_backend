/**
 * ENC-4.3 — VERIFY script (run manually).
 * Run: pnpm --filter @wpt/backend exec tsx src/db/epoch-rotation-verify.ts
 *
 * Requires: DATABASE_URL + JWT_SECRET set (apps/backend/.env).
 *
 * Boots an in-process Express server exposing ONLY the groups router (behind
 * requireAudience("app")), drives the real endpoints against the live DB, and
 * confirms the card's acceptance steps:
 *   1. Remove a member   -> groups.sender_key_epoch +1, ATOMIC with the row
 *                           deletion (row gone AND epoch advanced together).
 *   2. Add a member      -> sender_key_epoch UNCHANGED (no retroactive access).
 *   3. Leave             -> also a departure: +1 atomic.
 * Plus the hard business rules the router enforces: Owner/Admin-only add+remove,
 * owner can never be removed, 70-member cap under a row lock.
 *
 * Creates and then deletes its own test group/users. Idempotent.
 */

import express from "express";
import pg from "pg";
import type { PoolConfig, PoolClient } from "pg";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { requireAudience } from "../middleware/auth.middleware.js";
import { issueAccessToken } from "../auth/jwt.js";
import groupsRouter from "../routes/groups.js";

const { Pool } = pg;

for (const line of readFileSync(resolve(import.meta.dirname, "../../.env"), "utf-8").split("\n")) {
  const i = line.indexOf("=");
  if (line.trim() && !line.startsWith("#") && i > 0) {
    if (!process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is not set.");
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

type GroupState = { sender_key_epoch: number; member_count: number };

async function groupState(client: PoolClient, groupId: string): Promise<GroupState> {
  const r = await client.query<{ sender_key_epoch: number }>(
    `SELECT sender_key_epoch FROM groups WHERE id = $1`, [groupId],
  );
  const m = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM group_members WHERE group_id = $1`, [groupId],
  );
  return { sender_key_epoch: r.rows[0]?.sender_key_epoch ?? -1, member_count: m.rows[0]!.n };
}

type AddRes = { success: boolean; added?: number; skipped?: number; senderKeyEpoch?: number; error?: string };
type RemoveRes = { success: boolean; epoch?: { previous: number; current: number }; error?: string };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, family: 4 } as PoolConfig);
  const client = await pool.connect();

  const groupIds: string[] = [];
  const userIds: string[] = [];
  let httpServer: Server | null = null;

  // Trickle-down ids: owner, member, admin, joiner, outsider.
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const adminId = randomUUID();
  const joinerId = randomUUID();
  const outsiderId = randomUUID();
  const phoneBase = `+9193${Date.now().toString(36).slice(-8)}`;

  try {
    // --- Seed one big test group (owner + member + admin), epoch starts 0 ----
    console.log("\n[1] Seeding test group + users");
    const seedUsers = [
      [ownerId, `${phoneBase}a`, "owner"],
      [memberId, `${phoneBase}b`, "member"],
      [adminId, `${phoneBase}c`, "admin"],
      [joinerId, `${phoneBase}d`, "joiner"],
      [outsiderId, `${phoneBase}e`, "outsider"],
    ] as const;
    for (const [id, phone, name] of seedUsers) {
      await client.query(`INSERT INTO users (id, phone_number, name) VALUES ($1, $2, $3)`, [id, phone, name]);
      userIds.push(id);
    }

    const groupId = randomUUID();
    groupIds.push(groupId);
    await client.query(
      `INSERT INTO groups (id, encrypted_name) VALUES ($1, $2)`,
      [groupId, Buffer.from([1])],
    );
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES
         ($1, $2, 'owner'::group_role), ($1, $3, 'member'::group_role), ($1, $4, 'admin'::group_role)`,
      [groupId, ownerId, memberId, adminId],
    );

    const s0 = await groupState(client, groupId);
    assert(s0.sender_key_epoch === 0, `group starts at epoch 0 (got ${s0.sender_key_epoch})`);
    assert(s0.member_count === 3, `group starts with 3 members (got ${s0.member_count})`);

    // --- In-process server ---------------------------------------------------
    const app = express();
    app.use(express.json());
    app.use("/groups", requireAudience("app"), groupsRouter);
    httpServer = createServer(app);
    await new Promise<void>((r) => httpServer!.listen(0, r));
    const port = (httpServer.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const token = (userId: string) =>
      issueAccessToken({ userId, deviceId: randomUUID(), sessionId: `enc43-${userId.slice(0, 8)}` });

    const call = async (method: string, path: string, userId: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await token(userId)}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, unknown>;
      return { status: res.status, json };
    };

    // --- [A] ADDITION must NOT advance the epoch ----------------------------
    console.log("\n[2] Add member -> epoch UNCHANGED");
    let r = await call("POST", `/groups/${groupId}/members`, ownerId, { memberUserIds: [joinerId] });
    assert(r.status === 200, `add joiner -> 200 (got ${r.status})`);
    assert((r.json as AddRes).added === 1, `joiner added (added=${(r.json as AddRes).added})`);
    assert((r.json as AddRes).senderKeyEpoch === 0, `add reports epoch 0 (got ${(r.json as AddRes).senderKeyEpoch})`);
    let state = await groupState(client, groupId);
    assert(state.sender_key_epoch === 0, `epoch STILL 0 after add (got ${state.sender_key_epoch})`);
    assert(state.member_count === 4, `member count now 4 (got ${state.member_count})`);

    r = await call("POST", `/groups/${groupId}/members`, ownerId, { memberUserIds: [joinerId] });
    assert(r.status === 200 && (r.json as AddRes).added === 0, `re-add joiner -> added 0 (idempotent)`);
    state = await groupState(client, groupId);
    assert(state.sender_key_epoch === 0, `epoch STILL 0 after duplicate add`);

    // --- [B] REMOVAL must advance the epoch +1 ATOMICALLY --------------------
    console.log("\n[3] Remove member -> epoch +1, atomic with the deletion");
    r = await call("DELETE", `/groups/${groupId}/members/${joinerId}`, ownerId);
    assert(r.status === 200, `remove joiner -> 200 (got ${r.status})`);
    const rem = r.json as RemoveRes;
    assert(rem.epoch?.previous === 0 && rem.epoch.current === 1, `epoch reported 0->1 (got ${JSON.stringify(rem.epoch)})`);
    state = await groupState(client, groupId);
    assert(state.sender_key_epoch === 1, `epoch is 1 in DB after removal (got ${state.sender_key_epoch})`);
    assert(state.member_count === 3, `joiner row deleted (3 members left)`);

    // --- [C] LEAVE is also a departure → +1 atomic ----------------------------
    console.log("\n[4] Leave -> epoch +1, atomic");
    r = await call("POST", `/groups/${groupId}/leave`, memberId);
    assert(r.status === 200, `member leave -> 200 (got ${r.status})`);
    const lv = r.json as RemoveRes;
    assert(lv.epoch?.previous === 1 && lv.epoch.current === 2, `leave epoch reported 1->2 (got ${JSON.stringify(lv.epoch)})`);
    state = await groupState(client, groupId);
    assert(state.sender_key_epoch === 2 && state.member_count === 2, `epoch 2, member row gone (atomic)`);

    // --- [D] Permission guards ------------------------------------------------
    console.log("\n[5] Guards: Owner/Admin-only, owner protection");
    r = await call("POST", `/groups/${groupId}/members`, outsiderId, { memberUserIds: [joinerId] });
    assert(r.status === 403 && r.json.error === "NOT_GROUP_MEMBER", `outsider add -> 403 NOT_GROUP_MEMBER`);
    r = await call("DELETE", `/groups/${groupId}/members/${ownerId}`, adminId);
    assert(r.status === 403 && r.json.error === "CANNOT_REMOVE_OWNER", `admin cannot remove owner -> 403 CANNOT_REMOVE_OWNER`);
    r = await call("POST", `/groups/${groupId}/leave`, outsiderId);
    assert(r.status === 404, `outsider leave -> 404 MEMBER_NOT_FOUND`);
    r = await call("POST", `/groups/${groupId}/members`, ownerId, { memberUserIds: [randomUUID()] });
    assert(
      r.status === 404 && r.json.error === "USER_NOT_FOUND",
      `stray (non-user / device) uuid -> clean 404 USER_NOT_FOUND, not 500 (got ${r.status} ${r.json.error})`,
    );
    state = await groupState(client, groupId);
    assert(state.sender_key_epoch === 2, `epoch still 2 after all rejected calls (got ${state.sender_key_epoch})`);

    // --- [E] 70-member cap under row lock (still never touches the epoch) -----
    console.log("\n[6] 70-member cap; additions never bump the epoch");
    const capGroupId = randomUUID();
    groupIds.push(capGroupId);
    await client.query(
      `INSERT INTO groups (id, encrypted_name) VALUES ($1, $2)`,
      [capGroupId, Buffer.from([1])],
    );
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'::group_role)`,
      [capGroupId, ownerId],
    );
    const fillerIds: string[] = [];
    for (let i = 0; i < 68; i++) fillerIds.push(randomUUID());
    const fillerPhones = fillerIds.map((_, i) => `+9194${(Date.now() * 10 + i).toString(36).slice(-8)}`);
    {
      const idsSql = fillerIds;
      let q = `INSERT INTO users (id, phone_number, name) VALUES `;
      const params: (string | Buffer)[] = [];
      idsSql.forEach((id, i) => {
        const k = params.length;
        params.push(id, fillerPhones[i]!, `filler${i}`);
        q += `($${k + 1}, $${k + 2}, $${k + 3}), `;
      });
      q = q.slice(0, -2);
      await client.query(q, params);
      userIds.push(...fillerIds);
    }
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role)
       SELECT $1, u.id, 'member'::group_role FROM unnest($2::uuid[]) AS u(id)`,
      [capGroupId, fillerIds],
    );
    let capState = await groupState(client, capGroupId);
    assert(capState.member_count === 69, `cap group seeded at 69 members (got ${capState.member_count})`);

    r = await call("POST", `/groups/${capGroupId}/members`, ownerId, { memberUserIds: [joinerId] });
    assert(r.status === 200, `add to reach exactly 70 -> 200 (got ${r.status})`);
    capState = await groupState(client, capGroupId);
    assert(capState.member_count === 70 && capState.sender_key_epoch === 0, `70 members, epoch 0 (got ${JSON.stringify(capState)})`);

    r = await call("POST", `/groups/${capGroupId}/members`, ownerId, { memberUserIds: [memberId] });
    assert(r.status === 409 && r.json.error === "GROUP_MEMBER_LIMIT", `71st -> 409 GROUP_MEMBER_LIMIT (got ${r.status} ${r.json.error})`);
    capState = await groupState(client, capGroupId);
    assert(capState.sender_key_epoch === 0, `cap-rejected add did NOT bump epoch (got ${capState.sender_key_epoch})`);

    // --- Cleanup -------------------------------------------------------------
    for (const gid of groupIds) {
      await client.query(`DELETE FROM groups WHERE id = $1`, [gid]);
    }
    for (const uid of userIds) {
      await client.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => undefined);
    }
    const leftoverGroups = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM groups WHERE id = ANY($1::uuid[])`, [groupIds],
    );
    assert(leftoverGroups.rows[0]!.n === 0, "test groups fully removed");
    const leftoverUsers = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[])`, [userIds],
    );
    assert(leftoverUsers.rows[0]!.n === 0, "test users fully removed");

    if (failures === 0) {
      console.log("\nALL CHECKS PASSED (ENC-4.3 VERIFY)");
    } else {
      console.error(`\n${failures} CHECK(S) FAILED (ENC-4.3 VERIFY)`);
      process.exit(1);
    }
  } finally {
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
    for (const gid of groupIds) {
      await client.query(`DELETE FROM groups WHERE id = $1`, [gid]).catch(() => undefined);
    }
    for (const uid of userIds) {
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
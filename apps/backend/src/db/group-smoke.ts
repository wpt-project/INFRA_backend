/**
 * Local dev helper — seed a persistent test group (owner + 1 member) and print
 * ready-made values for a manual ENC-4.3 smoke test against a running server.
 *
 * Run: pnpm --filter @wpt/backend exec tsx src/db/group-smoke.ts
 * Cleanup: DELETE FROM groups WHERE id = '<GROUP_ID>';  (after deleting users)
 *          DELETE FROM users  WHERE id IN ('<OWNER_ID>','<MEMBER_ID>');
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PoolConfig } from "pg";
import { issueAccessToken } from "../auth/jwt.js";

for (const line of readFileSync(resolve(import.meta.dirname, "../../.env"), "utf-8").split("\n")) {
  const i = line.indexOf("=");
  if (line.trim() && !line.startsWith("#") && i > 0) {
    if (!process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}
if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.error("DATABASE_URL and JWT_SECRET are required.");
  process.exit(1);
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, family: 4 } as PoolConfig);
  try {
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const groupId = randomUUID();
    const stamp = Date.now().toString(36).slice(-6);

    await pool.query(`INSERT INTO users (id, phone_number, name) VALUES ($1, $2, 'smoke owner'), ($3, $4, 'smoke member')`, [
      ownerId, `+91960${stamp}a`, memberId, `+91960${stamp}b`,
    ]);
    await pool.query(`INSERT INTO groups (id, encrypted_name) VALUES ($1, $2)`, [groupId, Buffer.from([1])]);
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'::group_role), ($1, $3, 'member'::group_role)`,
      [groupId, ownerId, memberId],
    );
    const e = await pool.query<{ sender_key_epoch: number }>(`SELECT sender_key_epoch FROM groups WHERE id = $1`, [groupId]);
    console.log("\nSeeded test group (persistent). epoch start: " + e.rows[0]!.sender_key_epoch);
    console.log("OWNER_ID:   " + ownerId);
    console.log("MEMBER_ID:  " + memberId);
    console.log("GROUP_ID:   " + groupId);
    console.log("OWNER_TOKEN:  " + (await issueAccessToken({ userId: ownerId, deviceId: randomUUID(), sessionId: `smoke-${Date.now()}` })));
    console.log("MEMBER_TOKEN: " + (await issueAccessToken({ userId: memberId, deviceId: randomUUID(), sessionId: `smoke-${Date.now()}` })));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
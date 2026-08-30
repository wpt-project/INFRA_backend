/**
 * ENC-4.1 — VERIFY script (run manually).
 * Run: pnpm --filter @wpt/backend exec tsx src/db/prekeys-replenish-test.ts
 *
 * Requires: 006_prekey_tables.sql already applied and DATABASE_URL set.
 * Requires: @wpt/crypto built (job reuses its key generation).
 *
 * Confirms, exactly as the task card asks:
 *   1. Test signed + one-time prekeys insert fine (public keys + signatures).
 *   2. No private key material is ever accepted or stored — the DB format
 *      CHECK rejects private-key-looking ("PRIVATE:...") and JSON payloads.
 *   3. Consume a test device's one-time prekeys below 20, run the replenish
 *      job, confirm the batch tops back up to 100.
 *   4. Weekly signed-prekey rotation prunes stale rows, leaving one current.
 *
 * Creates and then deletes its own test user/device. Idempotent.
 */

import pg from "pg";
import type { PoolConfig } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  countUnconsumed,
  replenishOneTimePrekeys,
  rotateSignedPrekeys,
  runPrekeyMaintenance,
  ONE_TIME_BATCH_SIZE,
} from "../jobs/prekey-maintenance.js";
import { generateIdentityKeyPair, generateX25519KeyPair } from "@wpt/crypto";

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

let failures = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, family: 4 } as PoolConfig);
  const client = await pool.connect();

  const suffix = Date.now().toString(36);
  // users.id is uuid in the live (spec) schema.
  const userId = randomUUID();
  const phone = `+91911170${suffix.slice(0, 6)}`

  try {
    // --- Seed a test user + device -----------------------------------------
    console.log("\n[1] Seeding test user + device");
    await client.query(
      `INSERT INTO users (id, phone_number, name)
       VALUES ($1, $2, 'enc4 test')`,
      [userId, phone],
    );
    const device = await client.query<{ id: string }>(
      `INSERT INTO devices (user_id, device_type, platform, identity_public_key, is_active)
       VALUES ($1, 'phone', 'android', $2, true)
       RETURNING id`,
      [userId, base64(generateIdentityKeyPair().publicKey)],
    );
    const deviceId = device.rows[0]!.id;
    console.log(`      device ${deviceId} active`);

    // --- [1a] Insert test signed prekeys (10 days old → due for rotation) --
    console.log("\n[2] Insert test signed prekeys (public keys only)");
    for (let i = 1; i <= 2; i++) {
      await client.query(
        `INSERT INTO signed_prekeys (device_id, key_id, public_key, signature, created_at)
         VALUES ($1, $2, $3, $4, now() - interval '10 days')`,
        [deviceId, i, base64(generateX25519KeyPair().publicKey), base64(generateIdentityKeyPair().publicKey)],
      );
    }
    const signedRows = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM signed_prekeys WHERE device_id = $1`,
      [deviceId],
    );
    assert(signedRows.rows[0]!.n === 2, "2 signed prekeys accepted and stored");

    // --- [1b] Insert test one-time prekeys below the 20 threshold ----------
    console.log("\n[3] Insert one-time prekeys, then RUN REPLENISH JOB");
    const seededOtps: string[] = [];
    for (let i = 1; i <= 15; i++) {
      const kp = generateX25519KeyPair();
      seededOtps.push(base64(kp.publicKey));
      kp.privateKey.fill(0);
    }
    await client.query(
      `INSERT INTO one_time_prekeys (device_id, key_id, public_key)
       SELECT $1, $2::int + k.ord - 1, k.public_key
       FROM unnest($3::text[]) WITH ORDINALITY AS k(public_key, ord)`,
      [deviceId, 1, seededOtps],
    );
    assert((await countUnconsumed(client, deviceId)) === 15, "15 unconsumed prekeys (below 20)");

    const inserted = await replenishOneTimePrekeys(client, deviceId);
    const after = await countUnconsumed(client, deviceId);
    assert(inserted === ONE_TIME_BATCH_SIZE - 15, `job inserted ${inserted} keys to top up`);
    assert(after === ONE_TIME_BATCH_SIZE, `unconsumed count back to ${after} (batches of 100)`);

    // --- [1c] Signed prekey rotation: prune stale, keep one current --------
    console.log("\n[4] Weekly signed-prekey rotation");
    const rotated = await rotateSignedPrekeys(client, deviceId);
    const signedAfter = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM signed_prekeys WHERE device_id = $1`,
      [deviceId],
    );
    assert(rotated === true, "rotation triggered (newest key was >= 7 days old)");
    assert(signedAfter.rows[0]!.n === 1, "all old signed prekeys pruned — exactly 1 current remains");

    // --- [1d] Idempotent: healthy device gets no new keys -------------------
    console.log("\n[5] Idempotency (healthy device unchanged)");
    const summary = await runPrekeyMaintenance(client);
    const unchanged = await countUnconsumed(client, deviceId);
    assert(summary.oneTimeInserted === 0, "no one-time keys re-added above the batch size");
    assert(unchanged === ONE_TIME_BATCH_SIZE, `still at ${unchanged} unconsumed`);

    // --- [2] No private key material ever accepted or stored ---------------
    console.log("\n[6] Reject private-key-looking material at the DB level");
    let rejectedPrivate = false;
    try {
      await client.query(
        `INSERT INTO one_time_prekeys (device_id, key_id, public_key)
         VALUES ($1, 99901, $2)`,
        [deviceId, "PRIVATE:" + base64(generateX25519KeyPair().privateKey)],
      );
    } catch {
      rejectedPrivate = true;
    }
    assert(rejectedPrivate, " 'PRIVATE:...' payload rejected (CHECK constraint)");

    let rejectedJson = false;
    try {
      await client.query(
        `INSERT INTO signed_prekeys (device_id, key_id, public_key, signature)
         VALUES ($1, 99902, $2, $3)`,
        [deviceId, JSON.stringify({ kind: "private", hex: "ab12" }), base64(generateIdentityKeyPair().publicKey)],
      );
    } catch {
      rejectedJson = true;
    }
    assert(rejectedJson, " JSON/oversized payload rejected (CHECK constraint)");

    const onlyPublicColumns = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name IN ('signed_prekeys', 'one_time_prekeys')
         AND column_name ILIKE '%private%'`,
    );
    assert(
      onlyPublicColumns.rows.length === 0,
      "no column in either prekey table can store a private key",
    );

    console.log("\n[7] Cleanup (remove test user/device/prekeys)");
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    const leftovers = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM devices d
       JOIN users u ON u.id = d.user_id
       WHERE u.phone_number = $1`,
      [phone],
    );
    assert(leftovers.rows[0]!.n === 0, "test data fully removed");

    if (failures === 0) {
      console.log("\nALL CHECKS PASSED (ENC-4.1 VERIFY)");
    } else {
      console.error(`\n${failures} CHECK(S) FAILED (ENC-4.1 VERIFY)`);
      process.exit(1);
    }
  } finally {
    // Ensure cleanup even on assertion failure.
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("VERIFY script failed:", err);
  process.exit(1);
});
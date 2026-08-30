/**
 * ENC-4.1 — Prekey maintenance job (scheduled).
 *
 * Run manually:  pnpm --filter @wpt/backend exec tsx src/jobs/prekey-maintenance.ts
 * In production: .github/workflows/prekey-maintenance.yml (weekly cron + manual dispatch).
 *
 * Two responsibilities per active device (Tech Arch §8.3, §8.10):
 *   1. ONE-TIME PREKEYS — if the unconsumed count drops below 20, top the
 *      batch back up to 100. The pool must NEVER run out entirely, or new
 *      session establishment with that device blocks.
 *   2. SIGNED PREKEYS — if the device has no current signed prekey or the
 *      newest one is >= 7 days old, generate a fresh one and prune every
 *      older row (weekly rotation; only "current" is ever served).
 *
 * SECURITY (§8.8): this job writes PUBLIC keys + signatures ONLY. It
 * generates throwaway keypairs, persists the public half, and scrubs/discards
 * the private half immediately. There is no code path here — and no column
 * anywhere — that stores private key material.
 *
 * Key provenance note: in this server-side scaffold the job fabricates keys
 * so batches self-top-up for testing (see VERIFY in the task card). In the
 * real protocol (ENC-4.2) prekeys are generated ON the device and uploaded;
 * this job then only tracks counts and prunes old rows.
 */

import pg from "pg";
import type { PoolClient, PoolConfig } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateX25519KeyPair, generateIdentityKeyPair, sign } from "@wpt/crypto";

const { Pool } = pg;

export const ONE_TIME_BATCH_SIZE = 100;
export const ONE_TIME_REPLENISH_THRESHOLD = 20;
export const SIGNED_PREKEY_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;

type DeviceRow = { id: string };
type CountRow = { n: number };
type LatestSignedRow = { id: string; created_at: string };

/** Public key / signature bytes encoded for storage. */
export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function queryActiveDevices(client: PoolClient): Promise<string[]> {
  const res = await client.query<DeviceRow>(
    `SELECT id FROM devices
     WHERE is_active = true AND revoked_at IS NULL`,
  );
  return res.rows.map((r) => r.id);
}

/** Number of one-time prekeys still available for this device. */
export async function countUnconsumed(client: PoolClient, deviceId: string): Promise<number> {
  const res = await client.query<CountRow>(
    `SELECT count(*)::int AS n
     FROM one_time_prekeys
     WHERE device_id = $1 AND consumed_at IS NULL`,
    [deviceId],
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * Top a device's one-time prekey batch back to 100 if it has dipped below 20.
 * Returns how many keys were inserted (0 = already healthy).
 */
export async function replenishOneTimePrekeys(
  client: PoolClient,
  deviceId: string,
): Promise<number> {
  const unconsumed = await countUnconsumed(client, deviceId);
  if (unconsumed >= ONE_TIME_REPLENISH_THRESHOLD) return 0;

  const toInsert = ONE_TIME_BATCH_SIZE - unconsumed;
  if (toInsert <= 0) return 0;

  const max = await client.query<CountRow>(
    `SELECT COALESCE(MAX(key_id), 0)::int AS n
     FROM one_time_prekeys
     WHERE device_id = $1`,
    [deviceId],
  );
  const nextId = (max.rows[0]?.n ?? 0) + 1;

  const publicKeys: string[] = [];
  for (let i = 0; i < toInsert; i++) {
    const kp = generateX25519KeyPair();
    publicKeys.push(base64(kp.publicKey));
    // Scaffold hygiene: the private half is never stored — scrub it at once.
    kp.privateKey.fill(0);
  }

  await client.query(
    `INSERT INTO one_time_prekeys (device_id, key_id, public_key)
     SELECT $1, $2::int + k.ord - 1, k.public_key
     FROM unnest($3::text[]) WITH ORDINALITY AS k(public_key, ord)`,
    [deviceId, nextId, publicKeys],
  );

  return toInsert;
}

/**
 * Rotate a device's signed prekey if the newest one is >= 7 days old (or none
 * exists). Inserts a fresh public key + signature and prunes all older rows,
 * leaving exactly one "current" signed prekey. Returns true if a rotation
 * happened.
 */
export async function rotateSignedPrekeys(
  client: PoolClient,
  deviceId: string,
): Promise<boolean> {
  const latest = await client.query<LatestSignedRow>(
    `SELECT id, created_at
     FROM signed_prekeys
     WHERE device_id = $1
     ORDER BY created_at DESC, key_id DESC
     LIMIT 1`,
    [deviceId],
  );

  const newest = latest.rows[0];
  if (
    newest &&
    Date.now() - new Date(newest.created_at).getTime() < SIGNED_PREKEY_ROTATION_MS
  ) {
    return false;
  }

  const max = await client.query<CountRow>(
    `SELECT COALESCE(MAX(key_id), 0)::int AS n
     FROM signed_prekeys
     WHERE device_id = $1`,
    [deviceId],
  );
  const nextId = (max.rows[0]?.n ?? 0) + 1;

  // Signed prekey = X25519 public key + an identity-key signature over it.
  // Scaffold: ephemeral ed25519 identity; production uses the device's own
  // persistent identity key (generated client-side, ENC-4.2).
  const xk = generateX25519KeyPair();
  const ik = generateIdentityKeyPair();
  const signature = sign(ik.privateKey, xk.publicKey);
  const publicKey = base64(xk.publicKey);
  xk.privateKey.fill(0);
  ik.privateKey.fill(0);

  await client.query(
    `INSERT INTO signed_prekeys (device_id, key_id, public_key, signature)
     VALUES ($1, $2, $3, $4)`,
    [deviceId, nextId, publicKey, base64(signature)],
  );

  // Weekly rotation = only the newest row survives.
  await client.query(
    `DELETE FROM signed_prekeys
     WHERE device_id = $1
       AND id <> (
         SELECT id FROM signed_prekeys
         WHERE device_id = $1
         ORDER BY created_at DESC, key_id DESC
         LIMIT 1
       )`,
    [deviceId],
  );

  return true;
}

export type MaintenanceSummary = {
  devicesProcessed: number;
  oneTimeInserted: number;
  signedPrekeyRotated: number;
};

/**
 * Run rotation + replenishment for every active device and report what changed.
 */
export async function runPrekeyMaintenance(client: PoolClient): Promise<MaintenanceSummary> {
  const deviceIds = await queryActiveDevices(client);

  let oneTimeInserted = 0;
  let signedPrekeyRotated = 0;

  for (const deviceId of deviceIds) {
    oneTimeInserted += await replenishOneTimePrekeys(client, deviceId);
    if (await rotateSignedPrekeys(client, deviceId)) signedPrekeyRotated += 1;
  }

  return {
    devicesProcessed: deviceIds.length,
    oneTimeInserted,
    signedPrekeyRotated,
  };
}

async function main() {
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

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in apps/backend/.env or pass it as an env var.");
    process.exit(1);
  }

  // Force IPv4 — pg defaults to IPv6 which fails with ECONNREFUSED on networks
  // without an IPv6 route to the Supabase host (same fix as other scripts).
  const pool = new Pool({ connectionString: url, family: 4 } as PoolConfig);
  const client = await pool.connect();
  try {
    const summary = await runPrekeyMaintenance(client);
    console.log("Prekey maintenance complete:", JSON.stringify(summary));
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run as a standalone script; importing the module for tests must not
// kick off a full maintenance pass.
const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((err) => {
    console.error("Prekey maintenance failed:", err);
    process.exit(1);
  });
}
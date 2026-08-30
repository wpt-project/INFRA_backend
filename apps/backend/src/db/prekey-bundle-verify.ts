/**
 * ENC-4.2 — VERIFY script (run manually).
 * Run: pnpm --filter @wpt/backend exec tsx src/db/prekey-bundle-verify.ts
 *
 * Requires: ENC-4.1 migrations applied, DATABASE_URL + JWT_SECRET set.
 *
 * Spins up an in-process Express server exposing ONLY the prekey-bundle
 * router (behind requireAudience("app")), hits the real DB through the real
 * handler, and confirms the card's acceptance steps:
 *   1. Two calls in quick succession return two DIFFERENT one-time prekeys.
 *   2. The first one-time prekey is gone from the pool immediately after the
 *      first call.
 *   3. Across the whole pool, no one-time prekey is ever reused.
 *   4. An exhausted pool returns a structured 409 (never a reused key).
 *   5. Missing token -> 401 (the endpoint is not public).
 *   6. Response contains identity key + signed prekey (+ signature), i.e.
 *      everything a sender needs for X3DH — public material only.
 *
 * Creates and then deletes its own test user/device. Idempotent.
 */

import express from "express";
import pg from "pg";
import type { PoolConfig } from "pg";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { generateIdentityKeyPair, generateX25519KeyPair, sign } from "@wpt/crypto";
import { requireAudience } from "../middleware/auth.middleware.js";
import { issueAccessToken } from "../auth/jwt.js";
import prekeyRouter from "../routes/prekey.js";

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

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

type BundleResponse = {
  success: boolean;
  bundle?: {
    deviceId: string;
    identityKey: string;
    signedPrekey: {
      keyId: number;
      publicKey: string;
      signature: string;
      createdAt: string;
    };
    oneTimePrekey: { keyId: number; publicKey: string } | null;
  };
  error?: string;
};

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, family: 4 } as PoolConfig);
  const client = await pool.connect();

  const suffix = Date.now().toString(36);
  const senderUserId = randomUUID();
  const targetUserId = randomUUID();
  const phone = `+9191120${suffix.slice(0, 5)}`;

  const seededUserIds: string[] = [];
  let httpServer: Server | null = null;

  try {
    // --- Seed sender + target (identity, signed prekey, 20 one-time keys) --
    console.log("\n[1] Seeding sender + target devices");
    await client.query(
      `INSERT INTO users (id, phone_number, name) VALUES ($1, $2, 'prekey verify sender')`,
      [senderUserId, `${phone}a`],
    );
    await client.query(
      `INSERT INTO users (id, phone_number, name) VALUES ($1, $2, 'prekey verify target')`,
      [targetUserId, `${phone}b`],
    );
    seededUserIds.push(senderUserId, targetUserId);

    const senderDevice = await client.query<{ id: string }>(
      `INSERT INTO devices (user_id, device_type, platform, identity_public_key, is_active)
       VALUES ($1, 'phone', 'android', $2, true) RETURNING id`,
      [senderUserId, base64(generateIdentityKeyPair().publicKey)],
    );

    const targetIdentity = generateIdentityKeyPair().publicKey;
    const targetDevice = await client.query<{ id: string }>(
      `INSERT INTO devices (user_id, device_type, platform, identity_public_key, is_active)
       VALUES ($1, 'phone', 'android', $2, true) RETURNING id`,
      [targetUserId, base64(targetIdentity)],
    );
    const targetDeviceId = targetDevice.rows[0]!.id;

    // One current signed prekey (freshly created => not due for rotation).
    const spX = generateX25519KeyPair();
    const spIk = generateIdentityKeyPair();
    const spSignature = sign(spIk.privateKey, spX.publicKey);
    spX.privateKey.fill(0);
    spIk.privateKey.fill(0);
    await client.query(
      `INSERT INTO signed_prekeys (device_id, key_id, public_key, signature)
       VALUES ($1, 1, $2, $3)`,
      [targetDeviceId, base64(spX.publicKey), base64(spSignature)],
    );

    // 20 unconsumed one-time prekeys (one full healthy batch).
    const otpKeys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const kp = generateX25519KeyPair();
      otpKeys.push(base64(kp.publicKey));
      kp.privateKey.fill(0);
    }
    await client.query(
      `INSERT INTO one_time_prekeys (device_id, key_id, public_key)
       SELECT $1, $2::int + k.ord - 1, k.public_key
       FROM unnest($3::text[]) WITH ORDINALITY AS k(public_key, ord)`,
      [targetDeviceId, 1, otpKeys],
    );
    assert(targetDeviceId.length > 0, `target device ${targetDeviceId} seeded with 20 one-time prekeys`);

    // --- In-process server: real router behind real auth middleware --------
    const app = express();
    app.use(express.json());
    app.use("/prekey-bundle", requireAudience("app"), prekeyRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolveListen) => {
      httpServer!.listen(0, resolveListen);
    });
    const port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // --- Mint a valid app access token for the sender ----------------------
    const token = await issueAccessToken({
      userId: senderUserId,
      deviceId: senderDevice.rows[0]!.id,
      sessionId: "prekey-bundle-verify-session",
    });

    const fetchBundle = async (authHeader: string | null) => {
      const res = await fetch(`${baseUrl}/prekey-bundle/${targetDeviceId}`, {
        method: "POST",
        headers: authHeader
          ? { Authorization: authHeader, "Content-Type": "application/json" }
          : { "Content-Type": "application/json" },
      });
      const json = (await res.json()) as BundleResponse;
      return { status: res.status, json };
    };

    // --- [1] First call -----------------------------------------------------
    console.log("\n[2] Fetch bundle #1");
    const first = await fetchBundle(`Bearer ${token}`);
    assert(first.status === 200, `status 200 (got ${first.status})`);
    assert(
      !!first.json.bundle?.identityKey && UUID_RE.test(first.json.bundle.deviceId),
      "bundle includes recipient identity public key + device id",
    );
    assert(
      first.json.bundle?.signedPrekey?.keyId === 1 &&
        first.json.bundle.signedPrekey.signature.length > 0,
      "bundle includes current signed prekey (+ signature)",
    );
    const otp1 = first.json.bundle?.oneTimePrekey;
    assert(!!otp1 && otp1.publicKey.length > 0, "bundle includes ONE one-time prekey");

    // --- First key is gone from the pool immediately (VERIFY step 3) -------
    console.log("\n[3] Verify first one-time prekey deleted immediately");
    const after1 = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM one_time_prekeys
       WHERE device_id = $1 AND key_id = $2`,
      [targetDeviceId, otp1!.keyId],
    );
    assert(after1.rows[0]!.n === 0, `first returned key (key_id ${otp1!.keyId}) is gone from the pool`);
    const unconsumed1 = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM one_time_prekeys
       WHERE device_id = $1 AND consumed_at IS NULL`,
      [targetDeviceId],
    );
    assert(unconsumed1.rows[0]!.n === 19, `pool shrank to 19 right after first call`);

    // --- [2] Second call in quick succession: different key ----------------
    console.log("\n[4] Fetch bundle #2 (quick succession)");
    const second = await fetchBundle(`Bearer ${token}`);
    const otp2 = second.json.bundle?.oneTimePrekey;
    assert(second.status === 200, `status 200 (got ${second.status})`);
    assert(!!otp2, "second call still returns a one-time prekey");
    assert(otp2!.keyId !== otp1!.keyId, `different key (${otp1!.keyId} vs ${otp2!.keyId})`);

    // --- Drain the whole pool: never reuse, then structured 409 -------------
    console.log("\n[5] Drain: every key unique, exhausted pool -> 409");
    const seen = new Set<number>([otp1!.keyId, otp2!.keyId]);
    let exhausted = false;
    for (let i = 0; i < 20; i++) {
      const r = await fetchBundle(`Bearer ${token}`);
      if (r.status === 409) {
        exhausted = true;
        assert(r.json.error === "NO_ONE_TIME_PREKEY", "exhausted pool -> structured 409 NO_ONE_TIME_PREKEY");
        break;
      }
      const otp = r.json.bundle?.oneTimePrekey;
      assert(!!otp && !seen.has(otp.keyId), `key ${otp?.keyId} not returned before`);
      assert(!!otp && otp.publicKey.length > 0, `key ${otp?.keyId} is real key material`);
      if (otp) seen.add(otp.keyId);
    }
    assert(exhausted, "drained the pool to 0 -> 409");
    assert(seen.size === 20, `exactly 20 unique prekeys were served, none twice (saw ${seen.size})`);

    // --- Missing token -> 401 (not a public endpoint) ------------------------
    console.log("\n[6] Authentication required");
    const anon = await fetchBundle(null);
    assert(anon.status === 401, `no token -> 401 (got ${anon.status})`);

    // --- Cleanup ------------------------------------------------------------
    console.log("\n[7] Cleanup");
    for (const uid of seededUserIds) {
      await client.query(`DELETE FROM users WHERE id = $1`, [uid]);
    }
    const leftovers = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM devices WHERE user_id = ANY($1::uuid[])`,
      [seededUserIds],
    );
    assert(leftovers.rows[0]!.n === 0, "test devices/prekeys fully removed (cascade)");

    if (failures === 0) {
      console.log("\nALL CHECKS PASSED (ENC-4.2 VERIFY)");
    } else {
      console.error(`\n${failures} CHECK(S) FAILED (ENC-4.2 VERIFY)`);
      process.exit(1);
    }
  } finally {
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
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
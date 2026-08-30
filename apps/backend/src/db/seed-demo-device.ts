/**
 * Local dev helper — seed a persistent demo device with a full prekey set
 * (identity + signed prekey + 100 one-time prekeys) and print a ready-to-use
 * app access token + curl for manual ENC-4.2 smoke testing against the live DB.
 *
 * Run: pnpm --filter @wpt/backend exec tsx src/db/seed-demo-device.ts
 * Cleanup: DELETE FROM users WHERE id = '<printed user id>';
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PoolConfig } from "pg";
import { generateIdentityKeyPair, generateX25519KeyPair, sign } from "@wpt/crypto";
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

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, family: 4 } as PoolConfig);
  try {
    const userId = randomUUID();
    const phone = `+9191200${Date.now().toString(36).slice(-6)}`;

    await pool.query(`INSERT INTO users (id, phone_number, name) VALUES ($1, $2, 'ENC-4.2 smoke test')`, [userId, phone]);

    const device = await pool.query<{ id: string }>(
      `INSERT INTO devices (user_id, device_type, platform, identity_public_key, is_active)
       VALUES ($1, 'phone', 'android', $2, true) RETURNING id`,
      [userId, base64(generateIdentityKeyPair().publicKey)],
    );
    const deviceId = device.rows[0]!.id;

    const spX = generateX25519KeyPair();
    const spIk = generateIdentityKeyPair();
    const sigBytes = sign(spIk.privateKey, spX.publicKey);
    spX.privateKey.fill(0);
    spIk.privateKey.fill(0);

    await pool.query(
      `INSERT INTO signed_prekeys (device_id, key_id, public_key, signature) VALUES ($1, 1, $2, $3)`,
      [deviceId, base64(spX.publicKey), base64(sigBytes)],
    );

    const otpKeys: string[] = [];
    for (let i = 0; i < 100; i++) {
      const kp = generateX25519KeyPair();
      otpKeys.push(base64(kp.publicKey));
      kp.privateKey.fill(0);
    }
    await pool.query(
      `INSERT INTO one_time_prekeys (device_id, key_id, public_key)
       SELECT $1, k.ord, k.public_key FROM unnest($2::text[]) WITH ORDINALITY AS k(public_key, ord)`,
      [deviceId, otpKeys],
    );

    const token = await issueAccessToken({ userId, deviceId, sessionId: `seed-demo-${Date.now()}` });

    console.log("\nSeeded demo target device (persistent).");
    console.log("USER_ID:   " + userId);
    console.log("DEVICE_ID: " + deviceId);
    console.log("TOKEN:     " + token);
    console.log("\nCleanup: DELETE FROM users WHERE id = '" + userId + "';");
    console.log("\ncurl -i -X POST http://127.0.0.1:<PORT>/api/v1/prekey-bundle/" + deviceId + " \\\n  -H 'Authorization: Bearer " + token + "' -H 'Content-Type: application/json'\n");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
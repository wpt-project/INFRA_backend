/**
 * ENC-4.4 — VERIFY script (run manually).
 * Run: pnpm --filter @wpt/backend exec tsx src/db/group-metadata-verify.ts
 *
 * Requires: DATABASE_URL + JWT_SECRET set. Idempotent, self-cleaning.
 *
 * Card's VERIFY step: create a test group, inspect the stored encrypted_name
 * value directly in the database, confirm it's unreadable ciphertext — not
 * plaintext or a lightly-obfuscated version of the name.
 *
 * The encryption here is done ONLY to simulate the client: we encrypt a
 * recognizable plaintext with AES-256-GCM using node:crypto (exactly what a
 * client would send), then assert the server stored and returned THOSE SAME
 * opaque bytes — i.e. the backend never decrypts, re-encodes, or "helpfully"
 * transforms the content at any point.
 */

import express from "express";
import pg from "pg";
import type { PoolConfig } from "pg";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createCipheriv } from "node:crypto";
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

type GroupResponse = {
  success: boolean;
  group?: {
    id: string;
    senderKeyEpoch?: number;
    encryptedName?: string;
    encryptedDescription?: string | null;
    encryptedIconRef?: string | null;
    whoCanSend?: string;
  };
  error?: string;
};

/**
 * Simulated client AES-256-GCM encryption. Produces `iv || tag || ciphertext`
 * and base64-encodes it — the "encrypted field" a real client would send. The
 * server must treat it as opaque bytes and never interpret the content.
 */
function clientEncrypt(plaintext: string): string {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

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
  const outsiderId = randomUUID();
  // A real uuid with NO users row -> token whose sub is not a registered user.
  const ghostId = randomUUID();
  const phone = `+91920${suffix.slice(0, 5)}`;

  const seededUserIds: string[] = [];
  let httpServer: Server | null = null;
  let groupId: string | null = null;

  try {
    // Client-chosen plaintexts (recognizable, so the VERIFY can prove it never
    // survives server-side).
    const PLAIN_NAME = "Covert Hovercraft Squadron";
    const PLAIN_DESC = "Dock 7, night shift, channel 33";
    const PLAIN_ICON = "s3://wpt/group-icons/A3F9C2E1";

    console.log("\n[1] Seeding users + client-side encryption (simulated client)");
    await client.query(
      `INSERT INTO users (id, phone_number, name) VALUES ($1, $2, 'meta owner'), ($3, $4, 'meta outsider')`,
      [ownerId, `${phone}a`, outsiderId, `${phone}b`],
    );
    seededUserIds.push(ownerId, outsiderId);

    const nameB64 = clientEncrypt(PLAIN_NAME);
    const descB64 = clientEncrypt(PLAIN_DESC);
    const iconB64 = clientEncrypt(PLAIN_ICON);
    const nameBytes = Buffer.from(nameB64, "base64");
    assert(nameBytes.length > 0, `client ciphertext for "${PLAIN_NAME.slice(0, 12)}..." generated (${nameBytes.length} bytes)`);

    // --- In-process server: real groups router behind real auth --------------
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
      sessionId: "group-meta-verify-owner",
    });
    const outsiderToken = await issueAccessToken({
      userId: outsiderId,
      deviceId: randomUUID(),
      sessionId: "group-meta-verify-outsider",
    });
    const bogusToken = await issueAccessToken({
      userId: ghostId,
      deviceId: randomUUID(),
      sessionId: "group-meta-verify-bogus",
    });

    const call = async (
      method: "POST" | "GET",
      path: string,
      token: string,
      body?: unknown,
    ): Promise<{ status: number; json: GroupResponse }> => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as GroupResponse };
    };

    // --- [2] Create a group with real client ciphertext ----------------------
    console.log("\n[2] POST /groups (create, encrypted metadata)");
    const created = await call("POST", "/groups", ownerToken, {
      encryptedName: nameB64,
      encryptedDescription: descB64,
      encryptedIconRef: iconB64,
      whoCanSend: "admins_only",
    });
    assert(created.status === 201, `create -> 201 (got ${created.status})`);
    assert(!!created.json.group?.id, "create returns a group id");
    groupId = created.json.group!.id;
    assert(created.json.group?.senderKeyEpoch === 0, "new group starts at senderKeyEpoch 0");

    // --- [3] DAMN DIRECT DB INSPECTION — the card's VERIFY step --------------
    console.log("\n[3] Inspect stored encrypted_name directly in the database");
    const stored = await client.query<{
      name_hex: string;
      name_len: number;
      desc_hex: string;
      icon_hex: string;
      who: string;
      epoch: number;
    }>(
      `SELECT encode(encrypted_name, 'hex') AS name_hex,
              octet_length(encrypted_name) AS name_len,
              encode(encrypted_description, 'hex') AS desc_hex,
              encode(encrypted_icon_ref, 'hex') AS icon_hex,
              who_can_send AS who, sender_key_epoch AS epoch
       FROM groups WHERE id = $1`,
      [groupId],
    );
    const s = stored.rows[0]!;
    const storedNameHex = s.name_hex;
    const sentNameHex = nameBytes.toString("hex");
    assert(storedNameHex === sentNameHex, `stored bytes === ciphertext bytes sent by client (exact round-trip)`);
    assert(
      storedNameHex !== Buffer.from(PLAIN_NAME, "utf8").toString("hex"),
      `stored bytes are NOT utf8 plaintext of the name`,
    );
    assert(
      storedNameHex !== Buffer.from(nameB64, "utf8").toString("hex"),
      `stored bytes are NOT base64-text of the ciphertext (raw bytea, not text blob)`,
    );
    assert(
      !storedNameHex.includes(Buffer.from(PLAIN_NAME, "utf8").toString("hex").slice(0, 8)),
      `plaintext never appears in the stored value (no light obfuscation)`,
    );
    assert(s.name_len === nameBytes.length, `octet_length matches ciphertext size (${s.name_len} bytes)`);
    assert(s.epoch === 0, `creation does not touch sender_key_epoch`);
    assert(s.desc_hex === Buffer.from(descB64, "base64").toString("hex"), `encrypted_description stored opaquely too`);
    assert(s.icon_hex === Buffer.from(iconB64, "base64").toString("hex"), `encrypted_icon_ref stored opaquely too`);

    // --- [4] GET /groups/:id returns EXACTLY the stored bytes (never decoded)
    console.log("\n[4] GET /groups/:id -> opaque base64 back");
    const info = await call("GET", `/groups/${groupId}`, ownerToken);
    assert(info.status === 200, `info -> 200 (got ${info.status})`);
    assert(info.json.group?.encryptedName === nameB64, `GET returns the identical ciphertext base64`);
    assert(info.json.group?.encryptedDescription === descB64, `description ciphertext round-trips`);
    assert(info.json.group?.encryptedIconRef === iconB64, `icon-ref ciphertext round-trips`);
    assert(info.json.group?.whoCanSend === "admins_only", `whoCanSend persisted`);
    assert(info.json.group?.senderKeyEpoch === 0, `epoch 0 in info`);

    // --- [5] Members only: a non-member must NOT receive ciphertext ----------
    console.log("\n[5] Membership gate");
    const outsider = await call("GET", `/groups/${groupId}`, outsiderToken);
    assert(outsider.status === 403 && outsider.json.error === "NOT_GROUP_MEMBER", `non-member GET -> 403 NOT_GROUP_MEMBER`);

    // --- [6] Input validation ------------------------------------------------
    console.log("\n[6] Bad inputs -> structured 400s/404s");
    const badB64 = await call("POST", "/groups", ownerToken, { encryptedName: "!!!not-base64!!!" });
    assert(badB64.status === 400 && badB64.json.error === "INVALID_ENCRYPTED_NAME", `garbage encryptedName -> 400 INVALID_ENCRYPTED_NAME`);
    const badWho = await call("POST", "/groups", ownerToken, { encryptedName: nameB64, whoCanSend: "admins" });
    assert(badWho.status === 400 && badWho.json.error === "INVALID_WHO_CAN_SEND", `bad whoCanSend -> 400 INVALID_WHO_CAN_SEND`);
    const noName = await call("POST", "/groups", ownerToken, {});
    assert(noName.status === 400 && noName.json.error === "INVALID_ENCRYPTED_NAME", `missing encryptedName -> 400`);
    const ghost = await call("POST", "/groups", bogusToken, { encryptedName: nameB64 });
    assert(ghost.status === 404 && ghost.json.error === "USER_NOT_FOUND", `non-registered requester -> 404 USER_NOT_FOUND`);
    const noGroup = await call("GET", `/groups/${randomUUID()}`, ownerToken);
    assert(noGroup.status === 404 && noGroup.json.error === "GROUP_NOT_FOUND", `unknown group -> 404 GROUP_NOT_FOUND`);

    // --- [7] Cleanup ---------------------------------------------------------
    console.log("\n[7] Cleanup");
    await client.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    for (const uid of seededUserIds) {
      await client.query(`DELETE FROM users WHERE id = $1`, [uid]);
    }
    const leftoverGroups = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM groups WHERE id = $1`,
      [groupId],
    );
    assert(leftoverGroups.rows[0]!.n === 0, `group removed`);

    if (failures === 0) {
      console.log("\nALL CHECKS PASSED (ENC-4.4 VERIFY)");
    } else {
      console.error(`\n${failures} CHECK(S) FAILED (ENC-4.4 VERIFY)`);
      process.exit(1);
    }
  } finally {
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
    if (groupId) {
      await client.query(`DELETE FROM groups WHERE id = $1`, [groupId]).catch(() => undefined);
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
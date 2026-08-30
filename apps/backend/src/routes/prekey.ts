/**
 * ENC-4.2 — Prekey-bundle fetch endpoint.
 *
 * The server-side half of the X3DH handshake (Tech Arch §8.4): a sender's
 * device calls this to fetch everything needed to start a session with a
 * recipient device:
 *   - the recipient device's identity public key
 *   - its current signed prekey (+ signature)
 *   - ONE one-time prekey (marked consumed + deleted atomically on return)
 *
 * SECURITY:
 *   - Requires a valid app-audience access token (mounted behind
 *     `requireAudience("app")` in src/index.ts). This is NOT a public endpoint.
 *   - The one-time prekey is selected with `FOR UPDATE SKIP LOCKED` inside a
 *     transaction and hard-deleted immediately, so the same key can never be
 *     handed out twice — even to concurrent requesters.
 *   - Only public key material is ever returned. Session state lives entirely
 *     client-side (§8.4); the backend's role begins and ends at distribution.
 */

import { Router, type Request, type Response } from "express";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { devices } from "../db/devices-schema.js";
import { signedPrekeys } from "../db/signed-prekeys-schema.js";

const router: Router = Router();

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type OneTimeRow = { id: string; key_id: number; public_key: string };

// ──────────────────────────────────────────────────
// POST /prekey-bundle/:deviceId
// ──────────────────────────────────────────────────
router.post("/:deviceId", async (req: Request, res: Response) => {
  try {
    const rawDeviceId = req.params.deviceId;
    if (typeof rawDeviceId !== "string" || !UUID_RE.test(rawDeviceId)) {
      res.status(400).json({
        success: false,
        error: "INVALID_DEVICE_ID",
        message: "deviceId must be a UUID",
      });
      return;
    }
    const deviceId = rawDeviceId;

    const db = getDb();

    const outcome = await db.transaction(async (tx) => {
      const [device] = await tx
        .select({
          id: devices.id,
          identityKey: devices.identityPublicKey,
        })
        .from(devices)
        .where(
          and(
            eq(devices.id, deviceId),
            eq(devices.isActive, true),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);

      if (!device || !device.identityKey) {
        return { kind: "not_found" } as const;
      }

      // "Current" signed prekey = the newest row (ENC-4.1 rotation keeps at
      // most one per device; this ordering is the tie-breaker).
      const [signedPrekey] = await tx
        .select({
          keyId: signedPrekeys.keyId,
          publicKey: signedPrekeys.publicKey,
          signature: signedPrekeys.signature,
          createdAt: signedPrekeys.createdAt,
        })
        .from(signedPrekeys)
        .where(eq(signedPrekeys.deviceId, deviceId))
        .orderBy(desc(signedPrekeys.createdAt), desc(signedPrekeys.keyId))
        .limit(1);

      if (!signedPrekey) {
        return { kind: "no_signed_prekey" } as const;
      }

      // Reserve exactly one unconsumed one-time prekey. SKIP LOCKED makes two
      // concurrent requesters take two DIFFERENT rows; with a single row left,
      // the loser gets none and we report the pool as exhausted rather than
      // reusing the same key.
      const result = (await tx.execute(
        sql`SELECT id, key_id, public_key
            FROM one_time_prekeys
            WHERE device_id = ${deviceId} AND consumed_at IS NULL
            ORDER BY key_id
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
      )) as unknown as { rows: OneTimeRow[] };

      const oneTimePrekey = result.rows[0];

      if (!oneTimePrekey) {
        // Pool exhausted — new session establishment is blocked until the
        // ENC-4.1 maintenance job (or the device) replenishes (§8.3). Surface
        // it distinctly rather than silently serving a degraded bundle.
        return { kind: "no_one_time_prekey" } as const;
      }

      // "Marked consumed and deleted immediately" — the row leaves the pool
      // in the same transaction that serves it (ENC-4.2 VERIFY step 3).
      await tx.execute(
        sql`DELETE FROM one_time_prekeys WHERE id = ${oneTimePrekey.id}`,
      );

      return {
        kind: "ok",
        bundle: {
          deviceId,
          identityKey: device.identityKey,
          signedPrekey: {
            keyId: signedPrekey.keyId,
            publicKey: signedPrekey.publicKey,
            signature: signedPrekey.signature,
            createdAt: signedPrekey.createdAt.toISOString(),
          },
          oneTimePrekey: {
            keyId: oneTimePrekey.key_id,
            publicKey: oneTimePrekey.public_key,
          },
        },
      } as const;
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({
        success: false,
        error: "DEVICE_NOT_FOUND",
        message: "No active recipient device with that id",
      });
      return;
    }

    if (outcome.kind === "no_signed_prekey") {
      res.status(409).json({
        success: false,
        error: "NO_SIGNED_PREKEY",
        message: "Recipient device has no signed prekey provisioned",
      });
      return;
    }

    if (outcome.kind === "no_one_time_prekey") {
      res.status(409).json({
        success: false,
        error: "NO_ONE_TIME_PREKEY",
        message: "Recipient device's one-time prekey pool is exhausted",
      });
      return;
    }

    res.json({ success: true, bundle: outcome.bundle });
  } catch {
    console.error("POST /prekey-bundle error");
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

export default router;
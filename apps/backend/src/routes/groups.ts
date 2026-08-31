/**
 * ENC-4.3 + ENC-4.4 — Group-membership endpoints (atomic sender_key_epoch
 * transaction) and Group-Key ciphertext storage.
 *
 * ENC-4.4 (Group Key ciphertext storage, §8.11 / §6.3) rules:
 *   - groups.encrypted_name / encrypted_description / encrypted_icon_ref are
 *     STORED AND RETURNED as opaque bytea. The backend NEVER decrypts,
 *     inspects, or logs their contents at any point.
 *   - Clients send/read these fields as base64 of the ciphertext bytes; the
 *     server decodes base64 <-> bytes and nothing else. There is deliberately
 *     NO code path that could print or transform the plaintext here.
 *
 * ENC-4.3 (THE CORE RULE, §8.5; card):
 *   - Every DEPARTURE (member removed, or member leaves) deletes the
 *     group_members row AND increments groups.sender_key_epoch by exactly 1 in
 *     the SAME transaction — structurally impossible to change membership
 *     without triggering Sender Key + Group Key rotation.
 *   - An ADDITION never touches the epoch (no retroactive access, by design).
 *   - Sender Key and Group Key rotate on this ONE column/trigger; there is no
 *     second rotation-tracking mechanism.
 *
 * Permissions (AGENTS.md / §13.5):
 *   - Add and remove members: Owner or Admin only. Owner cannot be removed
 *     (hard role != 'owner' guard). Leave = self-removal.
 *   - 70-member cap enforced under a row lock on the group.
 *
 * MANDATORY EXTRA REVIEW (Tech Arch §20.2) — flag on the PR.
 */

import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { createSignedUrl } from "../storage/signed-url.js";

const router: Router = Router();

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ROUTE_LABELS = [
  "POST /",
  "GET /:groupId",
  "POST /members",
  "DELETE /members/:userId",
  "POST /leave",
] as const;

type Row = { id: string };
type RoleRow = { role: string };
type CountRow = { n: number };
type UserIdRow = { user_id: string };
type EpochRow = { sender_key_epoch: number };
type GroupInfoRow = {
  id: string;
  encrypted_name: Buffer;
  encrypted_description: Buffer | null;
  encrypted_icon_ref: Buffer | null;
  who_can_send: string;
  sender_key_epoch: number;
  created_at: Date | string;
};

const WHO_CAN_SEND = ["everyone", "admins_only"] as const;
const ICON_BUCKET = process.env.ICON_STORAGE_BUCKET ?? "group-icons";

function invalidId(res: Response, label: string, code: string): boolean {
  res.status(400).json({
    success: false,
    error: code,
    message: `Invalid ${label}: must be a UUID`,
  });
  return false;
}

/** The requester's id from the verified app token (set by requireAudience). */
function requesterId(res: Response): string | null {
  const auth = res.locals.auth as { sub?: string } | undefined;
  return auth?.sub ?? null;
}

/** base64-encode opaque ciphertext bytes for the wire (never interpreted). */
function b64(bytes: Buffer): string {
  return bytes.toString("base64");
}

/**
 * Strictly decode a client-supplied base64 ciphertext field. Returns ok:false
 * for anything that is not well-formed base64 (the round-trip re-encode must
 * match — Buffer.from() alone won't reject garbage). The bytes stay opaque:
 * this function never looks at their content.
 */
function base64ToBytes(value: unknown): { ok: true; bytes: Buffer } | { ok: false } {
  if (typeof value !== "string" || value.length === 0) return { ok: false };
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) return { ok: false };
  return { ok: true, bytes };
}

// ──────────────────────────────────────────────────
// POST /groups — create a group (ENC-4.4). Stores opaque encrypted metadata.
// ──────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const me = requesterId(res);
    if (!me) {
      res.status(401).json({ success: false, error: "TOKEN_REQUIRED" });
      return;
    }

    const body = req.body as {
      encryptedName?: unknown;
      encryptedDescription?: unknown;
      encryptedIconRef?: unknown;
      whoCanSend?: unknown;
    };

    const name = base64ToBytes(body.encryptedName);
    if (!name.ok) {
      res.status(400).json({
        success: false,
        error: "INVALID_ENCRYPTED_NAME",
        message: "encryptedName must be a non-empty base64 string of the encrypted group name",
      });
      return;
    }

    const description =
      body.encryptedDescription === undefined || body.encryptedDescription === null
        ? null
        : (() => {
            const dec = base64ToBytes(body.encryptedDescription);
            if (!dec.ok) {
              res.status(400).json({
                success: false,
                error: "INVALID_ENCRYPTED_DESCRIPTION",
                message: "encryptedDescription must be a non-empty base64 string when provided",
              });
              return undefined;
            }
            return dec.bytes;
          })();
    if (description === undefined) return;

    const iconRef =
      body.encryptedIconRef === undefined || body.encryptedIconRef === null
        ? null
        : (() => {
            const dec = base64ToBytes(body.encryptedIconRef);
            if (!dec.ok) {
              res.status(400).json({
                success: false,
                error: "INVALID_ENCRYPTED_ICON_REF",
                message: "encryptedIconRef must be a non-empty base64 string when provided",
              });
              return undefined;
            }
            return dec.bytes;
          })();
    if (iconRef === undefined) return;

    let whoCanSend: (typeof WHO_CAN_SEND)[number] = "everyone";
    if (body.whoCanSend !== undefined && body.whoCanSend !== null) {
      if (
        typeof body.whoCanSend !== "string" ||
        !WHO_CAN_SEND.includes(body.whoCanSend as (typeof WHO_CAN_SEND)[number])
      ) {
        res.status(400).json({
          success: false,
          error: "INVALID_WHO_CAN_SEND",
          message: "whoCanSend must be 'everyone' or 'admins_only'",
        });
        return;
      }
      whoCanSend = body.whoCanSend as (typeof WHO_CAN_SEND)[number];
    }

    const db = getDb();

    const outcome = await db.transaction(async (tx) => {
      const userRows = (await tx.execute(
        sql`SELECT id FROM users WHERE id = ${me}`,
      )) as unknown as { rows: Row[] };
      if (userRows.rows.length === 0) return { kind: "user_not_found" } as const;

      // Opaque bytes only (ENC-4.4): the encrypted fields are stored exactly
      // as received — never decrypted, inspected, or logged.
      const inserted = (await tx.execute(
        sql`INSERT INTO groups (encrypted_name, encrypted_description, encrypted_icon_ref, who_can_send)
            VALUES (${name.bytes}, ${description}, ${iconRef}, ${whoCanSend})
            RETURNING id, sender_key_epoch`,
      )) as unknown as { rows: { id: string; sender_key_epoch: number }[] };
      const group = inserted.rows[0]!;

      await tx.execute(
        sql`INSERT INTO group_members (group_id, user_id, role)
            VALUES (${group.id}, ${me}, 'owner'::group_role)`,
      );

      return { kind: "ok", id: group.id, senderKeyEpoch: group.sender_key_epoch } as const;
    });

    if (outcome.kind === "user_not_found") {
      res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
      return;
    }
    res.status(201).json({
      success: true,
      group: { id: outcome.id, senderKeyEpoch: outcome.senderKeyEpoch, yourRole: "owner" },
    });
  } catch {
    console.error(`${ROUTE_LABELS[0]} error`);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// GET /groups/:groupId — group info (ENC-4.4). Returns opaque encrypted
// metadata as base64, exactly as stored. Members only.
// ──────────────────────────────────────────────────
router.get("/:groupId", async (req: Request, res: Response) => {
  try {
    const rawGroupId = req.params.groupId;
    if (typeof rawGroupId !== "string" || !UUID_RE.test(rawGroupId)) {
      invalidId(res, "groupId", "INVALID_GROUP_ID");
      return;
    }
    const groupId = rawGroupId;

    const me = requesterId(res);
    if (!me) {
      res.status(401).json({ success: false, error: "TOKEN_REQUIRED" });
      return;
    }

    const db = getDb();

    const outcome = await db.transaction(async (tx) => {
      const groupRows = (await tx.execute(
        sql`SELECT id, encrypted_name, encrypted_description, encrypted_icon_ref,
                   who_can_send, sender_key_epoch, created_at
            FROM groups WHERE id = ${groupId}`,
      )) as unknown as { rows: GroupInfoRow[] };
      const group = groupRows.rows[0];
      if (!group) return { kind: "not_found" } as const;

      // Members only: metadata is Group-Key encrypted, so non-members must not
      // receive even the ciphertext (it would be undecryptable noise + a hint).
      const myRows = (await tx.execute(
        sql`SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${me}`,
      )) as unknown as { rows: RoleRow[] };
      if (myRows.rows.length === 0) return { kind: "not_a_member" } as const;

      return {
        kind: "ok",
        info: {
          id: group.id,
          encryptedName: b64(group.encrypted_name),
          encryptedDescription: group.encrypted_description ? b64(group.encrypted_description) : null,
          encryptedIconRef: group.encrypted_icon_ref ? b64(group.encrypted_icon_ref) : null,
          whoCanSend: group.who_can_send,
          senderKeyEpoch: group.sender_key_epoch,
          createdAt: typeof group.created_at === "string" ? group.created_at : group.created_at.toISOString(),
        },
      } as const;
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ success: false, error: "GROUP_NOT_FOUND" });
      return;
    }
    if (outcome.kind === "not_a_member") {
      res.status(403).json({ success: false, error: "NOT_GROUP_MEMBER" });
      return;
    }
    res.json({ success: true, group: outcome.info });
  } catch (err) {
    console.error(`${ROUTE_LABELS[1]} error`, err);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// GET /groups/:groupId/icon — membership-gated signed download URL (ENC-4.5).
// The icon flows through the E2EE media pipeline (§11.1): the backend never
// decrypts the bytes; it only issues a short-lived signed URL to the storage
// object referenced by encrypted_icon_ref, gated on current membership.
// ──────────────────────────────────────────────────
router.get("/:groupId/icon", async (req: Request, res: Response) => {
  try {
    const rawGroupId = req.params.groupId;
    if (typeof rawGroupId !== "string" || !UUID_RE.test(rawGroupId)) {
      invalidId(res, "groupId", "INVALID_GROUP_ID");
      return;
    }
    const groupId = rawGroupId;

    const me = requesterId(res);
    if (!me) {
      res.status(401).json({ success: false, error: "TOKEN_REQUIRED" });
      return;
    }

    const db = getDb();

    const outcome = await db.transaction(async (tx) => {
      // Existence + fetch the storage pointer in one shot.
      const groupRows = (await tx.execute(
        sql`SELECT id, encrypted_icon_ref FROM groups WHERE id = ${groupId}`,
      )) as unknown as { rows: { id: string; encrypted_icon_ref: Buffer | null }[] };
      const group = groupRows.rows[0];
      if (!group) return { kind: "not_found" } as const;
      if (!group.encrypted_icon_ref || group.encrypted_icon_ref.length === 0) {
        return { kind: "no_icon" } as const;
      }

      // Membership gate (ENC-4.5): same check as GET info.
      const myRows = (await tx.execute(
        sql`SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${me}`,
      )) as unknown as { rows: RoleRow[] };
      if (myRows.rows.length === 0) return { kind: "not_a_member" } as const;

      // Decode the opaque bytea pointer to a UTF-8 storage path (the pointer
      // itself is not secret; it's just an opaque bucket key).
      const storagePath = group.encrypted_icon_ref.toString("utf-8");

      return { kind: "ok", storagePath } as const;
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ success: false, error: "GROUP_NOT_FOUND" });
      return;
    }
    if (outcome.kind === "no_icon") {
      res.status(404).json({
        success: false,
        error: "ICON_NOT_FOUND",
        message: "This group has no icon set",
      });
      return;
    }
    if (outcome.kind === "not_a_member") {
      res.status(403).json({ success: false, error: "NOT_GROUP_MEMBER" });
      return;
    }

    // Issue a short-lived signed download URL from Supabase Storage.
    const signedUrl = await createSignedUrl(ICON_BUCKET, outcome.storagePath);
    if (!signedUrl) {
      // Deliberately log NO storage path / object key: it is an opaque media
      // pointer we never need to repeat on the failure path (ENC-4.6 audit).
      console.error("GET /:groupId/icon: failed to create signed URL");
      res.status(500).json({ success: false, error: "STORAGE_URL_FAILED" });
      return;
    }

    res.json({
      success: true,
      iconUrl: signedUrl,
      expiresIn: 3600,
      storagePath: outcome.storagePath,
    });
  } catch {
    console.error("GET /:groupId/icon error");
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// POST /groups/:groupId/members — batch add. NEVER advances the epoch.
// ──────────────────────────────────────────────────
router.post("/:groupId/members", async (req: Request, res: Response) => {
  try {
    const rawGroupId = req.params.groupId;
    if (typeof rawGroupId !== "string" || !UUID_RE.test(rawGroupId)) {
      invalidId(res, "groupId", "INVALID_GROUP_ID");
      return;
    }
    const groupId = rawGroupId;

    const me = requesterId(res);
    if (!me) {
      res.status(401).json({ success: false, error: "TOKEN_REQUIRED" });
      return;
    }

    const body = req.body as { memberUserIds?: unknown };
    const rawIds = body.memberUserIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      res.status(400).json({
        success: false,
        error: "INVALID_MEMBER_IDS",
        message: "memberUserIds must be a non-empty array of UUIDs",
      });
      return;
    }
    const memberUserIds = [...new Set(rawIds.filter((v): v is string => typeof v === "string" && UUID_RE.test(v)))];
    if (memberUserIds.length === 0) {
      res.status(400).json({
        success: false,
        error: "INVALID_MEMBER_IDS",
        message: "memberUserIds must contain at least one valid UUID",
      });
      return;
    }

    const db = getDb();

    const outcome = await db.transaction(async (tx) => {
      // Row-lock the group: serializes concurrent adds against the same group
      // so the 70-member cap cannot be raced past.
      const groupRows = (await tx.execute(
        sql`SELECT id, sender_key_epoch FROM groups WHERE id = ${groupId} LIMIT 1 FOR UPDATE`,
      )) as unknown as { rows: (Row & { sender_key_epoch: number })[] };
      if (groupRows.rows.length === 0) {
        return { kind: "not_found" } as const;
      }
      const senderKeyEpoch = groupRows.rows[0]!.sender_key_epoch;

      const myRoleRows = (await tx.execute(
        sql`SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${me}`,
      )) as unknown as { rows: RoleRow[] };
      const myRole = myRoleRows.rows[0]?.role;
      if (!myRole) return { kind: "not_a_member" } as const;
      if (myRole !== "owner" && myRole !== "admin") {
        return { kind: "forbidden" } as const;
      }

      // Only real users may be added — verify the ids exist in `users` BEFORE
      // touching group_members, so a stray/device/nonexistent uuid returns a
      // clean 404 instead of a 500 FK violation (node-postgres error 23503).
      const userRows = (await tx.execute(
        sql`SELECT id FROM users WHERE id = ANY(${sql.param(memberUserIds)}::uuid[])`,
      )) as unknown as { rows: Row[] };
      const knownUsers = new Set(userRows.rows.map((r) => r.id));
      const missing = memberUserIds.filter((id) => !knownUsers.has(id));
      if (missing.length > 0) {
        return { kind: "user_not_found", missingUserIds: missing } as const;
      }

      const existingRows = (await tx.execute(
        sql`SELECT user_id FROM group_members WHERE group_id = ${groupId} AND user_id = ANY(${sql.param(memberUserIds)}::uuid[])`,
      )) as unknown as { rows: UserIdRow[] };
      const alreadyMembers = new Set(existingRows.rows.map((r) => r.user_id));
      const freshIds = memberUserIds.filter((id) => !alreadyMembers.has(id));

      const countRows = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM group_members WHERE group_id = ${groupId}`,
      )) as unknown as { rows: CountRow[] };
      const currentCount = countRows.rows[0]?.n ?? 0;
      if (currentCount + freshIds.length > 70) {
        return { kind: "limit" } as const;
      }

      if (freshIds.length > 0) {
        // Additions NEVER advance sender_key_epoch (§8.5).
        // Belt-and-suspenders: a concurrent user deletion during this tx is
        // surfaced as a clean 404, not a 500.
        try {
          await tx.execute(
            sql`INSERT INTO group_members (group_id, user_id, role)
                SELECT ${groupId}, u.id, 'member'::group_role
                FROM unnest(${sql.param(freshIds)}::uuid[]) AS u(id)
                ON CONFLICT (group_id, user_id) DO NOTHING`,
          );
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === "23503") return { kind: "user_not_found", missingUserIds: freshIds } as const;
          throw err;
        }
      }

      return {
        kind: "ok",
        added: freshIds.length,
        skipped: memberUserIds.length - freshIds.length,
        memberCount: currentCount + freshIds.length,
        senderKeyEpoch,
      } as const;
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ success: false, error: "GROUP_NOT_FOUND" });
      return;
    }
    if (outcome.kind === "user_not_found") {
      res.status(404).json({
        success: false,
        error: "USER_NOT_FOUND",
        message: "memberUserIds contains ids that are not registered users",
        missingUserIds: outcome.missingUserIds,
      });
      return;
    }
    if (outcome.kind === "not_a_member") {
      res.status(403).json({ success: false, error: "NOT_GROUP_MEMBER" });
      return;
    }
    if (outcome.kind === "forbidden") {
      res.status(403).json({
        success: false,
        error: "NOT_GROUP_ADMIN",
        message: "Adding members is Owner/Admin-only",
      });
      return;
    }
    if (outcome.kind === "limit") {
      res.status(409).json({
        success: false,
        error: "GROUP_MEMBER_LIMIT",
        message: "Group cannot exceed 70 members",
      });
      return;
    }
    res.json({
      success: true,
      added: outcome.added,
      skipped: outcome.skipped,
      memberCount: outcome.memberCount,
      senderKeyEpoch: outcome.senderKeyEpoch,
    });
  } catch {
    console.error(`${ROUTE_LABELS[2]} error`);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// DELETE /groups/:groupId/members/:userId — remove a member. Epoch +1 ATOMIC.
// ──────────────────────────────────────────────────
router.delete("/:groupId/members/:userId", async (req: Request, res: Response) => {
  try {
    const rawGroupId = req.params.groupId;
    const rawUserId = req.params.userId;
    if (typeof rawGroupId !== "string" || !UUID_RE.test(rawGroupId)) {
      invalidId(res, "groupId", "INVALID_GROUP_ID");
      return;
    }
    if (typeof rawUserId !== "string" || !UUID_RE.test(rawUserId)) {
      invalidId(res, "userId", "INVALID_USER_ID");
      return;
    }
    const groupId = rawGroupId;
    const targetUserId = rawUserId;

    const me = requesterId(res);
    if (!me) {
      res.status(401).json({ success: false, error: "TOKEN_REQUIRED" });
      return;
    }

    const db = getDb();

    const outcome = await db.transaction(async (tx) => {
      const myRoleRows = (await tx.execute(
        sql`SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${me}`,
      )) as unknown as { rows: RoleRow[] };
      const myRole = myRoleRows.rows[0]?.role;
      if (!myRole) return { kind: "not_a_member" } as const;
      if (myRole !== "owner" && myRole !== "admin") {
        return { kind: "forbidden" } as const;
      }

      const targetRows = (await tx.execute(
        sql`SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${targetUserId}`,
      )) as unknown as { rows: RoleRow[] };
      const targetRole = targetRows.rows[0]?.role;
      if (!targetRole) return { kind: "target_not_found" } as const;
      if (targetRole === "owner") return { kind: "cannot_remove_owner" } as const;

      // Departure: delete the row AND bump the epoch in one atomic unit of
      // work (§8.5 / §13.6-resolution). Rolled back together on any failure.
      const deletedRows = (await tx.execute(
        sql`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${targetUserId} RETURNING user_id`,
      )) as unknown as { rows: UserIdRow[] };
      if (deletedRows.rows.length === 0) {
        return { kind: "target_not_found" } as const;
      }

      const epochRows = (await tx.execute(
        sql`UPDATE groups SET sender_key_epoch = sender_key_epoch + 1
            WHERE id = ${groupId} RETURNING sender_key_epoch`,
      )) as unknown as { rows: EpochRow[] };
      const currentEpoch = epochRows.rows[0]?.sender_key_epoch ?? 0;

      return {
        kind: "ok",
        removedUserId: targetUserId,
        previousEpoch: currentEpoch - 1,
        currentEpoch,
      } as const;
    });

    if (outcome.kind === "not_a_member" || outcome.kind === "forbidden") {
      res.status(403).json({
        success: false,
        error: outcome.kind === "not_a_member" ? "NOT_GROUP_MEMBER" : "NOT_GROUP_ADMIN",
      });
      return;
    }
    if (outcome.kind === "target_not_found") {
      res.status(404).json({ success: false, error: "MEMBER_NOT_FOUND" });
      return;
    }
    if (outcome.kind === "cannot_remove_owner") {
      res.status(403).json({
        success: false,
        error: "CANNOT_REMOVE_OWNER",
        message: "The group owner cannot be removed by anyone",
      });
      return;
    }
    res.json({
      success: true,
      removedUserId: outcome.removedUserId,
      epoch: { previous: outcome.previousEpoch, current: outcome.currentEpoch },
    });
  } catch {
    console.error(`${ROUTE_LABELS[3]} error`);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// POST /groups/:groupId/leave — self-removal. Epoch +1 ATOMIC.
// ──────────────────────────────────────────────────
router.post("/:groupId/leave", async (req: Request, res: Response) => {
  try {
    const rawGroupId = req.params.groupId;
    if (typeof rawGroupId !== "string" || !UUID_RE.test(rawGroupId)) {
      invalidId(res, "groupId", "INVALID_GROUP_ID");
      return;
    }
    const groupId = rawGroupId;

    const me = requesterId(res);
    if (!me) {
      res.status(401).json({ success: false, error: "TOKEN_REQUIRED" });
      return;
    }

    const db = getDb();

    const outcome = await db.transaction(async (tx) => {
      const myRows = (await tx.execute(
        sql`SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${me}`,
      )) as unknown as { rows: RoleRow[] };
      if (myRows.rows.length === 0) return { kind: "not_a_member" } as const;

      const deletedRows = (await tx.execute(
        sql`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${me} RETURNING user_id`,
      )) as unknown as { rows: UserIdRow[] };
      if (deletedRows.rows.length === 0) {
        return { kind: "not_a_member" } as const;
      }

      const epochRows = (await tx.execute(
        sql`UPDATE groups SET sender_key_epoch = sender_key_epoch + 1
            WHERE id = ${groupId} RETURNING sender_key_epoch`,
      )) as unknown as { rows: EpochRow[] };
      const currentEpoch = epochRows.rows[0]?.sender_key_epoch ?? 0;

      return {
        kind: "ok",
        previousEpoch: currentEpoch - 1,
        currentEpoch,
      } as const;
    });

    if (outcome.kind === "not_a_member") {
      res.status(404).json({ success: false, error: "MEMBER_NOT_FOUND" });
      return;
    }
    res.json({
      success: true,
      leftUserId: me,
      epoch: { previous: outcome.previousEpoch, current: outcome.currentEpoch },
    });
  } catch {
    console.error(`${ROUTE_LABELS[4]} error`);
    res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

export default router;
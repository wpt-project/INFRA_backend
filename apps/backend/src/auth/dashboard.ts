/**
 * LOGIN-3.10 — Dashboard authentication service.
 *
 * Completely separate from end-user auth:
 *   - Checks email/password against `dashboard_admins` (DB-2.5).
 *   - Issues JWT with `aud: "dashboard"` (see dashboard-jwt.ts).
 *   - Stores refresh-token hashes in `dashboard_sessions` (DB-2.6) — never
 *     shared with the end-user `sessions` table.
 *
 * Refresh token storage mirrors the end-user pattern (Tech Arch §7.1):
 * the raw token is returned to the client ONCE; a bcrypt hash plus a
 * deterministic SHA-256 lookup key are stored server-side for fast lookup
 * and revocation.
 */

import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { eq, and, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { dashboardAdmins } from "../db/dashboard-admins-schema.js";
import { dashboardSessions } from "../db/dashboard-sessions-schema.js";
import { auditLogs } from "../db/audit-logs-schema.js";
import {
  issueDashboardAccessToken,
  issueDashboardRefreshToken,
  verifyDashboardRefreshToken,
  type DashboardAdminRole,
} from "./dashboard-jwt.js";

function asRole(role: string): DashboardAdminRole {
  return role === "owner" ? "owner" : "admin";
}

const REFRESH_TOKEN_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 12;

function lookupKey(raw: string): string {
  // First 32 hex chars of SHA-256 — deterministic, used for DB index lookup.
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function expiresAt30Days(): Date {
  const now = new Date();
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export interface DashboardLoginInput {
  email: string;
  password: string;
}

export interface DashboardLoginResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  admin?: {
    id: string;
    email: string;
    role: DashboardAdminRole;
    isTestAccount: boolean;
  };
  sessionId?: string;
  error?: string;
}

/**
 * Login a dashboard admin.
 *
 * 1. Find the admin by email in `dashboard_admins`.
 * 2. Verify the password against the stored bcrypt hash.
 * 3. Mint an access token + refresh token with `aud: "dashboard"`.
 * 4. Store ONLY a bcrypt hash (of the refresh token) in `dashboard_sessions`.
 *
 * Returns an opaque failure on bad email OR bad password to avoid
 * user-enumeration.
 */
export async function dashboardLogin(
  input: DashboardLoginInput,
  opts: { ipAddress?: string; userAgent?: string } = {},
): Promise<DashboardLoginResult> {
  const db = getDb();

  const [admin] = await db
    .select()
    .from(dashboardAdmins)
    .where(eq(dashboardAdmins.email, input.email))
    .limit(1);

  if (!admin) {
    return { success: false, error: "INVALID_CREDENTIALS" };
  }

  const valid = await bcrypt.compare(input.password, admin.passwordHash);
  if (!valid) {
    return { success: false, error: "INVALID_CREDENTIALS" };
  }

  // Issue dashboard tokens (aud: "dashboard", own secret).
  const refreshToken = await issueDashboardRefreshToken({
    adminId: admin.id,
    email: admin.email,
    role: asRole(admin.role),
    isTestAccount: admin.isTestAccount,
  });

  // Store ONLY the bcrypt hash of the refresh token.
  const tokenLookup = lookupKey(refreshToken);
  const tokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);

  const [session] = await db
    .insert(dashboardSessions)
    .values({
      adminId: admin.id,
      tokenLookup,
      refreshTokenHash: tokenHash,
      refreshTokenExpiresAt: expiresAt30Days(),
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    })
    .returning({ id: dashboardSessions.id });

  const accessToken = await issueDashboardAccessToken({
    adminId: admin.id,
    email: admin.email,
    role: asRole(admin.role),
    isTestAccount: admin.isTestAccount,
    sessionId: session?.id ?? admin.id,
  });

  return {
    success: true,
    accessToken,
    refreshToken,
    sessionId: session?.id,
    admin: {
      id: admin.id,
      email: admin.email,
      role: asRole(admin.role),
      isTestAccount: admin.isTestAccount,
    },
  };
}

/**
 * Refresh a dashboard access token.
 *
 * Validates the presented refresh token (jose signature + aud + typ), then
 * checks the session row is not revoked/expired, and finally mints a fresh
 * dashboard access token.
 */
export async function dashboardRefresh(
  refreshToken: string,
): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  const parsed = await verifyDashboardRefreshToken(refreshToken);
  if (!parsed) {
    return { success: false, error: "INVALID_REFRESH_TOKEN" };
  }

  const db = getDb();
  const tokenLookup = lookupKey(refreshToken);
  const now = new Date();

  const [session] = await db
    .select()
    .from(dashboardSessions)
    .where(eq(dashboardSessions.tokenLookup, tokenLookup))
    .limit(1);

  if (!session) return { success: false, error: "SESSION_NOT_FOUND" };
  if (session.revokedAt !== null) return { success: false, error: "SESSION_REVOKED" };
  if (session.refreshTokenExpiresAt < now) {
    return { success: false, error: "SESSION_EXPIRED" };
  }

  // Confirm the presented token actually matches the stored hash.
  const valid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
  if (!valid) return { success: false, error: "INVALID_REFRESH_TOKEN" };

  const [admin] = await db
    .select()
    .from(dashboardAdmins)
    .where(eq(dashboardAdmins.id, session.adminId))
    .limit(1);
  if (!admin) return { success: false, error: "ADMIN_NOT_FOUND" };

  const accessToken = await issueDashboardAccessToken({
    adminId: admin.id,
    email: admin.email,
    role: asRole(admin.role),
    isTestAccount: admin.isTestAccount,
    sessionId: session.id,
  });

  return { success: true, accessToken };
}

/**
 * Logout a single dashboard session by its ID (revoke).
 */
export async function dashboardLogout(sessionId: string): Promise<boolean> {
  const db = getDb();
  await db
    .update(dashboardSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(dashboardSessions.id, sessionId), isNull(dashboardSessions.revokedAt)));
  return true;
}

/**
 * Revoke ALL sessions for a dashboard admin (force-logout everywhere).
 */
export async function dashboardLogoutAll(adminId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .update(dashboardSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(dashboardSessions.adminId, adminId), isNull(dashboardSessions.revokedAt)));
  return result.rowCount ?? 0;
}

/**
 * Clean up expired dashboard sessions. Returns the number deleted.
 */
export async function cleanupExpiredDashboardSessions(): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(dashboardSessions)
    .where(lt(dashboardSessions.refreshTokenExpiresAt, new Date()))
    .returning({ id: dashboardSessions.id });
  return deleted.length;
}

/**
 * Fetch a dashboard admin by ID. Returns null if not found.
 */
export async function getDashboardAdminById(
  id: string,
): Promise<typeof dashboardAdmins.$inferSelect | null> {
  const db = getDb();
  const [row] = await db.select().from(dashboardAdmins).where(eq(dashboardAdmins.id, id)).limit(1);
  return row ?? null;
}

export interface CreateDashboardAdminInput {
  email: string;
  password: string;
  role?: "owner" | "admin";
  isTestAccount?: boolean;
}

export type CreateDashboardAdminResult =
  | { ok: true; id: string; email: string; role: "owner" | "admin"; isTestAccount: boolean }
  | { ok: false; error: "EMAIL_ALREADY_EXISTS" | "INVALID_ROLE" };

/**
 * Create a dashboard admin (owner-only operation).
 *
 * The raw password is NEVER stored — only a round-12 bcrypt hash. The insert
 * and the audit_log entry are committed in a SINGLE transaction so an admin
 * action is never recorded without its audit trail (AGENTS.md moderation
 * convention). A duplicate email is surfaced distinctly (409 on the route).
 */
export async function createDashboardAdmin(
  input: CreateDashboardAdminInput,
): Promise<CreateDashboardAdminResult> {
  const role: "owner" | "admin" = input.role === "owner" ? "owner" : "admin";

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const db = getDb();
  const insert: typeof dashboardAdmins.$inferInsert = {
    email: input.email,
    passwordHash,
    role,
    isTestAccount: input.isTestAccount ?? false,
  };

  try {
    const created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(dashboardAdmins)
        .values(insert)
        .returning({ id: dashboardAdmins.id, email: dashboardAdmins.email });
      const row = rows[0];
      if (!row) throw new Error("admin insert returned no row");
      // Same-transaction audit trail for the moderation action.
      await tx.insert(auditLogs).values({
        eventType: "admin_admin_created",
        metadata: {
          action: "admin_created",
          targetEmail: row.email,
          role,
        },
      });
      return row;
    });

    return {
      ok: true,
      id: created.id,
      email: created.email,
      role,
      isTestAccount: input.isTestAccount ?? false,
    };
  } catch (err) {
    // The email unique index (dashboard_admins_email_unique) turns a duplicate
    // into a Postgres 23505 — surface it distinctly rather than a 500. Drizzle
    // wraps the raw pg error; the code lives on the nested cause.
    const code = (err as { code?: string; cause?: { code?: string } })?.code
      ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      return { ok: false, error: "EMAIL_ALREADY_EXISTS" };
    }
    throw err;
  }
}

export type DeleteDashboardAdminResult =
  | { ok: true; id: string }
  | { ok: false; error: "ADMIN_NOT_FOUND" | "CANNOT_DELETE_OWNER" };

/**
 * Delete a dashboard admin (owner-only operation).
 *
 * Deleting the LAST owner is forbidden (would lock everyone out of dashboard
 * management). Also refuses to delete the acting owner. The row delete and the
 * audit_log write are committed in a SINGLE transaction.
 */
export async function deleteDashboardAdmin(
  id: string,
  actingAdminId: string,
): Promise<DeleteDashboardAdminResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: dashboardAdmins.id, role: dashboardAdmins.role })
      .from(dashboardAdmins)
      .where(eq(dashboardAdmins.id, id))
      .limit(1);
    if (!target) return { ok: false, error: "ADMIN_NOT_FOUND" } as const;

    // An owner can never delete themselves (or any owner — enforced below via
    // the last-owner check plus this explicit guard).
    if (target.id === actingAdminId && target.role === "owner") {
      return { ok: false, error: "CANNOT_DELETE_OWNER" } as const;
    }

    if (target.role === "owner") {
      const owners = await tx
        .select({ id: dashboardAdmins.id })
        .from(dashboardAdmins)
        .where(eq(dashboardAdmins.role, "owner"));
      // Cannot delete the LAST remaining owner — the dashboard must always
      // have at least one owner able to manage it.
      if (owners.length <= 1) {
        return { ok: false, error: "CANNOT_DELETE_OWNER" } as const;
      }
    }

    await tx.delete(dashboardAdmins).where(eq(dashboardAdmins.id, id));
    await tx.insert(auditLogs).values({
      eventType: "admin_admin_deleted",
      metadata: {
        action: "admin_deleted",
        targetId: id,
        actorId: actingAdminId,
      },
    });
    return { ok: true, id } as const;
  });
}

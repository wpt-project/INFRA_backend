/**
 * DB-2.6 — dashboard_sessions table.
 *
 * Stores one row per active dashboard session. This is a SEPARATE
 * table from the end-user `sessions` table — the two systems never
 * share refresh-token storage.
 *
 * The refresh token is stored as a bcrypt hash — the raw token is only
 * ever held in memory on the server and in the admin client's secure
 * storage. A deterministic lookup key (first 32 hex chars of SHA-256)
 * is stored alongside the bcrypt hash so the DB can index lookups fast
 * (bcrypt hashes are non-deterministic due to random salt).
 *
 * `revokedAt` is the kill-switch column: a non-null value instantly
 * invalidates the session on the next refresh attempt.
 */

import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

export const dashboardSessions = pgTable(
  "dashboard_sessions",
  {
    /** Primary key — session identifier. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** The dashboard admin who owns this session. */
    adminId: uuid("admin_id").notNull(),

    /**
     * Deterministic lookup key — first 32 hex chars of SHA-256(raw_token).
     * Used for fast DB index lookups; bcrypt hash is used for actual
     * verification (bcrypt is non-deterministic due to random salt).
     */
    tokenLookup: varchar("token_lookup", { length: 32 }).notNull(),

    /** Bcrypt hash of the refresh token (12 rounds). Raw token NEVER stored. */
    refreshTokenHash: varchar("refresh_token_hash", { length: 60 }).notNull(),

    /** When the refresh token expires (30 days from issuance). */
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }).notNull(),

    /** Kill-switch column: NULL = active, non-null = revoked. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /** IP address of the client at login. */
    ipAddress: varchar("ip_address", { length: 45 }),

    /** User-agent header at login. */
    userAgent: text("user_agent"),

    /** Row creation time. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Fast lookup by admin (for "log out all sessions" flows).
    index("dashboard_sessions_admin_id_idx").on(table.adminId),
    // Fast lookup by token_lookup (the hot path on every refresh).
    index("dashboard_sessions_token_lookup_idx").on(table.tokenLookup),
    // Fast cleanup of revoked/expired sessions.
    index("dashboard_sessions_revoked_at_idx").on(table.revokedAt),
  ],
);

export type DashboardSessionRow = typeof dashboardSessions.$inferSelect;
export type DashboardSessionInsert = typeof dashboardSessions.$inferInsert;

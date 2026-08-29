/**
 * DB-2.5 — dashboard_admins table.
 *
 * Stores one row per dashboard administrator. This is a COMPLETELY
 * SEPARATE identity from the end-user `users` table — dashboard admins
 * are staff (owner / admin) of the WPT Admin Dashboard, not app users.
 *
 * The password is stored as a bcrypt hash — the raw password is never
 * persisted. The `role` decides privilege: `owner` can manage admins
 * and reset the account, `admin` is a standard staff account.
 *
 * `is_test_account` flags QA / staging accounts so they can be routed
 * to test schemas without any client-supplied input (the flag is always
 * derived server-side from the authenticated token).
 */

import { pgTable, uuid, varchar, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

export const dashboardAdmins = pgTable(
  "dashboard_admins",
  {
    /** Primary key — deterministic admin identifier. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** Login email — unique across all dashboard admins. */
    email: varchar("email", { length: 255 }).notNull(),

    /** Bcrypt hash of the password. Raw password is NEVER stored. */
    passwordHash: text("password_hash").notNull(),

    /** Privilege level. `owner` can manage admins; `admin` is standard. */
    role: varchar("role", { length: 16 }).notNull().default("admin"),

    /** Test/QA flag — routes this account to test schemas, server-side only. */
    isTestAccount: boolean("is_test_account").notNull().default(false),

    /** Owner-only password reset token hash. */
    ownerResetTokenHash: text("owner_reset_token_hash"),

    /** Expiry for the owner reset token. */
    ownerResetTokenExpiresAt: timestamp("owner_reset_token_expires_at", {
      withTimezone: true,
    }),

    /** Row creation time. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Last update time. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Unique login email.
    uniqueIndex("dashboard_admins_email_unique").on(table.email),
    // Fast lookup by email (the hot path on dashboard login).
    index("dashboard_admins_email_idx").on(table.email),
  ],
);

export type DashboardAdminRow = typeof dashboardAdmins.$inferSelect;
export type DashboardAdminInsert = typeof dashboardAdmins.$inferInsert;

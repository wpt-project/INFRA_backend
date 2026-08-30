/**
 * DB-2.x — Devices table (unified phone + Web).
 *
 * Prerequisite for ENC-4.1's prekey tables (foreign key target) and the
 * tech-arch §6.2 model: one table for BOTH phone and Web devices so
 * new-device force-logout is a single query, not a cross-table join.
 *
 * `identity_public_key` holds the device's Signal identity key (public).
 * No private key material ever lives here, or anywhere on the server (§8.8).
 */

import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const devices = pgTable(
  "devices",
  {
    /** Primary key — referenced by signed_prekeys / one_time_prekeys. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** The user who owns this device (matches users.id). */
    userId: uuid("user_id").notNull(),

    /** phone or web — a user may have at most one of each active. */
    deviceType: text("device_type", { enum: ["phone", "web"] }).notNull(),

    /** android, ios, or web. */
    platform: text("platform", { enum: ["android", "ios", "web"] }).notNull(),

    /** Signal identity public key — never the private half. */
    identityPublicKey: text("identity_public_key"),

    /** Kill switch: false/revoked rows are ignored by the prekey job. */
    isActive: boolean("is_active").notNull().default(true),

    /** When the device was linked. */
    linkedAt: timestamp("linked_at", { withTimezone: true }),

    /** Last heartbeat seen from the device. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    /** Non-null = device force-revoked (new-device login / ban). */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /** Row creation time. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("devices_user_id_idx").on(table.userId),
    index("devices_active_idx").on(table.userId, table.isActive),
  ],
);
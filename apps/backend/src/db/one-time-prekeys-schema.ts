/**
 * ENC-4.1 — One-time prekeys table.
 *
 * Each active device keeps a batch of 100 single-use X25519 public keys
 * (Tech Arch §8.3, §8.10). Every X3DH handshake consumes exactly one; the
 * row is marked `consumed_at` and hard-deleted on use. The prekey
 * maintenance job tops the batch back up to 100 whenever the unconsumed
 * count drops below 20 — the pool must never be allowed to run out
 * entirely, or new session establishment with that device blocks.
 *
 * SECURITY: public keys ONLY, same regime as signed_prekeys.
 */

import { pgTable, uuid, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { devices } from "./devices-schema.js";

export const oneTimePrekeys = pgTable(
  "one_time_prekeys",
  {
    /** Primary key. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** The device that owns this prekey (FK to devices). */
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),

    /** Monotonic per-device key identifier. */
    keyId: integer("key_id").notNull(),

    /** X25519 public key (base64). Private half never exists server-side. */
    publicKey: text("public_key").notNull(),

    /** Non-null after this key has been issued for a handshake. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),

    /** Row creation time. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("one_time_prekeys_device_id_idx").on(table.deviceId, table.keyId),
    index("one_time_prekeys_unconsumed_idx").on(table.deviceId, table.consumedAt),
  ],
);
/**
 * ENC-4.1 — Signed prekeys table.
 *
 * Holds the public half + identity-key signature of each device's current
 * signed prekey (Tech Arch §8.3, §8.10). Rotated weekly by the prekey
 * maintenance job: it inserts a freshly generated public key / signature
 * and prunes every older row, so at any moment each device has exactly one
 * row — the "current" signed prekey served in its prekey bundle.
 *
 * SECURITY: public keys and signatures ONLY. There is no column that could
 * hold a private key, and the DB-level format CHECK rejects anything that
 * is not base64.
 */

import { pgTable, uuid, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { devices } from "./devices-schema.js";

export const signedPrekeys = pgTable(
  "signed_prekeys",
  {
    /** Primary key. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** The device that owns this prekey (FK to devices). */
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),

    /** Monotonic per-device key identifier — unbundles the key out of plain sight. */
    keyId: integer("key_id").notNull(),

    /** X25519 public key (base64). Private half never exists server-side. */
    publicKey: text("public_key").notNull(),

    /** Identity-key signature over the public key (base64). */
    signature: text("signature").notNull(),

    /** When this prekey was generated (= rotation timestamp). */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("signed_prekeys_device_id_idx").on(table.deviceId, table.keyId),
    index("signed_prekeys_created_at_idx").on(table.deviceId, table.createdAt),
  ],
);
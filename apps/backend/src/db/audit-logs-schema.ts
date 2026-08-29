/**
 * DB — LOGIN-3.12 — OTP audit log table.
 *
 * Records WHICH verification path fired for an OTP send (Android SIM-presence
 * check vs. iOS/standard OTP-over-SMS) for internal audit / compliance ONLY.
 *
 * SECURITY:
 *   - The `platform` column is never returned to the client. The OTP response
 *     is identical for every platform (PRD §5.2, Scenario 4.1 "invisibility
 *     requirement").
 *   - Reads are restricted to dashboard admins (the admin route family is
 *     gated by requireDashboardAuth). End users / public have no access.
 *   - Retention target: 30+ days (deletion is deliberately not automated here).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Event type discriminator — always "otp_request" for now. */
    eventType: text("event_type").notNull(),

    /** Recipient phone number (E.164). */
    phoneNumber: text("phone_number"),

    /** Detected platform: "android_sim" | "ios_otp". Never client-visible. */
    platform: text("platform"),

    /** Verification path: "sim_check" | "otp_sms". */
    verificationPath: text("verification_path"),

    /** When the event occurred. */
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    sessionId: text("session_id"),

    /** Flexible JSON payload for future audit events. */
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_timestamp_idx").on(table.timestamp),
    index("audit_logs_phone_number_idx").on(table.phoneNumber),
    index("audit_logs_platform_idx").on(table.platform),
    index("audit_logs_event_type_idx").on(table.eventType),
  ],
);

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  customType,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Drizzle's pg-core doesn't ship a built-in bytea type -- this is the
// standard workaround (customType), used for the encrypted group
// metadata columns in §6.3 / §8.11.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ---- Enums (§6.1-6.3) ----

export const themePreferenceEnum = pgEnum("theme_preference", [
  "light",
  "dark",
  "system",
]);

export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "warned",
  "restricted",
  "banned",
]);

export const deviceTypeEnum = pgEnum("device_type", ["phone", "web"]);

export const platformEnum = pgEnum("platform", ["android", "ios", "web"]);

export const whoCanSendEnum = pgEnum("who_can_send", [
  "everyone",
  "admins_only",
]);

export const groupRoleEnum = pgEnum("group_role", [
  "owner",
  "admin",
  "member",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "reviewed",
  "actioned",
  "dismissed",
]);



// ---- §6.1 users ----
// phone_number is the plaintext account identifier -- distinct from the
// hashed copies used for OTHER people's contact matching (§14, separate
// contact_hashes table, not part of this ticket).
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneNumber: text("phone_number").notNull().unique(),
    name: text("name").notNull(),
    aboutStatus: text("about_status")
      .notNull()
      .default("Hey there, I'm using WPT!"),
    profilePhotoUrl: text("profile_photo_url"),
    themePreference: themePreferenceEnum("theme_preference")
      .notNull()
      .default("system"),
    presenceVisible: boolean("presence_visible").notNull().default(true),
    globalNotificationsEnabled: boolean("global_notifications_enabled")
      .notNull()
      .default(true),
    accountStatus: accountStatusEnum("account_status")
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    // NOT NULL + default only stops it from ever being NULL. This CHECK
    // is what actually enforces "can never be fully cleared" -- blocks
    // an empty string too, which the ticket explicitly calls out.
    aboutStatusNotEmpty: check(
      "about_status_not_empty",
      sql`${table.aboutStatus} <> ''`
    ),
  })
);

// ---- §6.2 devices ----
// One shared table for phone AND Web -- deliberately, per the TAD, so a
// force-logout is a single query across every device type, not a
// cross-table join.
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceType: deviceTypeEnum("device_type").notNull(),
  platform: platformEnum("platform").notNull(),
  identityPublicKey: text("identity_public_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  linkedAt: timestamp("linked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ---- §6.3 groups ----
// name/icon/description are ciphertext (bytea), not plain text -- the
// backend never has a readable copy. No who_can_edit_info column on
// purpose: editing follows the same Owner/Admin-only rule as adding
// members (§13.3), there is no "everyone" mode for either.
export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  encryptedName: bytea("encrypted_name").notNull(),
  encryptedIconRef: bytea("encrypted_icon_ref"),
  encryptedDescription: bytea("encrypted_description"),
  whoCanSend: whoCanSendEnum("who_can_send").notNull().default("everyone"),
  // Crypto logic that increments this on departure lives elsewhere
  // (§8.5/§13.6) -- this ticket only adds the column.
  senderKeyEpoch: integer("sender_key_epoch").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---- §6.3 group_members ----
// Composite PK (group_id, user_id) -- a user can only appear once per
// group, enforced at the DB level, not just application logic.
export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: groupRoleEnum("role").notNull(),
    // Drives auto-promotion ordering if the Owner leaves (§13.4) --
    // longest-tenured member (joined_at ascending) gets promoted.
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.userId] }),
  })
);

// ---- §6.4 message_relay ----
// Temporary encrypted message waiting room.
// One row represents delivery of one message to ONE recipient device.
// Message content is always ciphertext; plaintext is never stored here.

export const messageRelay = pgTable(
  "message_relay",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    senderDeviceId: uuid("sender_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),

    recipientDeviceId: uuid("recipient_device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),

    // Exactly ONE of these two must be populated.
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),

    recipientGroupId: uuid("recipient_group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),

    // Encrypted message content only. Never plaintext.
    ciphertext: bytea("ciphertext").notNull(),

    messageType: text("message_type").notNull(),

    sizeBytes: integer("size_bytes").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),

    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => ({
    // A relay row must target either a user OR a group, never both,
    // and never neither.
    recipientExactlyOne: check(
      "message_relay_recipient_exactly_one",
      sql`(
        (${table.recipientUserId} IS NOT NULL AND ${table.recipientGroupId} IS NULL)
        OR
        (${table.recipientUserId} IS NULL AND ${table.recipientGroupId} IS NOT NULL)
      )`
    ),

    // Payload size cannot be negative.
    sizeBytesNonNegative: check(
      "message_relay_size_bytes_non_negative",
      sql`${table.sizeBytes} >= 0`
    ),
  })
);
// ---- §6.5 / §14.1-14.2 contact_hashes ----
// Stores only the deterministic SHA-256 contact hash.
// The plaintext phone number is never stored here.

export const contactHashes = pgTable("contact_hashes", {
  phoneHash: text("phone_hash").primaryKey(),

  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

// ---- §6.6 blocks ----
// Block relationships are keyed by phone_hash rather than user_id so that
// the relationship survives account deletion and re-registration.

export const blocks = pgTable(
  "blocks",
  {
    blockerPhoneHash: text("blocker_phone_hash").notNull(),
    blockedPhoneHash: text("blocked_phone_hash").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.blockerPhoneHash, table.blockedPhoneHash],
    }),

    cannotBlockSelf: check(
      "blocks_cannot_block_self",
      sql`${table.blockerPhoneHash} <> ${table.blockedPhoneHash}`
    ),
  })
);

// ---- §6.6 reports ----

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),

  reporterPhoneHash: text("reporter_phone_hash").notNull(),

  reportedPhoneHash: text("reported_phone_hash").notNull(),

  status: reportStatusEnum("status").notNull().default("pending"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

  actionedAt: timestamp("actioned_at", { withTimezone: true }),
});

// ---- §6.6 report_evidence ----
// Stores the message evidence submitted with a real user report.
// Application logic must enforce the privacy-minimizing limit:
// min(last 20 messages, all messages from the last 7 days).

export const reportEvidence = pgTable("report_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),

  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),

  messageContent: text("message_content").notNull(),

  messageCreatedAt: timestamp("message_created_at", {
    withTimezone: true,
  }).notNull(),

  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---- §6.6 test_reports ----
// Isolated admin-dashboard test data. Never used for real reports.

export const testReports = pgTable("test_reports", {
  id: uuid("id").primaryKey().defaultRandom(),

  reporterPhoneHash: text("reporter_phone_hash").notNull(),

  reportedPhoneHash: text("reported_phone_hash").notNull(),

  status: reportStatusEnum("status").notNull().default("pending"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

  actionedAt: timestamp("actioned_at", { withTimezone: true }),
});

// ---- §6.6 test_report_evidence ----

export const testReportEvidence = pgTable("test_report_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),

  testReportId: uuid("test_report_id")
    .notNull()
    .references(() => testReports.id, { onDelete: "cascade" }),

  messageContent: text("message_content").notNull(),

  messageCreatedAt: timestamp("message_created_at", {
    withTimezone: true,
  }).notNull(),

  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---- §6.7 Dashboard Admins ----

export const dashboardAdminRoleEnum = pgEnum("dashboard_admin_role", [
  "owner",
  "admin",
]);

export const dashboardAdmins = pgTable("dashboard_admins", {
  id: uuid("id").primaryKey().defaultRandom(),

  email: text("email").notNull().unique(),

  // NEVER store the plaintext dashboard password.
  passwordHash: text("password_hash").notNull(),

  role: dashboardAdminRoleEnum("role").notNull().default("admin"),

  // Keeps test dashboard accounts completely distinguishable
  // from real moderation accounts.
  isTestAccount: boolean("is_test_account").notNull().default(false),

  // Hashed reset token; never store the raw token.
  ownerResetTokenHash: text("owner_reset_token_hash"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---- §6.7 Audit Log ----

export const auditActionEnum = pgEnum("audit_action", [
  "warn",
  "restrict",
  "ban",
  "dismiss",
]);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Dashboard admin who performed the moderation action.
  adminId: uuid("admin_id")
    .notNull()
    .references(() => dashboardAdmins.id, { onDelete: "restrict" }),

  action: auditActionEnum("action").notNull(),

  // The account identified by phone_hash rather than user_id,
  // so the moderation history survives account recreation.
  targetPhoneHash: text("target_phone_hash").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
import 'dotenv/config';
import { db } from '../db/index.js';
import {
  messageRelay,
  reportEvidence,
  users,
  otpVerifications,
} from '../db/schema.js';
import { sql, lt, or, isNotNull } from 'drizzle-orm';

export async function runCleanupJob() {
  console.log('Starting automated cleanup job...');

  const now = new Date();

  // ------------------------------------------------------------
  // 1. MESSAGE RELAY CLEANUP
  // ------------------------------------------------------------
  // Delete messages when either:
  //   - delivery has been acknowledged, OR
  //   - the message is older than 30 days.
  //
  // Whichever happens first.
  // ------------------------------------------------------------

  const thirtyDaysAgo = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000
  );

  const deletedMessages = await db
    .delete(messageRelay)
    .where(
      or(
        isNotNull(messageRelay.deliveredAt),
        lt(messageRelay.createdAt, thirtyDaysAgo)
      )
    )
    .returning({ id: messageRelay.id });

  console.log(
    `Cleaned up ${deletedMessages.length} expired/delivered relay messages.`
  );

  // ------------------------------------------------------------
  // 2. REPORT EVIDENCE CLEANUP
  // ------------------------------------------------------------
  // Evidence is permanently deleted 30 days after it was captured.
  //
  // IMPORTANT:
  // This intentionally does NOT check the report status.
  // Pending, reviewed, actioned and dismissed reports are all
  // subject to the same 30-day evidence retention period.
  // ------------------------------------------------------------

  const deletedEvidence = await db
    .delete(reportEvidence)
    .where(lt(reportEvidence.capturedAt, thirtyDaysAgo))
    .returning({ id: reportEvidence.id });

  console.log(
    `Cleaned up ${deletedEvidence.length} expired report evidence records.`
  );

  // ------------------------------------------------------------
  // 3. SOFT-DELETED USER CLEANUP
  // ------------------------------------------------------------
  // A deleted account remains for 48 hours.
  // After that period, the user row can be permanently deleted.
  //
  // IMPORTANT:
  // This does NOT delete blocks or reports.
  // Those tables are intentionally independent of this cleanup.
  // ------------------------------------------------------------

  const fortyEightHoursAgo = new Date(
    now.getTime() - 48 * 60 * 60 * 1000
  );

  const purgedUsers = await db
    .delete(users)
    .where(
      sql`${users.deletedAt} IS NOT NULL AND ${users.deletedAt} < ${fortyEightHoursAgo}`
    )
    .returning({ id: users.id });

  console.log(
    `Purged ${purgedUsers.length} soft-deleted users past 48h cooldown.`
  );

  // ------------------------------------------------------------
  // 4. EXPIRED OTP CLEANUP
  // ------------------------------------------------------------
  // OTP verification records are no longer useful after their
  // expiration time, so permanently remove them.
  // ------------------------------------------------------------

  const deletedOtps = await db
    .delete(otpVerifications)
    .where(lt(otpVerifications.expiresAt, now))
    .returning({ id: otpVerifications.id });

  console.log(
    `Cleaned up ${deletedOtps.length} expired OTP records.`
  );

  // ------------------------------------------------------------
  // IMPORTANT: BLOCKS AND REPORTS ARE NEVER TOUCHED HERE
  // ------------------------------------------------------------
  //
  // Do NOT add:
  //
  //   db.delete(blocks)
  //   db.delete(reports)
  //
  // Blocks and reports must survive account deletion permanently.
  // This preserves moderation history and block relationships when
  // a user deletes and later recreates an account.
  // ------------------------------------------------------------

  console.log('✓ Automated cleanup job completed successfully.');
}

// ------------------------------------------------------------
// Run directly when invoked through CLI / scheduled job
// ------------------------------------------------------------

runCleanupJob()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Cleanup job failed:', err);
    process.exit(1);
  });
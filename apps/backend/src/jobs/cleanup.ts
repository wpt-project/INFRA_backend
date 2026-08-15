import 'dotenv/config';
import { db } from '../db/index.ts';
import {
  messageRelay,
  reportEvidence,
  users,
  otpVerifications,
} from '../db/schema.ts';
import { sql, lt, or, isNotNull } from 'drizzle-orm';

export async function runCleanupJob() {
  console.log('Starting automated cleanup job...');
  const now = new Date();

  // 1. Delete Messages/Media in Relay (Delivered OR > 30 days old)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const deletedMessages = await db
    .delete(messageRelay)
    .where(
      or(
        isNotNull(messageRelay.deliveredAt),
        lt(messageRelay.createdAt, thirtyDaysAgo)
      )
    )
    .returning({ id: messageRelay.id });

  console.log(`Cleaned up ${deletedMessages.length} expired/delivered relay messages.`);

  // 2. Delete Report Evidence > 30 days old (Regardless of review status)
  const deletedEvidence = await db
    .delete(reportEvidence)
    .where(lt(reportEvidence.capturedAt, thirtyDaysAgo))
    .returning({ id: reportEvidence.id });

  console.log(`Cleaned up ${deletedEvidence.length} expired report evidence records.`);

  // 3. Purge Soft-Deleted Users past the 48-Hour Cooldown
  // (Phone numbers are released for re-registration after 48 hours)
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const purgedUsers = await db
    .delete(users)
    .where(
      sql`${users.deletedAt} IS NOT NULL AND ${users.deletedAt} < ${fortyEightHoursAgo}`
    )
    .returning({ id: users.id });

  console.log(`Purged ${purgedUsers.length} soft-deleted users past 48h cooldown.`);

  // 4. Delete Expired OTP Verifications
  const deletedOtps = await db
    .delete(otpVerifications)
    .where(lt(otpVerifications.expiresAt, now))
    .returning({ id: otpVerifications.id });

  console.log(`Cleaned up ${deletedOtps.length} expired OTP records.`);

  console.log('✓ Automated cleanup job completed successfully.');
}

// Run directly if invoked via CLI
runCleanupJob()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cleanup job failed:', err);
    process.exit(1);
  });
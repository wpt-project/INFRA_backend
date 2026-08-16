import 'dotenv/config';
import { db } from '../db/index.ts';
import {
  users,
  otpVerifications,
  blocks,
  reports,
} from '../db/schema.ts';
import { runCleanupJob } from './cleanup.ts';
import { eq } from 'drizzle-orm';

async function verifyCleanup() {
  console.log('--- Setting Up Cleanup Test Data ---');

  const now = new Date();
  const past48Hours = new Date(now.getTime() - 49 * 60 * 60 * 1000);

  // 1. Insert an expired OTP record
  const [testOtp] = await db
    .insert(otpVerifications)
    .values({
      phoneNumber: '+10000000000',
      codeHash: 'hash',
      expiresAt: new Date(now.getTime() - 60000),
    })
    .returning();

  // 2. Insert a soft-deleted user past 48h cooldown
  const [testUser] = await db
    .insert(users)
    .values({
      phoneNumber: '+10000000001',
      name: 'Test Delete User',
      deletedAt: past48Hours,
    })
    .returning();

  // 3. Insert a block record (MUST NOT BE DELETED)
  await db.insert(blocks).values({
    blockerPhoneHash: 'hash_a',
    blockedPhoneHash: 'hash_b',
  });

  // 4. Insert a report record (MUST NOT BE DELETED)
  const [testReport] = await db
    .insert(reports)
    .values({
      reporterPhoneHash: 'hash_a',
      reportedPhoneHash: 'hash_b',
    })
    .returning();

  console.log('✓ Test data inserted.');
  console.log('--- Executing Cleanup Job ---');

  await runCleanupJob();

  console.log('--- Asserting Persistence & Purges ---');

  // Verify OTP was deleted
  const otpCheck = await db
    .select()
    .from(otpVerifications)
    .where(eq(otpVerifications.id, testOtp.id));
  console.log(`Expired OTP deleted: ${otpCheck.length === 0}`);

  // Verify User was deleted
  const userCheck = await db
    .select()
    .from(users)
    .where(eq(users.id, testUser.id));
  console.log(`Soft-deleted user purged: ${userCheck.length === 0}`);

  // Verify Block still exists (MUST NOT TOUCH)
  const blockCheck = await db
    .select()
    .from(blocks)
    .where(eq(blocks.blockerPhoneHash, 'hash_a'));
  console.log(`Block record intact: ${blockCheck.length > 0}`);

  // Verify Report still exists (MUST NOT TOUCH)
  const reportCheck = await db
    .select()
    .from(reports)
    .where(eq(reports.id, testReport.id));
  console.log(`Report record intact: ${reportCheck.length > 0}`);

  // Cleanup test blocks & reports
  await db.delete(blocks).where(eq(blocks.blockerPhoneHash, 'hash_a'));
  await db.delete(reports).where(eq(reports.id, testReport.id));

  console.log('✓ Verification complete!');
  process.exit(0);
}

verifyCleanup().catch((err) => {
  console.error('Test verification failed:', err);
  process.exit(1);
});
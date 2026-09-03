/**
 * Deterministic phone-number hash for blocks / reports tables.
 *
 * The blocks and reports tables are keyed by `phone_hash` (NOT the
 * raw phone number) to avoid storing PII (Tech Arch §6.6). Using the
 * same hash function on the same phone number always yields the same
 * result, so a block/report survives account delete-and-recreate.
 */

import { createHash } from "node:crypto";

/**
 * Compute a stable, non-reversible hash for a phone number.
 * Returns a hex string (64 chars = SHA-256).
 */
export function phoneHash(phoneNumber: string): string {
  return createHash("sha256").update(phoneNumber).digest("hex");
}
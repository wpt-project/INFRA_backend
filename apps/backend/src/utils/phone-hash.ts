/**
 * Deterministic phone-number hash for blocks / reports / contact_hashes tables.
 *
 * The blocks, reports, and contact_hashes tables are keyed by `phone_hash`
 * (NOT the raw phone number) to avoid storing PII (Tech Arch §6.6, §6.5).
 * Using the same hash function on the same phone number always yields the
 * same result, so a block/report survives account delete-and-recreate.
 *
 * Hash formula (Tech Arch §6.5, §14.2): SHA-256(global_salt + E.164_phone)
 *
 * IMPORTANT: phoneNumber MUST already be normalized to E.164 before calling
 * this function. Use normalizePhoneNumber() first to ensure format invariance.
 */

import { createHash } from "node:crypto";
import { normalizePhoneNumber } from "./phone-normalize.js";
import type { CountryCode } from "libphonenumber-js";

/**
 * Compute a stable, non-reversible hash for a phone number.
 * Returns a hex string (64 chars = SHA-256).
 *
 * @param phoneNumber - E.164-formatted phone number (e.g. "+919876543210")
 * @returns SHA-256(CONTACT_HASH_SALT + phoneNumber) as hex
 * @throws Error if CONTACT_HASH_SALT env var is not set
 */
export function phoneHash(phoneNumber: string): string {
  const salt = process.env.CONTACT_HASH_SALT;

  if (!salt) {
    throw new Error(
      "CONTACT_HASH_SALT environment variable is required for phone hashing. " +
      "Generate one with: openssl rand -hex 32"
    );
  }

  return createHash("sha256").update(salt + phoneNumber).digest("hex");
}

/**
 * Normalize and hash a phone number in one step.
 * Ensures format invariance: different input formats of the same number
 * produce identical hashes.
 *
 * @param phoneNumber - Raw phone number in any format
 * @param defaultCountry - Optional country code (e.g. "US", "IN")
 * @returns SHA-256(CONTACT_HASH_SALT + normalized_E.164) as hex, or null if invalid
 *
 * @example
 *   phoneHashNormalized("9876543210", "IN")    → same hash
 *   phoneHashNormalized("+91 98765 43210")     → same hash
 *   phoneHashNormalized("+919876543210")       → same hash
 */
export function phoneHashNormalized(
  phoneNumber: string,
  defaultCountry?: CountryCode,
): string | null {
  const normalized = normalizePhoneNumber(phoneNumber, defaultCountry);
  if (!normalized) {
    return null;
  }
  return phoneHash(normalized);
}
/**
 * LOGIN-3.12 — OTP audit logger.
 *
 * Detects which OTP verification path fired (Android SIM-presence check vs.
 * iOS/standard OTP-over-SMS) and records it to the internal `audit_logs` table
 * for audit/compliance ONLY.
 *
 * SECURITY (PRD §5.2 / Scenario 4.1 — "invisibility requirement"):
 *   - The detected platform is NEVER returned to the client. OTP responses are
 *     identical for every platform.
 *   - Logging NEVER throws — a failed audit write must not block the OTP flow.
 *   - Reads are admin-only (the /admin route family is gated by
 *     requireDashboardAuth); end users / public have no access.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Request } from "express";
import { getDb } from "../db/index.js";
import { auditLogs } from "../db/audit-logs-schema.js";

export type OtpPlatform = "android_sim" | "ios_otp";
export type OtpVerificationPath = "sim_check" | "otp_sms";

export interface OtpPlatformContext {
  userAgent?: string;
  androidSimAvailable?: string | boolean;
}

export interface OtpAuditLogEntry {
  phoneNumber: string;
  platform: OtpPlatform;
  verificationPath: OtpVerificationPath;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

export interface OtpAuditQuery {
  phoneNumber?: string;
  platform?: OtpPlatform;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

/**
 * Detect the verification path from request/client signals. Internal only.
 *
 * Android with SIM-presence capability -> "android_sim" (sim_check).
 * Everything else (iOS, web, unknown)  -> "ios_otp" (otp_sms).
 */
export function detectPlatform(ctx: OtpPlatformContext): OtpPlatform {
  const ua = (ctx.userAgent ?? "").toLowerCase();
  const isAndroid = ua.includes("android");
  const simCapable =
    String(ctx.androidSimAvailable).toLowerCase() === "true" ||
    ctx.androidSimAvailable === true;

  if (isAndroid && simCapable) {
    return "android_sim";
  }
  return "ios_otp";
}

/** Human-readable verification path for the audit log. */
export function getVerificationPath(platform: OtpPlatform): OtpVerificationPath {
  return platform === "android_sim" ? "sim_check" : "otp_sms";
}

/**
 * Resolve the real client IP address.
 *
 * Relies on Express `req.ip`, which returns the client address only when the
 * app is configured with `trust proxy` (see src/index.ts). When the app sits
 * behind a trusted proxy (TRUST_PROXY=1), req.ip reflects the true client IP
 * from `X-Forwarded-For`; otherwise it is the socket/loopback address. Falls
 * back to the raw socket address as a last resort.
 */
export function getClientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

/**
 * Resolve the timezone used for local display.
 *
 * Uses `APP_TIMEZONE` when set (IANA name, e.g. "Asia/Kolkata"); otherwise
 * falls back to the runtime's local timezone.
 */
function resolveTimezone(): string {
  const tz = process.env.APP_TIMEZONE;
  if (tz && tz.trim()) return tz.trim();
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Format a timestamp as a local-time ISO string, e.g. 2026-08-28T22:09:38.123+05:30. */
export function toLocalIsoTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  const tz = resolveTimezone();
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    fractionalSecondDigits: 3,
    timeZoneName: "longOffset",
  });

  const partsRaw = dtf.formatToParts(date);
  const parts: Record<string, string> = {};
  for (const p of partsRaw) parts[p.type] = p.value;

  const hour = parts.hour === "24" ? "00" : parts.hour;
  let offset = "+00:00";
  const m = (parts.timeZoneName ?? "").match(/GMT([+-]\d{2}:\d{2})/);
  if (m) offset = m[1];

  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond ?? "000"}${offset}`;
}

/**
 * Write a single OTP-request audit entry. Never throws — a failure to log must
 * not affect the OTP response (which stays identical for every platform).
 */
export async function logOtpRequest(entry: OtpAuditLogEntry): Promise<void> {
  try {
    const db = getDb();
    await db.insert(auditLogs).values({
      eventType: "otp_request",
      phoneNumber: entry.phoneNumber,
      platform: entry.platform,
      verificationPath: entry.verificationPath,
      timestamp: entry.timestamp,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      sessionId: entry.sessionId ?? null,
      metadata: {
        platform: entry.platform,
        verificationPath: entry.verificationPath,
      },
    });
  } catch (err) {
    console.error("Audit logger error (non-blocking):", err);
  }
}

/**
 * Query recent OTP audit entries. Intended for the admin dashboard only —
 * callers must be behind the dashboard auth gate.
 */
export async function getOtpAuditLogs(
  filters: OtpAuditQuery = {},
): Promise<OtpAuditLogEntry[]> {
  const db = getDb();
  const conditions = [];

  if (filters.phoneNumber) {
    conditions.push(eq(auditLogs.phoneNumber, filters.phoneNumber));
  }
  if (filters.platform) {
    conditions.push(eq(auditLogs.platform, filters.platform));
  }
  if (filters.startDate) {
    conditions.push(gte(auditLogs.timestamp, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(auditLogs.timestamp, filters.endDate));
  }

  const rows = await db
    .select()
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.timestamp))
    .limit(filters.limit ?? 50);

  return rows.map((row) => ({
    phoneNumber: row.phoneNumber ?? "",
    platform: (row.platform as OtpPlatform) ?? "ios_otp",
    verificationPath: (row.verificationPath as OtpVerificationPath) ?? "otp_sms",
    timestamp: row.timestamp,
    ipAddress: row.ipAddress ?? undefined,
    userAgent: row.userAgent ?? undefined,
    sessionId: row.sessionId ?? undefined,
  }));
}

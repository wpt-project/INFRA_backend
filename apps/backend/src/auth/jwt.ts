/**
 * LOGIN-3.1 — JWT access token issuance.
 *
 * Every successful login / OTP-verify (LOGIN-3.6) and every token
 * refresh calls `issueAccessToken` to mint a short-lived Bearer
 * credential (Tech Arch §7.1).
 *
 * Token properties:
 *   Algorithm  : HS256 (symmetric, fast, adequate for short-lived tokens)
 *   Expiry     : exactly 1 hour — bounds worst-case kill-switch latency
 *   Claims     : sub (UserId), deviceId, sid (session ID for revocation)
 *   Verification: `verifyAccessToken` decodes + validates signature + exp
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { AccessTokenPayload, IssueAccessTokenParams } from "./types.js";

/** Exactly 1 hour — bounds worst-case kill-switch latency (§7.1). */
const ACCESS_TOKEN_EXPIRY = "1h";

const ISSUER = "wpt-backend";
/** The audience that identifies end-user (app) access tokens. */
const APP_AUD = "app";

/**
 * LOGIN-3.11 — Thrown when a token's signature and issuer are valid but its
 * audience is NOT `"app"` (e.g. a dashboard `aud: "dashboard"` token re-signed
 * with the app secret, or a leak between the two systems). Middleware maps this
 * to HTTP 403 so the audience mismatch is surfaced distinctly from a generic
 * invalid token (HTTP 401).
 */
export class AppAudienceError extends Error {
  constructor(readonly receivedAudience: string) {
    super(
      `Token audience "${receivedAudience}" is not the expected app audience`,
    );
    this.name = "AppAudienceError";
  }
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Generate one with: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a signed JWT access token.
 *
 * @returns A compact JWT string suitable for `Authorization: Bearer <token>`.
 */
export async function issueAccessToken({
  userId,
  deviceId,
  sessionId,
}: IssueAccessTokenParams): Promise<string> {
  const secret = getSecret();

  const token = await new SignJWT({
      deviceId,
      sid: sessionId,
    })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(APP_AUD)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);

  return token;
}

/**
 * Verify a JWT access token and return its parsed payload.
 *
 * Validates:
 *   - Signature (HS256 against JWT_SECRET)
 *   - Expiry (`exp` claim)
 *   - Issuer (`iss` claim)
 *
 * @throws on any verification failure (expired, tampered, wrong issuer).
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  const secret = getSecret();

  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
  });

  return toAccessTokenPayload(payload);
}

/**
 * LOGIN-3.11 — Return the `aud` claim from a JWT **without** verifying its
 * signature.
 *
 * USE ONLY for logging / diagnosing which token family a request carried.
 * Never rely on it for authorization — always use `verifyAccessToken` /
 * `verifyDashboardAccessToken` (which enforce the audience structurally).
 */
export function getAudience(token: string): string | null {
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) return null;
    const decoded = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as { aud?: unknown };
    return typeof decoded.aud === "string" ? decoded.aud : null;
  } catch {
    return null;
  }
}

/**
 * Decode a JWT **without** verifying the signature.
 *
 * USE ONLY for debugging / logging. Never trust the result for
 * authorization decisions — always call `verifyAccessToken` instead.
 */
export function decodeAccessTokenUnsafe(token: string): JWTPayload {
  const [, payloadB64] = token.split(".");
  if (!payloadB64) throw new Error("Malformed JWT — no payload segment");
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
}

function toAccessTokenPayload(raw: JWTPayload): AccessTokenPayload {
  const sub = typeof raw.sub === "string" ? raw.sub : undefined;
  const deviceId =
    typeof raw.deviceId === "string" ? raw.deviceId : undefined;
  const sid = typeof raw.sid === "string" ? raw.sid : undefined;
  const aud = raw.aud;
  const iat = typeof raw.iat === "number" ? raw.iat : undefined;
  const exp = typeof raw.exp === "number" ? raw.exp : undefined;
  const iss = typeof raw.iss === "string" ? raw.iss : undefined;

  // LOGIN-3.11 — The audience is the structural-security boundary: a valid
  // signature with the wrong audience is reported distinctly (AppAudienceError)
  // so middleware can return 403 instead of a generic 401.
  if (aud !== APP_AUD) {
    throw new AppAudienceError(typeof aud === "string" ? aud : String(aud));
  }

  if (!sub || !deviceId || !sid || iat === undefined || exp === undefined || !iss) {
    throw new Error(
      "JWT payload is missing required claims (sub, deviceId, sid, iat, exp, iss)",
    );
  }

  return {
    sub,
    deviceId,
    sid,
    aud: APP_AUD,
    iat,
    exp,
    iss,
  };
}

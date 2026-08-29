/**
 * LOGIN-3.10 — Dashboard JWT access + refresh token issuance.
 *
 * Fully separate from the end-user JWT (LOGIN-3.1):
 *   - Uses its OWN secret: DASHBOARD_JWT_SECRET (never the app JWT_SECRET).
 *   - Carries `aud: "dashboard"` so middleware can reject `aud: "app"`
 *     tokens and vice-versa (structural security, not cosmetic).
 *   - Same jose HS256 signing utility, same 1h/30d expiry constants.
 *
 * A token with `aud: "dashboard"` must NEVER be accepted by an app
 * endpoint, and an `aud: "app"` token must NEVER be accepted by a
 * dashboard endpoint. The distinct secret + aud check enforce this.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/** Exactly 1 hour — bounds worst-case credential lifetime. */
const ACCESS_TOKEN_EXPIRY = "1h";
/** Refresh token lifetime — 30 days. */
const REFRESH_TOKEN_EXPIRY = "30d";

const ISSUER = "wpt-backend";
/** The audience that identifies dashboard tokens. */
const DASHBOARD_AUD = "dashboard";

export type DashboardAdminRole = "owner" | "admin";

export interface DashboardAccessTokenPayload {
  sub: string;
  email: string;
  role: DashboardAdminRole;
  isTestAccount: boolean;
  aud: typeof DASHBOARD_AUD;
  sid: string;
  iat: number;
  exp: number;
  iss: string;
}

export interface DashboardTokenPayload {
  email: string;
  role: DashboardAdminRole;
  isTestAccount: boolean;
}

function getDashboardSecret(): Uint8Array {
  const secret = process.env.DASHBOARD_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "DASHBOARD_JWT_SECRET is not set. Generate one with: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a signed dashboard access token with `aud: "dashboard"`.
 *
 * @returns A compact JWT string suitable for `Authorization: Bearer <token>`
 *          on dashboard endpoints only.
 */
export async function issueDashboardAccessToken({
  adminId,
  email,
  role,
  isTestAccount,
  sessionId,
}: DashboardTokenPayload & { adminId: string; sessionId: string }): Promise<string> {
  const secret = getDashboardSecret();

  return new SignJWT({
      email,
      role,
      isTestAccount,
      sid: sessionId,
    })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(adminId)
    .setIssuer(ISSUER)
    .setAudience(DASHBOARD_AUD)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);
}

/**
 * Mint a signed dashboard refresh token with `aud: "dashboard"` and
 * `typ: "refresh"`. The raw token is returned to the client ONCE; only a
 * bcrypt hash is stored in `dashboard_sessions`.
 */
export async function issueDashboardRefreshToken(payload: DashboardTokenPayload & {
  adminId: string;
}): Promise<string> {
  const secret = getDashboardSecret();

  return new SignJWT({
      email: payload.email,
      role: payload.role,
      isTestAccount: payload.isTestAccount,
      typ: "refresh",
    })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.adminId)
    .setIssuer(ISSUER)
    .setAudience(DASHBOARD_AUD)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(secret);
}

/**
 * Thrown when a token's signature and issuer are valid but its audience is
 * NOT `"dashboard"` (e.g. an end-user `aud: "app"` token re-signed/signed
 * with the dashboard secret). Middleware maps this to HTTP 403 so the
 * audience mismatch is surfaced distinctly from a generic invalid token
 * (HTTP 401).
 */
export class DashboardAudienceError extends Error {
  constructor(readonly receivedAudience: string) {
    super(
      `Token audience "${receivedAudience}" is not the expected dashboard audience`,
    );
    this.name = "DashboardAudienceError";
  }
}

/**
 * Verify a dashboard access token.
 *
 * Validates the signature (against DASHBOARD_JWT_SECRET) and issuer FIRST.
 * The audience is checked explicitly in `toDashboardAccessPayload` and a
 * valid-signature token with the wrong audience throws a
 * `DashboardAudienceError` (so middleware can respond 403) rather than a
 * generic verification failure.
 *
 * @throws {DashboardAudienceError} if the audience is not `"dashboard"`.
 * @throws on any other verification failure (bad signature, expired, etc.).
 */
export async function verifyDashboardAccessToken(
  token: string,
): Promise<DashboardAccessTokenPayload> {
  const secret = getDashboardSecret();

  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
  });

  return toDashboardAccessPayload(payload);
}

/**
 * Verify a dashboard refresh token.
 *
 * Same checks as the access token plus `typ === "refresh"`. Used by the
 * refresh endpoint before minting a fresh dashboard access token.
 */
export async function verifyDashboardRefreshToken(
  token: string,
): Promise<{ sub: string; email: string; role: DashboardAdminRole; isTestAccount: boolean } | null> {
  try {
    const secret = getDashboardSecret();
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: DASHBOARD_AUD,
    });

    if (payload.typ !== "refresh") return null;

    const sub = typeof payload.sub === "string" ? payload.sub : undefined;
    const email = typeof payload.email === "string" ? payload.email : undefined;
    const role = payload.role as DashboardAdminRole;
    const isTestAccount = typeof payload.isTestAccount === "boolean" ? payload.isTestAccount : false;

    if (!sub || !email || (role !== "owner" && role !== "admin")) return null;

    return { sub, email, role, isTestAccount };
  } catch {
    return null;
  }
}

/** Decode a dashboard JWT WITHOUT verifying the signature (debug only). */
export function decodeDashboardTokenUnsafe(token: string): JWTPayload {
  const [, payloadB64] = token.split(".");
  if (!payloadB64) throw new Error("Malformed JWT — no payload segment");
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
}

function toDashboardAccessPayload(raw: JWTPayload): DashboardAccessTokenPayload {
  const sub = typeof raw.sub === "string" ? raw.sub : undefined;
  const email = typeof raw.email === "string" ? raw.email : undefined;
  const role = raw.role as DashboardAdminRole;
  const isTestAccount = typeof raw.isTestAccount === "boolean" ? raw.isTestAccount : false;
  const aud = raw.aud;
  const sid = typeof raw.sid === "string" ? raw.sid : undefined;
  const iat = typeof raw.iat === "number" ? raw.iat : undefined;
  const exp = typeof raw.exp === "number" ? raw.exp : undefined;
  const iss = typeof raw.iss === "string" ? raw.iss : undefined;

  // The audience is the structural-security boundary: a valid signature with
  // the wrong audience is reported distinctly so middleware can return 403.
  if (aud !== DASHBOARD_AUD) {
    throw new DashboardAudienceError(typeof aud === "string" ? aud : String(aud));
  }

  if (
    !sub || !email || !sid ||
    (role !== "owner" && role !== "admin") ||
    typeof isTestAccount !== "boolean" ||
    iat === undefined || exp === undefined || iss === undefined
  ) {
    throw new Error(
      "Dashboard JWT payload is missing required claims or has the wrong audience",
    );
  }

  return {
    sub,
    email,
    role,
    isTestAccount,
    aud: DASHBOARD_AUD,
    sid,
    iat,
    exp,
    iss,
  };
}

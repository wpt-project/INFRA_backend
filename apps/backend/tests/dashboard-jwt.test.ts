/**
 * LOGIN-3.10 — Dashboard JWT tests.
 *
 * Verifies the structural audience separation between the end-user
 * (`aud: "app"`, JWT_SECRET) and dashboard (`aud: "dashboard"`,
 * DASHBOARD_JWT_SECRET/JWT_SECRET in tests) token systems.
 *
 * These are pure unit tests — no database access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SignJWT } from "jose";

import {
  issueDashboardAccessToken,
  issueDashboardRefreshToken,
  verifyDashboardAccessToken,
  verifyDashboardRefreshToken,
  decodeDashboardTokenUnsafe,
} from "../src/auth/dashboard-jwt.js";
import {
  issueAccessToken,
  verifyAccessToken,
} from "../src/auth/jwt.js";

const APP_SECRET = process.env.JWT_SECRET;
const DASH_SECRET = process.env.DASHBOARD_JWT_SECRET;

const ADMIN = {
  adminId: "11111111-1111-1111-1111-111111111111",
  email: "samson@wpt.internal",
  role: "owner" as const,
  isTestAccount: false,
  sessionId: "fa81a5a0-1111-4111-8111-111111111111",
};

beforeAll(() => {
  // The jwt modules read these at call-time, so setting them once is enough.
  process.env.JWT_SECRET = APP_SECRET ?? "app-test-secret";
  process.env.DASHBOARD_JWT_SECRET = DASH_SECRET ?? "dashboard-test-secret";
});

afterAll(() => {
  if (APP_SECRET === undefined) delete process.env.JWT_SECRET;
  if (DASH_SECRET === undefined) delete process.env.DASHBOARD_JWT_SECRET;
});

describe("Dashboard login token — aud: 'dashboard'", () => {
  it("issues an access token whose verified payload has aud: 'dashboard'", async () => {
    const token = await issueDashboardAccessToken(ADMIN);
    const payload = await verifyDashboardAccessToken(token);

    expect(payload.aud).toBe("dashboard");
    expect(payload.sub).toBe(ADMIN.adminId);
    expect(payload.email).toBe(ADMIN.email);
    expect(payload.role).toBe("owner");
    expect(payload.isTestAccount).toBe(false);
    expect(payload.sid).toBe(ADMIN.sessionId);
  });

  it("issues a refresh token with aud: 'dashboard' and typ: 'refresh'", async () => {
    const token = await issueDashboardRefreshToken(ADMIN);
    const verified = await verifyDashboardRefreshToken(token);

    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe(ADMIN.adminId);
    expect(verified!.email).toBe(ADMIN.email);
    expect(verified!.role).toBe("owner");

    const decoded = decodeDashboardTokenUnsafe(token);
    expect(decoded.aud).toBe("dashboard");
    expect(decoded.typ).toBe("refresh");
  });
});

describe("Audience separation (structural security)", () => {
  it("rejects a dashboard-access token used as an end-user (app) token", async () => {
    const dashboardToken = await issueDashboardAccessToken(ADMIN);
    // App verification uses the APP secret — a dashboard token is signed
    // with the DASHBOARD secret and must NOT verify as a valid app token.
    await expect(verifyAccessToken(dashboardToken)).rejects.toThrow();
  });

  it("rejects an end-user (app) token used on a dashboard endpoint", async () => {
    const appToken = await issueAccessToken({
      userId: "user-123",
      deviceId: "device-456",
      sessionId: "sess-789",
    });
    await expect(verifyDashboardAccessToken(appToken)).rejects.toThrow();
  });

  it("rejects a dashboard-audience token despite a valid dashboard signature when aud differs", async () => {
    // Craft a token signed with the dashboard secret but aud "app":
    // verification must reject it because the audience is wrong.
    const secret = new TextEncoder().encode(process.env.DASHBOARD_JWT_SECRET!);
    const token = await new SignJWT({ email: ADMIN.email, role: "owner" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(ADMIN.adminId)
      .setAudience("app")
      .setIssuer("wpt-backend")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    await expect(verifyDashboardAccessToken(token)).rejects.toThrow();
  });

  it("keeps the two token systems on entirely different secrets", async () => {
    // Dashboard tokens must NOT verify with the app secret and vice-versa.
    expect(process.env.JWT_SECRET).not.toBe(process.env.DASHBOARD_JWT_SECRET);
  });
});

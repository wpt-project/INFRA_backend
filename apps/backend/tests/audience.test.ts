/**
 * LOGIN-3.11 — Endpoint audience isolation tests.
 *
 * Verifies the centralized requireAudience middleware enforces the `aud`
 * claim so that app tokens (aud: "app") and dashboard tokens (aud: "dashboard")
 * can never cross-use each other's endpoints.
 *
 * Pure unit tests — no database or network access.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { SignJWT } from "jose";

import { requireAudience } from "../src/middleware/auth.middleware.js";
import { issueAccessToken } from "../src/auth/jwt.js";
import { issueDashboardAccessToken } from "../src/auth/dashboard-jwt.js";

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
  process.env.JWT_SECRET = APP_SECRET ?? "app-test-secret";
  process.env.DASHBOARD_JWT_SECRET = DASH_SECRET ?? "dashboard-test-secret";
});

afterAll(() => {
  if (APP_SECRET === undefined) delete process.env.JWT_SECRET;
  if (DASH_SECRET === undefined) delete process.env.DASHBOARD_JWT_SECRET;
});

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    locals: {},
  } as any;
  return res;
}

function mockReq(headers: Record<string, string | undefined> = {}) {
  return { headers, socket: {} } as any;
}

const next = vi.fn();

beforeEach(() => {
  next.mockClear();
});

const appToken = async () =>
  issueAccessToken({ userId: "user-123", deviceId: "device-456", sessionId: "sess-789" });
const dashToken = async () => issueDashboardAccessToken(ADMIN);

describe("requireAudience('app') — app endpoints", () => {
  it("accepts an app token (aud: 'app') and attaches res.locals.auth", async () => {
    const req = mockReq({ authorization: `Bearer ${await appToken()}` });
    const res = mockRes();

    await requireAudience("app")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.locals.auth).toMatchObject({
      sub: "user-123",
      aud: "app",
    });
  });

  it("rejects a dashboard token (aud: 'dashboard') on an app endpoint with 401 (different secret)", async () => {
    // A genuine dashboard token is signed with DASHBOARD_JWT_SECRET, so it
    // cannot verify against JWT_SECRET on an app endpoint -> 401.
    const req = mockReq({ authorization: `Bearer ${await dashToken()}` });
    const res = mockRes();

    await requireAudience("app")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "INVALID_TOKEN", expectedAudience: "app" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a token signed with JWT_SECRET but aud 'dashboard' with 403 (audience mismatch)", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const mistok = await new SignJWT({ deviceId: "d", sid: "s" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("user-123")
      .setAudience("dashboard")
      .setIssuer("wpt-backend")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    const req = mockReq({ authorization: `Bearer ${mistok}` });
    const res = mockRes();

    await requireAudience("app")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "INVALID_AUDIENCE",
        expectedAudience: "app",
        receivedAudience: "dashboard",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request with no token with 401", async () => {
    const req = mockReq({});
    const res = mockRes();

    await requireAudience("app")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "TOKEN_REQUIRED", expectedAudience: "app" }),
    );
  });
});

describe("requireAudience('dashboard') — dashboard endpoints", () => {
  it("accepts a dashboard token (aud: 'dashboard') and attaches res.locals.dashboardAuth", async () => {
    const req = mockReq({ authorization: `Bearer ${await dashToken()}` });
    const res = mockRes();

    await requireAudience("dashboard")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.locals.dashboardAuth).toMatchObject({
      sub: ADMIN.adminId,
      aud: "dashboard",
      email: ADMIN.email,
    });
  });

  it("rejects an app token (aud: 'app') on a dashboard endpoint with 401 (different secret)", async () => {
    // A genuine app token is signed with JWT_SECRET, so it cannot verify
    // against DASHBOARD_JWT_SECRET on a dashboard endpoint -> 401.
    const req = mockReq({ authorization: `Bearer ${await appToken()}` });
    const res = mockRes();

    await requireAudience("dashboard")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "INVALID_TOKEN", expectedAudience: "dashboard" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a token signed with DASHBOARD_JWT_SECRET but aud 'app' with 403 (audience mismatch)", async () => {
    const secret = new TextEncoder().encode(process.env.DASHBOARD_JWT_SECRET!);
    const mistok = await new SignJWT({ email: ADMIN.email, role: "owner" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(ADMIN.adminId)
      .setAudience("app")
      .setIssuer("wpt-backend")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    const req = mockReq({ authorization: `Bearer ${mistok}` });
    const res = mockRes();

    await requireAudience("dashboard")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "INVALID_AUDIENCE",
        expectedAudience: "dashboard",
        receivedAudience: "app",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request with no token with 401", async () => {
    const req = mockReq({});
    const res = mockRes();

    await requireAudience("dashboard")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "TOKEN_REQUIRED", expectedAudience: "dashboard" }),
    );
  });
});

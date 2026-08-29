/**
 * LOGIN-3.10 / LOGIN-3.11 — Dashboard auth middleware tests.
 *
 * Verifies requireDashboardAuth:
 *   - accepts a valid `aud: "dashboard"` token
 *   - rejects missing / malformed tokens (401)
 *   - rejects tokens whose audience is not "dashboard" (403)
 *
 * Pure unit tests — no database or network access.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { SignJWT } from "jose";

import {
  requireDashboardAuth,
  requireOwnerRole,
} from "../src/middleware/dashboard-auth.js";
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

/** Build a minimal mock Express response. */
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

describe("requireDashboardAuth", () => {
  it("accepts a valid dashboard token and attaches the payload", async () => {
    const token = await issueDashboardAccessToken(ADMIN);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();

    await requireDashboardAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.locals.dashboardAuth).toMatchObject({
      sub: ADMIN.adminId,
      aud: "dashboard",
      email: ADMIN.email,
    });
  });

  it("rejects a missing Authorization header with 401", async () => {
    const req = mockReq({});
    const res = mockRes();

    await requireDashboardAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "TOKEN_REQUIRED", expectedAudience: "dashboard" }),
    );
  });

  it("rejects a non-Bearer header with 401", async () => {
    const req = mockReq({ authorization: "Token abc" });
    const res = mockRes();

    await requireDashboardAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a garbage token with 401", async () => {
    const req = mockReq({ authorization: "Bearer not.a.jwt" });
    const res = mockRes();

    await requireDashboardAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "INVALID_TOKEN", expectedAudience: "dashboard" }),
    );
  });

  it("rejects an end-user (aud: 'app') token with 403", async () => {
    // A token signed with the DASHBOARD secret but carrying aud "app" —
    // this exercises the explicit audience-enforcement branch.
    const secret = new TextEncoder().encode(process.env.DASHBOARD_JWT_SECRET!);
    const appAudToken = await new SignJWT({
      email: ADMIN.email,
      role: "owner",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(ADMIN.adminId)
      .setAudience("app")
      .setIssuer("wpt-backend")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    const req = mockReq({ authorization: `Bearer ${appAudToken}` });
    const res = mockRes();

    await requireDashboardAuth(req, res, next);

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
});

describe("requireOwnerRole", () => {
  it("rejects when no dashboard auth is present", () => {
    const req = mockReq({});
    const res = mockRes();

    requireOwnerRole(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("allows an owner role", () => {
    const req = mockReq({});
    const res = mockRes();
    // Simulate requireDashboardAuth having run and attached a verified payload.
    res.locals.dashboardAuth = { role: "owner" } as any;

    requireOwnerRole(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("rejects a non-owner admin with 403", () => {
    const req = mockReq({});
    const res = mockRes();
    res.locals.dashboardAuth = { role: "admin" } as any;

    requireOwnerRole(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "OWNER_ROLE_REQUIRED" });
  });
});

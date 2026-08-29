/**
 * LOGIN-3.10 — Dashboard service tests.
 *
 * Focused on the security-critical invariants:
 *   - the refresh token is stored ONLY as a bcrypt hash (never raw)
 *   - a revoked session cannot be used to mint a new access token
 *   - logout marks the session revoked
 *
 * The `getDb` pool layer is mocked with a minimal fluent Drizzle-shaped stub —
 * no real database is contacted.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";

import {
  dashboardLogin,
  dashboardRefresh,
  dashboardLogout,
} from "../src/auth/dashboard.js";
import {
  issueDashboardRefreshToken,
} from "../src/auth/dashboard-jwt.js";

// ── Mock the database access layer ──
let mockDb: ReturnType<typeof createMockDb> | null = null;

vi.mock("../src/db/index.js", () => ({
  getDb: () => {
    if (!mockDb) throw new Error("mockDb not set for this test");
    return mockDb;
  },
  schema: {},
}));

const APP_SECRET = process.env.JWT_SECRET;
const DASH_SECRET = process.env.DASHBOARD_JWT_SECRET;

const PASSWORD = "Admin@123";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "samson@wpt.internal";

let passwordHash: string;
let adminRow: any;
let sessionRow: any;

beforeAll(async () => {
  process.env.JWT_SECRET = APP_SECRET ?? "app-test-secret";
  process.env.DASHBOARD_JWT_SECRET = DASH_SECRET ?? "dashboard-test-secret";
  passwordHash = await bcrypt.hash(PASSWORD, 4);

  adminRow = {
    id: ADMIN_ID,
    email: EMAIL,
    passwordHash,
    role: "owner",
    isTestAccount: false,
    ownerResetTokenHash: null,
    ownerResetTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  sessionRow = {
    id: "fa81a5a0-1111-4111-8111-111111111111",
    adminId: ADMIN_ID,
    tokenLookup: "a".repeat(32),
    refreshTokenHash: "x",
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
  };
});

afterAll(() => {
  if (APP_SECRET === undefined) delete process.env.JWT_SECRET;
  if (DASH_SECRET === undefined) delete process.env.DASHBOARD_JWT_SECRET;
});

beforeEach(() => {
  mockDb = null;
});

/** Minimal fluent mock shaped like the Drizzle query chains the service uses. */
function createMockDb({
  selectRows = [] as any[][],
  insertResult = [] as any[],
  updateResult = { rowCount: 1 } as any,
}) {
  const selectQueue = [...selectRows];
  const calls = {
    selectWheres: [] as any[],
    insertValues: [] as any[],
    updateSets: [] as any[],
    updateWheres: [] as any[],
  };

  const select = {
    from: () => ({
      where: (cond: any) => {
        calls.selectWheres.push(cond);
        const rows = selectQueue.shift() ?? [];
        return { limit: () => Promise.resolve(rows) };
      },
    }),
  };

  const insert = {
    values: (val: any) => {
      calls.insertValues.push(val);
      return { returning: () => Promise.resolve(insertResult) };
    },
  };

  const update = {
    set: (set: any) => {
      calls.updateSets.push(set);
      return {
        where: (cond: any) => {
          calls.updateWheres.push(cond);
          return Promise.resolve(updateResult);
        },
      };
    },
  };

  return {
    select: () => select,
    insert: () => insert,
    update: () => update,
    calls,
  };
}

describe("dashboardLogin", () => {
  it("stores the refresh token as a bcrypt hash, not the raw token", async () => {
    mockDb = createMockDb({
      selectRows: [[adminRow]],
      insertResult: [{ id: "fa81a5a0-1111-4111-8111-111111111111" }],
    });

    const result = await dashboardLogin({ email: EMAIL, password: PASSWORD });

    expect(result.success).toBe(true);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    // The value persisted has a bcrypt shape, is not the raw token,
    // and round-trips through bcrypt.compare.
    const stored = mockDb!.calls.insertValues[0];
    expect(stored.refreshTokenHash).toMatch(/^\$2[aby]\$/);
    expect(stored.refreshTokenHash).not.toBe(result.refreshToken);
    const matches = await bcrypt.compare(
      result.refreshToken!,
      stored.refreshTokenHash,
    );
    expect(matches).toBe(true);
    // The deterministic lookup key must differ from the hash itself.
    expect(stored.tokenLookup).toHaveLength(32);
  });

  it("rejects an unknown email with an opaque error", async () => {
    mockDb = createMockDb({ selectRows: [[]] });
    const result = await dashboardLogin({
      email: "nobody@wpt.internal",
      password: PASSWORD,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a wrong password with an opaque error", async () => {
    mockDb = createMockDb({ selectRows: [[adminRow]] });
    const result = await dashboardLogin({ email: EMAIL, password: "WrongPass" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_CREDENTIALS");
  });
});

describe("dashboardRefresh", () => {
  it("issues a new access token for a valid, non-revoked session", async () => {
    const refreshToken = await issueDashboardRefreshToken({
      adminId: ADMIN_ID,
      email: EMAIL,
      role: "owner",
      isTestAccount: false,
    });

    // The session row must carry a bcrypt hash that matches the presented
    // refresh token (the service bcrypt-compares before minting a new token).
    const validSessionRow = {
      ...sessionRow,
      refreshTokenHash: await bcrypt.hash(refreshToken, 4),
    };
    mockDb = createMockDb({
      selectRows: [[validSessionRow], [adminRow]],
    });

    const result = await dashboardRefresh(refreshToken);
    expect(result.success).toBe(true);
    expect(result.accessToken).toBeTruthy();
  });

  it("rejects a session whose session row is missing", async () => {
    mockDb = createMockDb({ selectRows: [[]] });

    const refreshToken = await issueDashboardRefreshToken({
      adminId: ADMIN_ID,
      email: EMAIL,
      role: "owner",
      isTestAccount: false,
    });

    const result = await dashboardRefresh(refreshToken);
    expect(result.success).toBe(false);
    expect(result.error).toBe("SESSION_NOT_FOUND");
  });

  it("rejects a revoked session (session revocation works)", async () => {
    const revokedRow = { ...sessionRow, revokedAt: new Date() };
    mockDb = createMockDb({ selectRows: [[revokedRow]] });

    const refreshToken = await issueDashboardRefreshToken({
      adminId: ADMIN_ID,
      email: EMAIL,
      role: "owner",
      isTestAccount: false,
    });

    const result = await dashboardRefresh(refreshToken);
    expect(result.success).toBe(false);
    expect(result.error).toBe("SESSION_REVOKED");
  });

  it("rejects an invalid refresh token", async () => {
    mockDb = createMockDb({});
    const result = await dashboardRefresh("not-a-valid-refresh-token");
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_REFRESH_TOKEN");
  });
});

describe("dashboardLogout", () => {
  it("marks the session as revoked (revoked_at set)", async () => {
    mockDb = createMockDb({});
    const result = await dashboardLogout(sessionRow.id);

    expect(result).toBe(true);
    expect(mockDb!.calls.updateSets[0]).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});

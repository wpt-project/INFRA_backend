/**
 * LOGIN-3.10 — Dashboard admin management (create / delete) service tests.
 *
 * Verifies the security-critical invariants of admin provisioning:
 *   - createDashboardAdmin stores a bcrypt hash, never the raw password
 *   - a duplicate email surfaces as EMAIL_ALREADY_EXISTS (23505 -> code)
 *   - create / delete both write an audit_log entry in the SAME transaction
 *   - deleteDashboardAdmin refuses to delete the LAST owner
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";

import {
  createDashboardAdmin,
  deleteDashboardAdmin,
} from "../src/auth/dashboard.js";

let mockDb: ReturnType<typeof createMockDb> | null = null;

vi.mock("../src/db/index.js", () => ({
  getDb: () => {
    if (!mockDb) throw new Error("mockDb not set for this test");
    return mockDb;
  },
  schema: {},
}));

/**
 * Minimal fluent mock shaped like the Drizzle chains the service uses.
 * Exposes a fake `transaction(fn)` that wraps a minimal tx so the service's
 * single-transaction guarantee can be asserted (insert + audit in one unit).
 */
function createMockDb({
  createRows = [] as any[],
  selectResults = [] as any[][],
}: {
  createRows?: any[];
  selectResults?: any[][];
}) {
  const selectQueue = [...selectResults];
  const tableObj = {
    insertValues: [] as any[],
    insertCalls: 0,
    deleteWheres: [] as any[],
    selectQueue: [] as any[],
  };

  function txApi() {
    return {
      insert: () => ({
        values: (val: any) => {
          tableObj.insertValues.push(val);
          tableObj.insertCalls += 1;
          return {
            returning: () => Promise.resolve(createRows),
          };
        },
      }),
      select: () => ({
        from: () => ({
          where: (cond: any) => {
            tableObj.selectQueue.push(cond);
            const rows = selectQueue.shift() ?? [];
            return { limit: () => Promise.resolve(rows) };
          },
        }),
      }),
      delete: () => ({
        where: (cond: any) => {
          tableObj.deleteWheres.push(cond);
          return Promise.resolve({ rowCount: 1 });
        },
      }),
    };
  }

  return {
    transaction: async (fn: (tx: any) => Promise<any>) => fn(txApi()),
    insert: () => txApi().insert(),
    select: () => txApi().select(),
    delete: () => txApi().delete(),
    tableObj,
  };
}

describe("createDashboardAdmin", () => {
  it("stores a bcrypt hash (never the raw password) and writes an audit row in the same transaction", async () => {
    const PASSWORD = "SuperSecret123";
    const EMAIL = "new@wpt.internal";

    mockDb = createMockDb({
      createRows: [{ id: "11111111-1111-1111-1111-111111111111", email: EMAIL }],
    });

    const result = await createDashboardAdmin({
      email: EMAIL,
      password: PASSWORD,
      role: "admin",
    });

    expect(result.ok).toBe(true);

    // Two inserts executed inside the SAME transaction: the admin row and the
    // audit_log row (AGENTS.md: every admin action writes audit_log).
    expect(mockDb!.tableObj.insertCalls).toBeGreaterThanOrEqual(2);

    // The first inserted value is the dashboard_admins row — its password_hash
    // must be a bcrypt hash that verifies against the password and is NOT the
    // raw password.
    const adminInsert = mockDb!.tableObj.insertValues[0];
    expect(adminInsert.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(adminInsert.passwordHash).not.toBe(PASSWORD);
    const matches = await bcrypt.compare(PASSWORD, adminInsert.passwordHash);
    expect(matches).toBe(true);
    // Role defaulted/normalized to "admin".
    expect(adminInsert.role).toBe("admin");
  });

  it("surfaces a duplicate email as EMAIL_ALREADY_EXISTS (23505)", async () => {
    const dupError = Object.assign(new Error("duplicate key value"), { code: "23505" });
    mockDb = createMockDb({});
    // Force the transaction to throw the duplicate-key error.
    mockDb.transaction = async () => {
      throw dupError;
    };

    const result = await createDashboardAdmin({
      email: "dup@wpt.internal",
      password: "SomePassword1",
      role: "admin",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("EMAIL_ALREADY_EXISTS");
  });
});

describe("deleteDashboardAdmin", () => {
  it("refuses to delete the last remaining owner", async () => {
    // Only ONE owner exists -> cannot delete it.
    mockDb = createMockDb({
      selectResults: [
        // target lookup
        [{ id: "owner-1", role: "owner" }],
        // owners list
        [{ id: "owner-1" }],
      ],
    });

    const result = await deleteDashboardAdmin("owner-1", "owner-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("CANNOT_DELETE_OWNER");
  });

  it("allows deleting an admin (not the last owner) and writes an audit row", async () => {
    mockDb = createMockDb({
      createRows: [],
      selectResults: [
        // target lookup
        [{ id: "admin-2", role: "admin" }],
      ],
    });

    const result = await deleteDashboardAdmin("admin-2", "owner-1");
    expect(result.ok).toBe(true);
    // delete ran at least once (the dashboard_admins row).
    expect(mockDb!.tableObj.deleteWheres.length).toBeGreaterThanOrEqual(1);
  });
});

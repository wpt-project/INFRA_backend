/**
 * LOGIN-3.10 — Dashboard (Admin) routes.
 *
 * Completely separate login system for the WPT Admin Dashboard:
 *   - POST /admin/login       — dashboard login, issues aud:"dashboard" tokens
 *   - POST /admin/refresh     — refresh a dashboard access token
 *   - POST /admin/logout      — revoke the current dashboard session
 *   - GET  /admin/me          — current admin profile (dashboard auth required)
 *   - POST /admin/logout-all  — force-logout all sessions for the admin
 *
 * Public routes: login, refresh. Everything else requires a dashboard token
 * with `aud: "dashboard"`.
 */

import { Router, type Request, type Response } from "express";
import { getDb } from "../db/index.js";
import { dashboardAdmins } from "../db/dashboard-admins-schema.js";
import {
  dashboardLogin,
  dashboardRefresh,
  dashboardLogout,
  dashboardLogoutAll,
  getDashboardAdminById,
  createDashboardAdmin,
  deleteDashboardAdmin,
} from "../auth/dashboard.js";
import {
  requireDashboardAuth,
  requireOwnerRole,
} from "../middleware/dashboard-auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { getOtpAuditLogs, toLocalIsoTimestamp } from "../audit/audit-logger.js";

const router: Router = Router();

// ──────────────────────────────────────────────────
// POST /admin/login
// ──────────────────────────────────────────────────
router.post(  "/login",
  rateLimit({
    maxRequests: 10,
    windowMs: 60_000,
    keyFn: (req) => `admin-login:${req.ip ?? "unknown"}`,
    message: "Too many login attempts. Please wait before retrying.",
  }),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };

      if (!email || typeof email !== "string" || !password || typeof password !== "string") {
        res.status(400).json({ error: "EMAIL_AND_PASSWORD_REQUIRED" });
        return;
      }

      const ipAddress = req.ip ?? req.socket.remoteAddress ?? undefined;
      const userAgent = req.headers["user-agent"] ?? undefined;

      const result = await dashboardLogin(
        { email, password },
        { ipAddress, userAgent },
      );

      if (!result.success) {
        res.status(401).json({ success: false, error: result.error });
        return;
      }

      res.json({
        success: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        sessionId: result.sessionId,
        admin: result.admin,
        tokenAudience: "dashboard",
      });
    } catch (err) {
      console.error("POST /admin/login error", err);
      res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
    }
  },
);

// ──────────────────────────────────────────────────
// POST /admin/refresh
// ──────────────────────────────────────────────────
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (!refreshToken || typeof refreshToken !== "string") {
      res.status(400).json({ error: "REFRESH_TOKEN_REQUIRED" });
      return;
    }

    const result = await dashboardRefresh(refreshToken);
    if (!result.success) {
      res.status(401).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, accessToken: result.accessToken });
  } catch (err) {
    console.error("POST /admin/refresh error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// LOGIN-3.11 — Central audience gate (aud: "dashboard").
// All routes defined AFTER this point require a valid dashboard token.
// login/refresh above remain public (they mint the tokens).
// ──────────────────────────────────────────────────
router.use(requireDashboardAuth);

// ──────────────────────────────────────────────────
// POST /admin/logout (dashboard auth required)
// ──────────────────────────────────────────────────
router.post("/logout", async (req: Request, res: Response) => {
  try {
    const sessionId = res.locals.dashboardAuth!.sid;
    const done = await dashboardLogout(sessionId);
    res.json({ success: done });
  } catch (err) {
    console.error("POST /admin/logout error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// POST /admin/logout-all (dashboard auth required)
// ──────────────────────────────────────────────────
router.post("/logout-all", async (req: Request, res: Response) => {
  try {
    const adminId = res.locals.dashboardAuth!.sub;
    const revoked = await dashboardLogoutAll(adminId);
    res.json({ success: true, revoked });
  } catch (err) {
    console.error("POST /admin/logout-all error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// GET /admin/me (dashboard auth required)
// ──────────────────────────────────────────────────
router.get("/me", async (req: Request, res: Response) => {
  try {
    const adminId = res.locals.dashboardAuth!.sub;
    const admin = await getDashboardAdminById(adminId);

    if (!admin) {
      res.status(404).json({ success: false, error: "ADMIN_NOT_FOUND" });
      return;
    }

    res.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        isTestAccount: admin.isTestAccount,
        createdAt: admin.createdAt,
      },
    });
  } catch (err) {
    console.error("GET /admin/me error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// GET /admin/audit/otp — OTP platform-detection audit log (admin only)
// LOGIN-3.12. Dashboard auth gate applies (see router.use above).
// ──────────────────────────────────────────────────
router.get("/audit/otp", async (req: Request, res: Response) => {
  try {
    const logs = await getOtpAuditLogs({
      limit: Number(req.query.limit) || 50,
    });
    // Report timestamps in local time (APP_TIMEZONE or server TZ). Storage
    // remains UTC (timestamptz); this is the display representation.
    const view = logs.map((l) => ({
      ...l,
      timestamp: toLocalIsoTimestamp(l.timestamp),
    }));
    res.json({ success: true, count: view.length, logs: view });
  } catch (err) {
    console.error("GET /admin/audit/otp error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// ──────────────────────────────────────────────────
// Owner-only management endpoints
// ──────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

// POST /admin/admins — create a new dashboard admin (owner only)
router.post("/admins", requireOwnerRole, async (req: Request, res: Response) => {
  try {
    const actingAdminId = res.locals.dashboardAuth!.sub;
    const { email, password, role, isTestAccount } = req.body as {
      email?: unknown;
      password?: unknown;
      role?: unknown;
      isTestAccount?: unknown;
    };

    if (typeof email !== "string" || !EMAIL_RE.test(email)) {
      res.status(400).json({ success: false, error: "INVALID_EMAIL" });
      return;
    }
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    ) {
      res.status(400).json({
        success: false,
        error: "INVALID_PASSWORD",
        message: "password must be 8-128 characters",
      });
      return;
    }
    if (role !== undefined && role !== null && role !== "owner" && role !== "admin") {
      res.status(400).json({
        success: false,
        error: "INVALID_ROLE",
        message: "role must be 'owner' or 'admin'",
      });
      return;
    }
    const normalizedRole = (role === "owner" ? "owner" : "admin") as "owner" | "admin";

    const result = await createDashboardAdmin({
      email,
      password,
      role: normalizedRole,
      isTestAccount:
        typeof isTestAccount === "boolean" ? isTestAccount : false,
    });

    if (!result.ok) {
      if (result.error === "EMAIL_ALREADY_EXISTS") {
        res.status(409).json({ success: false, error: "EMAIL_ALREADY_EXISTS" });
        return;
      }
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    // The acting owner is the actor of record for the audit trail.
    res.status(201).json({
      success: true,
      actorId: actingAdminId,
      admin: {
        id: result.id,
        email: result.email,
        role: result.role,
        isTestAccount: result.isTestAccount,
      },
    });
  } catch (err) {
    console.error("POST /admin/admins error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// DELETE /admin/admins/:id — delete a dashboard admin (owner only)
router.delete("/admins/:id", requireOwnerRole, async (req: Request, res: Response) => {
  try {
    const actingAdminId = res.locals.dashboardAuth!.sub;
    const rawId = req.params.id;
    if (typeof rawId !== "string" || !UUID_RE.test(rawId)) {
      res.status(400).json({ success: false, error: "INVALID_ADMIN_ID" });
      return;
    }

    const result = await deleteDashboardAdmin(rawId, actingAdminId);
    if (!result.ok) {
      if (result.error === "ADMIN_NOT_FOUND") {
        res.status(404).json({ success: false, error: "ADMIN_NOT_FOUND" });
        return;
      }
      res.status(400).json({
        success: false,
        error: "CANNOT_DELETE_OWNER",
        message: "You cannot delete an owner, and the last owner can never be removed",
      });
      return;
    }
    res.json({ success: true, deletedAdminId: result.id });
  } catch (err) {
    console.error("DELETE /admin/admins/:id error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// GET /admin/admins — list dashboard admins (owner only)
router.get("/admins", requireOwnerRole, async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: dashboardAdmins.id,
        email: dashboardAdmins.email,
        role: dashboardAdmins.role,
        isTestAccount: dashboardAdmins.isTestAccount,
        createdAt: dashboardAdmins.createdAt,
      })
      .from(dashboardAdmins)
      .orderBy(dashboardAdmins.createdAt);
    res.json({ success: true, admins: rows });
  } catch (err) {
    console.error("GET /admin/admins error", err);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

export default router;

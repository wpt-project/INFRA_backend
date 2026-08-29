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
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { dashboardAdmins } from "../db/dashboard-admins-schema.js";
import {
  dashboardLogin,
  dashboardRefresh,
  dashboardLogout,
  dashboardLogoutAll,
  getDashboardAdminById,
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
// Owner-only management endpoints (placeholders for future tasks)
// ──────────────────────────────────────────────────

// POST /admin/admins — create a new dashboard admin (owner only)
router.post("/admins", requireOwnerRole, async (_req: Request, res: Response) => {
  // TODO(LOGIN-3.x): Implement admin creation (owner-only) in a future task.
  res.json({ success: true, message: "ADMIN_CREATION_ENDPOINT" });
});

// DELETE /admin/admins/:id — delete a dashboard admin (owner only)
router.delete("/admins/:id", requireOwnerRole, async (_req: Request, res: Response) => {
  // TODO(LOGIN-3.x): Implement admin deletion (owner-only) in a future task.
  res.json({ success: true, message: "ADMIN_DELETION_ENDPOINT" });
});

// GET /admin/admins — list dashboard admins (owner only)
router.get("/admins", requireDashboardAuth, requireOwnerRole, async (_req: Request, res: Response) => {
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
});

export default router;

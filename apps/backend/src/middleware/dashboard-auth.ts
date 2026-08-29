/**
 * Dashboard authentication middleware (LOGIN-3.10 / LOGIN-3.11).
 *
 * LOGIN-3.11: `requireDashboardAuth` is now a thin wrapper over the central
 * audience-enforcement middleware `requireAudience('dashboard')` (see
 * `auth.middleware.ts`). That middleware verifies a Bearer token signed with
 * DASHBOARD_JWT_SECRET and carrying `aud: "dashboard"`, rejecting tokens with
 * any other audience (e.g. the end-user `aud: "app"` tokens) — structural
 * security, not cosmetic.
 *
 * On success it attaches the verified payload to `res.locals.dashboardAuth`.
 */

import type { Request, Response, NextFunction } from "express";
import type { DashboardAccessTokenPayload, DashboardAdminRole } from "../auth/dashboard-jwt.js";
import { requireAudience } from "./auth.middleware.js";

declare global {
  namespace Express {
    interface Locals {
      dashboardAuth?: DashboardAccessTokenPayload;
    }
  }
}

/** Centralized audience enforcement for dashboard endpoints (aud: "dashboard"). */
export const requireDashboardAuth = requireAudience("dashboard");

/**
 * Require the dashboard admin to be an owner.
 *
 * Must run AFTER `requireDashboardAuth`. Non-owner roles get 403.
 */
export function requireOwnerRole(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const role: DashboardAdminRole | undefined = res.locals.dashboardAuth?.role;
  if (role === undefined) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  if (role !== "owner") {
    res.status(403).json({ error: "OWNER_ROLE_REQUIRED" });
    return;
  }
  next();
}

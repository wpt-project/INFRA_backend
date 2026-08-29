/**
 * LOGIN-3.11 — Central audience enforcement middleware.
 *
 * A single middleware applied to every authenticated endpoint. It:
 *   1. Extracts the Bearer token from the `Authorization` header.
 *   2. Verifies the signature with the secret appropriate for the endpoint
 *      family (JWT_SECRET for `aud: "app"`, DASHBOARD_JWT_SECRET for
 *      `aud: "dashboard"`).
 *   3. Enforces the `aud` claim matches the expected audience for the route.
 *
 * This makes LOGIN-3.10's `aud` separation structurally real: a dashboard
 * token can never call an app endpoint and vice-versa (per Tech Arch §20.2).
 *
 * On success the verified payload is attached to `res.locals`:
 *   - app:       `res.locals.auth`
 *   - dashboard: `res.locals.dashboardAuth`
 * (and `req.user` for convenience).
 *
 * Response semantics:
 *   - 401 — missing / malformed / invalid / expired token (not authenticated)
 *   - 403 — valid signature but wrong audience (a permission issue)
 */

import type { Request, Response, NextFunction } from "express";
import {
  verifyAccessToken,
  AppAudienceError,
} from "../auth/jwt.js";
import {
  verifyDashboardAccessToken,
  DashboardAudienceError,
} from "../auth/dashboard-jwt.js";

export type Audience = "app" | "dashboard";

declare global {
  namespace Express {
    interface Request {
      /** The verified auth payload (attached by requireAudience). */
      user?: unknown;
    }
  }
}

/** Extract the raw Bearer token, or null if absent / malformed. */
function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1] || null;
}

export function requireAudience(expectedAud: Audience) {
  return async function audienceMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        success: false,
        error: "TOKEN_REQUIRED",
        expectedAudience: expectedAud,
        message: "Please provide a valid Bearer token",
      });
      return;
    }

    try {
      if (expectedAud === "app") {
        // A dashboard token fails this because it cannot verify against
        // JWT_SECRET; a token carrying the wrong `aud` throws AppAudienceError.
        const payload = await verifyAccessToken(token);
        res.locals.auth = payload;
        req.user = payload;
      } else {
        const payload = await verifyDashboardAccessToken(token);
        res.locals.dashboardAuth = payload;
        req.user = payload;
      }
      next();
    } catch (err) {
      if (err instanceof AppAudienceError) {
        res.status(403).json({
          success: false,
          error: "INVALID_AUDIENCE",
          expectedAudience: expectedAud,
          receivedAudience: err.receivedAudience,
          message: `This endpoint expects audience "${expectedAud}" but received "${err.receivedAudience}"`,
        });
        return;
      }
      if (err instanceof DashboardAudienceError) {
        res.status(403).json({
          success: false,
          error: "INVALID_AUDIENCE",
          expectedAudience: expectedAud,
          receivedAudience: err.receivedAudience,
          message: `This endpoint expects audience "${expectedAud}" but received "${err.receivedAudience}"`,
        });
        return;
      }
      res.status(401).json({
        success: false,
        error: "INVALID_TOKEN",
        expectedAudience: expectedAud,
        message: "Token signature verification failed or token expired",
      });
    }
  };
}

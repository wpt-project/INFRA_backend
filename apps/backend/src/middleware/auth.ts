/**
 * JWT authentication middleware.
 *
 * LOGIN-3.11: `requireAuth` is now a thin wrapper over the central
 * audience-enforcement middleware `requireAudience('app')` (see
 * `auth.middleware.ts`). It verifies the Bearer token from the Authorization
 * header (signed with JWT_SECRET, aud: "app"), extracts the
 * userId/deviceId/sessionId from the validated JWT payload, and attaches
 * them to `res.locals.auth` for downstream handlers.
 */

import { requireAudience } from "./auth.middleware.js";
import type { AccessTokenPayload } from "../auth/types.js";

declare global {
  namespace Express {
    interface Locals {
      auth?: AccessTokenPayload;
    }
  }
}

/** Centralized audience enforcement for app endpoints (aud: "app"). */
export const requireAuth = requireAudience("app");

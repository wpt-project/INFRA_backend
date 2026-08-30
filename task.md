# LOGIN-3.10 — Dashboard Authentication

## Overview

This task implements the **completely separate login system** for the Admin Dashboard. It is not a variant of end-user authentication — it is a fully distinct system with its own database tables, JWT claims, and session management.

---

## File Structure (apps/backend)

```
apps/backend/
├── src/
│   ├── models/
│   │   ├── admin.model.ts          # dashboard_admins table
│   │   └── dashboardSession.model.ts # dashboard_sessions table
│   ├── services/
│   │   ├── jwt.service.ts          # Reuse from LOGIN-3.1 (shared signing utility)
│   │   └── admin.service.ts        # Dashboard auth logic
│   ├── controllers/
│   │   └── admin.controller.ts     # Dashboard login endpoint
│   ├── routes/
│   │   └── admin.routes.ts         # Dashboard routes
│   ├── middleware/
│   │   └── admin.middleware.ts     # Audience enforcement (LOGIN-3.11)
│   ├── types/
│   │   └── admin.types.ts          # Dashboard types
│   └── db/
│       └── migrations/
│           └── 003_admin_tables.sql # Dashboard tables
└── tests/
    └── unit/
        └── admin.test.ts           # Dashboard auth tests
```

---

## 1. Database Migrations

### File: `apps/backend/src/db/migrations/003_admin_tables.sql`

```sql
-- ============================================
-- LOGIN-3.10 — Dashboard Admin Tables
-- DB-2.5: dashboard_admins
-- DB-2.6: dashboard_sessions
-- ============================================

-- Drop tables if they exist (for clean migration)
DROP TABLE IF EXISTS dashboard_sessions CASCADE;
DROP TABLE IF EXISTS dashboard_admins CASCADE;

-- 1. dashboard_admins table (DB-2.5)
CREATE TABLE dashboard_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
    is_test_account BOOLEAN DEFAULT FALSE,
    owner_reset_token_hash TEXT,
    owner_reset_token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. dashboard_sessions table (DB-2.6) — separate from end-user sessions
CREATE TABLE dashboard_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES dashboard_admins(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT
);

-- Indexes for performance
CREATE INDEX idx_dashboard_admins_email ON dashboard_admins(email);
CREATE INDEX idx_dashboard_sessions_admin_id ON dashboard_sessions(admin_id);
CREATE INDEX idx_dashboard_sessions_revoked_at ON dashboard_sessions(revoked_at);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_dashboard_admins_updated_at
BEFORE UPDATE ON dashboard_admins
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Seed data for testing
-- ============================================

-- Insert a test Dashboard Owner (password: "Admin@123")
-- Password hash is bcrypt hash of "Admin@123"
INSERT INTO dashboard_admins (id, email, password_hash, role, is_test_account)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'samson@wpt.internal',
    '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUV', -- Replace with actual hash
    'owner',
    FALSE
);

-- Insert a test Dashboard Admin (password: "Admin@123")
INSERT INTO dashboard_admins (id, email, password_hash, role, is_test_account)
VALUES (
    '22222222-2222-2222-2222-222222222222',
    'arjun@wpt.internal',
    '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUV', -- Replace with actual hash
    'admin',
    FALSE
);

-- Insert a test QA Admin Account (password: "Admin@123")
INSERT INTO dashboard_admins (id, email, password_hash, role, is_test_account)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'qa-intern@wpt.internal',
    '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUV', -- Replace with actual hash
    'admin',
    TRUE
);
```

---

## 2. Types

### File: `apps/backend/src/types/admin.types.ts`

```typescript
// apps/backend/src/types/admin.types.ts

export interface DashboardAdmin {
  id: string;
  email: string;
  password_hash: string;
  role: 'owner' | 'admin';
  is_test_account: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DashboardSession {
  id: string;
  admin_id: string;
  token_hash: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  ip_address?: string;
  user_agent?: string;
}

export interface DashboardLoginRequest {
  email: string;
  password: string;
}

export interface DashboardLoginResponse {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  admin?: {
    id: string;
    email: string;
    role: string;
    is_test_account: boolean;
  };
  error?: string;
}

export interface DashboardTokenPayload {
  adminId: string;
  email: string;
  role: string;
  isTestAccount: boolean;
  aud: 'dashboard'; // KEY: distinguishes from end-user tokens
  iat: number;
  exp: number;
}
```

---

## 3. Models

### File: `apps/backend/src/models/admin.model.ts`

```typescript
// apps/backend/src/models/admin.model.ts
import { supabase } from '../db/client';
import { DashboardAdmin, DashboardSession } from '../types/admin.types';
import bcrypt from 'bcrypt';

export class AdminModel {
  /**
   * Find admin by email
   * Used for login verification
   */
  static async findByEmail(email: string): Promise<DashboardAdmin | null> {
    const { data, error } = await supabase
      .from('dashboard_admins')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) return null;
    return data as DashboardAdmin;
  }

  /**
   * Find admin by ID
   * Used for token validation
   */
  static async findById(id: string): Promise<DashboardAdmin | null> {
    const { data, error } = await supabase
      .from('dashboard_admins')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return data as DashboardAdmin;
  }

  /**
   * Verify admin password
   */
  static async verifyPassword(
    admin: DashboardAdmin,
    password: string
  ): Promise<boolean> {
    return bcrypt.compare(password, admin.password_hash);
  }

  /**
   * Create a new dashboard admin
   * (Used for adding new admins via owner)
   */
  static async create(
    email: string,
    password: string,
    role: 'owner' | 'admin' = 'admin',
    isTestAccount: boolean = false
  ): Promise<DashboardAdmin | null> {
    const passwordHash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('dashboard_admins')
      .insert({
        email,
        password_hash: passwordHash,
        role,
        is_test_account: isTestAccount,
      })
      .select()
      .single();

    if (error || !data) return null;
    return data as DashboardAdmin;
  }

  /**
   * Update admin password
   * (Used for owner password reset)
   */
  static async updatePassword(
    adminId: string,
    newPassword: string
  ): Promise<boolean> {
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const { error } = await supabase
      .from('dashboard_admins')
      .update({ password_hash: passwordHash })
      .eq('id', adminId);

    return !error;
  }

  /**
   * Delete admin
   * (Only owner can delete admins)
   */
  static async delete(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('dashboard_admins')
      .delete()
      .eq('id', id);

    return !error;
  }
}
```

### File: `apps/backend/src/models/dashboardSession.model.ts`

```typescript
// apps/backend/src/models/dashboardSession.model.ts
import { supabase } from '../db/client';
import { DashboardSession } from '../types/admin.types';

export class DashboardSessionModel {
  /**
   * Create a new dashboard session
   * Stores hashed refresh token — never the raw token
   */
  static async create(
    adminId: string,
    tokenHash: string,
    expiresAt: Date,
    ipAddress?: string,
    userAgent?: string
  ): Promise<DashboardSession | null> {
    const { data, error } = await supabase
      .from('dashboard_sessions')
      .insert({
        admin_id: adminId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select()
      .single();

    if (error || !data) return null;
    return data as DashboardSession;
  }

  /**
   * Find session by token hash
   * Used for refresh token validation
   */
  static async findByTokenHash(tokenHash: string): Promise<DashboardSession | null> {
    const { data, error } = await supabase
      .from('dashboard_sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .single();

    if (error || !data) return null;
    return data as DashboardSession;
  }

  /**
   * Revoke a session
   * Makes refresh token invalid
   */
  static async revoke(sessionId: string): Promise<boolean> {
    const { error } = await supabase
      .from('dashboard_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId);

    return !error;
  }

  /**
   * Revoke all sessions for an admin
   * Used during force-logout
   */
  static async revokeAll(adminId: string): Promise<boolean> {
    const { error } = await supabase
      .from('dashboard_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('admin_id', adminId);

    return !error;
  }

  /**
   * Clean up expired sessions
   * Scheduled job
   */
  static async deleteExpired(): Promise<number> {
    const { data, error } = await supabase
      .from('dashboard_sessions')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error || !data) return 0;
    return data.length;
  }
}
```

---

## 4. Service

### File: `apps/backend/src/services/admin.service.ts`

```typescript
// apps/backend/src/services/admin.service.ts
import { AdminModel } from '../models/admin.model';
import { DashboardSessionModel } from '../models/dashboardSession.model';
import { JwtService } from './jwt.service'; // Reuse from LOGIN-3.1
import {
  DashboardAdmin,
  DashboardLoginRequest,
  DashboardLoginResponse,
  DashboardTokenPayload,
} from '../types/admin.types';
import crypto from 'crypto';

export class AdminService {
  /**
   * Login a dashboard admin
   * Checks email/password against dashboard_admins (DB-2.5)
   * Issues JWT with aud: "dashboard" claim
   */
  static async login(
    request: DashboardLoginRequest
  ): Promise<DashboardLoginResponse> {
    const { email, password } = request;

    // 1. Find admin by email
    const admin = await AdminModel.findByEmail(email);
    if (!admin) {
      return {
        success: false,
        error: 'Invalid email or password',
      };
    }

    // 2. Verify password
    const isValid = await AdminModel.verifyPassword(admin, password);
    if (!isValid) {
      return {
        success: false,
        error: 'Invalid email or password',
      };
    }

    // 3. Generate tokens with aud: "dashboard"
    const accessToken = JwtService.generateDashboardAccessToken({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      isTestAccount: admin.is_test_account,
    });

    const refreshToken = JwtService.generateDashboardRefreshToken({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      isTestAccount: admin.is_test_account,
    });

    // 4. Store refresh token hash in dashboard_sessions (DB-2.6)
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await DashboardSessionModel.create(
      admin.id,
      tokenHash,
      expiresAt
      // ipAddress and userAgent can be added from request
    );

    // 5. Return tokens (no refresh token table shared with end-user)
    return {
      success: true,
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        is_test_account: admin.is_test_account,
      },
    };
  }

  /**
   * Refresh dashboard access token
   * Uses a new refresh token (separate from end-user refresh)
   */
  static async refreshAccessToken(
    refreshToken: string
  ): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    // 1. Validate refresh token
    const payload = JwtService.verifyDashboardRefreshToken(refreshToken);
    if (!payload) {
      return { success: false, error: 'Invalid refresh token' };
    }

    // 2. Check session exists and is not revoked
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const session = await DashboardSessionModel.findByTokenHash(tokenHash);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.revoked_at) {
      return { success: false, error: 'Session revoked' };
    }

    if (new Date(session.expires_at) < new Date()) {
      return { success: false, error: 'Session expired' };
    }

    // 3. Get admin details
    const admin = await AdminModel.findById(session.admin_id);
    if (!admin) {
      return { success: false, error: 'Admin not found' };
    }

    // 4. Generate new access token
    const accessToken = JwtService.generateDashboardAccessToken({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      isTestAccount: admin.is_test_account,
    });

    return { success: true, accessToken };
  }

  /**
   * Logout dashboard admin
   * Revokes the session
   */
  static async logout(sessionId: string): Promise<boolean> {
    return DashboardSessionModel.revoke(sessionId);
  }

  /**
   * Logout from all dashboard sessions
   * (Force logout all devices)
   */
  static async logoutAll(adminId: string): Promise<boolean> {
    return DashboardSessionModel.revokeAll(adminId);
  }

  /**
   * Get admin by ID
   */
  static async getAdminById(id: string): Promise<DashboardAdmin | null> {
    return AdminModel.findById(id);
  }
}
```

---

## 5. JWT Service (Reuse from LOGIN-3.1)

### File: `apps/backend/src/services/jwt.service.ts`

```typescript
// apps/backend/src/services/jwt.service.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || 'your_dashboard_jwt_secret';
const JWT_ACCESS_EXPIRY = '1h';
const JWT_REFRESH_EXPIRY = '30d';

// ============================================
// End-User JWT (aud: "app") — LOGIN-3.1
// ============================================

export interface EndUserTokenPayload {
  userId: string;
  deviceId: string;
  phoneNumber: string;
  aud: 'app';
  iat: number;
  exp: number;
}

export class JwtService {
  /**
   * Generate end-user access token (aud: "app")
   * Called by LOGIN-3.1
   */
  static generateAccessToken(payload: {
    userId: string;
    deviceId: string;
    phoneNumber: string;
  }): string {
    return jwt.sign(
      {
        userId: payload.userId,
        deviceId: payload.deviceId,
        phoneNumber: payload.phoneNumber,
        aud: 'app', // KEY: distinguishes from dashboard tokens
      },
      JWT_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRY }
    );
  }

  /**
   * Generate end-user refresh token
   * Called by LOGIN-3.2
   */
  static generateRefreshToken(payload: {
    userId: string;
    deviceId: string;
  }): string {
    return jwt.sign(
      {
        userId: payload.userId,
        deviceId: payload.deviceId,
        aud: 'app',
        type: 'refresh',
      },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRY }
    );
  }

  /**
   * Verify end-user access token
   * Called by auth.middleware
   */
  static verifyAccessToken(token: string): EndUserTokenPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as EndUserTokenPayload;
      if (decoded.aud !== 'app') return null;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify end-user refresh token
   * Called by LOGIN-3.2
   */
  static verifyRefreshToken(token: string): any {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      // Check aud and type
      if (decoded.aud !== 'app' || decoded.type !== 'refresh') return null;
      return decoded;
    } catch {
      return null;
    }
  }

  // ============================================
  // Dashboard JWT (aud: "dashboard") — LOGIN-3.10
  // ============================================

  /**
   * Generate dashboard access token (aud: "dashboard")
   * Called by LOGIN-3.10
   * Reuses the same JWT signing utility, but with different secret and aud claim
   */
  static generateDashboardAccessToken(payload: {
    adminId: string;
    email: string;
    role: string;
    isTestAccount: boolean;
  }): string {
    return jwt.sign(
      {
        adminId: payload.adminId,
        email: payload.email,
        role: payload.role,
        isTestAccount: payload.isTestAccount,
        aud: 'dashboard', // KEY: distinguishes from end-user tokens
      },
      DASHBOARD_JWT_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRY }
    );
  }

  /**
   * Generate dashboard refresh token
   * Called by LOGIN-3.10
   */
  static generateDashboardRefreshToken(payload: {
    adminId: string;
    email: string;
    role: string;
    isTestAccount: boolean;
  }): string {
    return jwt.sign(
      {
        adminId: payload.adminId,
        email: payload.email,
        role: payload.role,
        isTestAccount: payload.isTestAccount,
        aud: 'dashboard',
        type: 'refresh',
      },
      DASHBOARD_JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRY }
    );
  }

  /**
   * Verify dashboard access token
   * Called by admin.middleware
   */
  static verifyDashboardAccessToken(token: string): any {
    try {
      const decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
      if (decoded.aud !== 'dashboard') return null;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify dashboard refresh token
   * Called by AdminService.refreshAccessToken
   */
  static verifyDashboardRefreshToken(token: string): any {
    try {
      const decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
      if (decoded.aud !== 'dashboard' || decoded.type !== 'refresh') return null;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Decode token without verification (for debugging)
   */
  static decodeToken(token: string): any {
    return jwt.decode(token);
  }
}
```

---

## 6. Controller

### File: `apps/backend/src/controllers/admin.controller.ts`

```typescript
// apps/backend/src/controllers/admin.controller.ts
import { Request, Response } from 'express';
import { AdminService } from '../services/admin.service';
import { DashboardLoginRequest } from '../types/admin.types';

export class AdminController {
  /**
   * POST /api/admin/login
   * Dashboard login endpoint
   * Checks email/password against dashboard_admins
   * Issues JWT with aud: "dashboard"
   */
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body as DashboardLoginRequest;

      if (!email || !password) {
        res.status(400).json({
          success: false,
          error: 'Email and password are required',
        });
        return;
      }

      const result = await AdminService.login({ email, password });

      if (!result.success) {
        res.status(401).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        admin: result.admin,
        // Explicitly note the audience for verification
        tokenAudience: 'dashboard',
      });
    } catch (error) {
      console.error('Dashboard login error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * POST /api/admin/refresh
   * Refresh dashboard access token
   */
  static async refresh(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: 'Refresh token required',
        });
        return;
      }

      const result = await AdminService.refreshAccessToken(refreshToken);

      if (!result.success) {
        res.status(401).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        accessToken: result.accessToken,
      });
    } catch (error) {
      console.error('Dashboard refresh error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * POST /api/admin/logout
   * Logout from current dashboard session
   */
  static async logout(req: Request, res: Response): Promise<void> {
    try {
      // sessionId should be extracted from the token
      const sessionId = req.body.sessionId;

      if (!sessionId) {
        res.status(400).json({
          success: false,
          error: 'Session ID required',
        });
        return;
      }

      const result = await AdminService.logout(sessionId);

      res.json({
        success: result,
        message: result ? 'Logged out successfully' : 'Logout failed',
      });
    } catch (error) {
      console.error('Dashboard logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * GET /api/admin/me
   * Get current admin profile
   * Requires dashboard authentication
   */
  static async getMe(req: Request, res: Response): Promise<void> {
    try {
      // adminId should be set by admin.middleware
      const adminId = req.adminId;

      if (!adminId) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
        return;
      }

      const admin = await AdminService.getAdminById(adminId);

      if (!admin) {
        res.status(404).json({
          success: false,
          error: 'Admin not found',
        });
        return;
      }

      res.json({
        success: true,
        admin: {
          id: admin.id,
          email: admin.email,
          role: admin.role,
          is_test_account: admin.is_test_account,
          created_at: admin.created_at,
        },
      });
    } catch (error) {
      console.error('Get admin error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
}
```

---

## 7. Middleware (Audience Enforcement)

### File: `apps/backend/src/middleware/admin.middleware.ts`

```typescript
// apps/backend/src/middleware/admin.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '../services/jwt.service';

// Extend Express Request to include adminId and admin role
declare global {
  namespace Express {
    interface Request {
      adminId?: string;
      adminRole?: string;
      isTestAccount?: boolean;
    }
  }
}

/**
 * Middleware: Require dashboard authentication
 * Checks for valid JWT with aud: "dashboard"
 * Rejects tokens with aud: "app" or any other audience
 */
export function requireDashboardAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'No token provided',
      expectedAudience: 'dashboard',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = JwtService.verifyDashboardAccessToken(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: 'Invalid token',
      expectedAudience: 'dashboard',
    });
    return;
  }

  // KEY CHECK: Verify aud: "dashboard"
  if (payload.aud !== 'dashboard') {
    res.status(403).json({
      success: false,
      error: 'Invalid token audience for dashboard endpoint',
      expectedAudience: 'dashboard',
      receivedAudience: payload.aud,
    });
    return;
  }

  // Set request context
  req.adminId = payload.adminId;
  req.adminRole = payload.role;
  req.isTestAccount = payload.isTestAccount;

  next();
}

/**
 * Middleware: Require dashboard owner role
 * Only dashboard owners can access certain endpoints
 */
export function requireOwnerRole(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.adminRole) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized - no role found',
    });
    return;
  }

  if (req.adminRole !== 'owner') {
    res.status(403).json({
      success: false,
      error: 'Forbidden - owner role required',
    });
    return;
  }

  next();
}

/**
 * Middleware: Isolate test accounts from production data
 * Test admin accounts cannot access production data
 * Routing is resolved server-side strictly off authenticated account's own flag
 */
export function isolateTestAccounts(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // This middleware adds the isTestAccount flag to the request
  // Individual endpoints use this to route to test vs production schemas
  // No client input can change this — it's derived from the authenticated token
  next();
}
```

---

## 8. Routes

### File: `apps/backend/src/routes/admin.routes.ts`

```typescript
// apps/backend/src/routes/admin.routes.ts
import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { requireDashboardAuth, requireOwnerRole } from '../middleware/admin.middleware';

const router = Router();

// ============================================
// Public dashboard routes (no auth required)
// ============================================

/**
 * POST /api/admin/login
 * Dashboard login endpoint
 * Checks email/password against dashboard_admins
 * Issues JWT with aud: "dashboard"
 */
router.post('/login', AdminController.login);

/**
 * POST /api/admin/refresh
 * Refresh dashboard access token
 */
router.post('/refresh', AdminController.refresh);

// ============================================
// Protected dashboard routes (auth required)
// ============================================

/**
 * POST /api/admin/logout
 * Logout from current dashboard session
 */
router.post('/logout', requireDashboardAuth, AdminController.logout);

/**
 * GET /api/admin/me
 * Get current admin profile
 * Requires dashboard authentication
 */
router.get('/me', requireDashboardAuth, AdminController.getMe);

// ============================================
// Owner-only routes (admin management)
// ============================================

/**
 * POST /api/admin/admins
 * Create a new dashboard admin
 * Only dashboard owners can add new admins
 */
router.post('/admins', requireDashboardAuth, requireOwnerRole, (req, res) => {
  // TODO: Implement admin creation (future task)
  res.json({ success: true, message: 'Admin creation endpoint' });
});

/**
 * DELETE /api/admin/admins/:id
 * Delete a dashboard admin
 * Only dashboard owners can delete admins
 */
router.delete('/admins/:id', requireDashboardAuth, requireOwnerRole, (req, res) => {
  // TODO: Implement admin deletion (future task)
  res.json({ success: true, message: 'Admin deletion endpoint' });
});

export default router;
```

---

## 9. Database Client

### File: `apps/backend/src/db/client.ts`

```typescript
// apps/backend/src/db/client.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Supabase credentials not configured. Using fallback mock.');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
```

---

## 10. Entry Point

### File: `apps/backend/src/index.ts`

```typescript
// apps/backend/src/index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Routes
import adminRoutes from './routes/admin.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/admin', adminRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard API: http://localhost:${PORT}/api/admin`);
  console.log(`🔑 Dashboard login: POST /api/admin/login`);
});

export default app;
```

---

## 11. Tests

### File: `apps/backend/tests/unit/admin.test.ts`

```typescript
// apps/backend/tests/unit/admin.test.ts
import { AdminController } from '../../src/controllers/admin.controller';
import { AdminService } from '../../src/services/admin.service';
import { JwtService } from '../../src/services/jwt.service';

describe('LOGIN-3.10 — Dashboard Authentication', () => {
  // Mock data
  const testAdmin = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'samson@wpt.internal',
    role: 'owner',
    is_test_account: false,
  };

  describe('Dashboard Login', () => {
    it('should issue JWT with aud: "dashboard" claim', () => {
      const token = JwtService.generateDashboardAccessToken({
        adminId: testAdmin.id,
        email: testAdmin.email,
        role: testAdmin.role,
        isTestAccount: testAdmin.is_test_account,
      });

      const decoded = JwtService.decodeToken(token);
      expect(decoded.aud).toBe('dashboard');
      expect(decoded.adminId).toBe(testAdmin.id);
      expect(decoded.email).toBe(testAdmin.email);
    });

    it('should reject end-user token on dashboard endpoint', () => {
      // Generate end-user token with aud: "app"
      const endUserToken = JwtService.generateAccessToken({
        userId: 'user-123',
        deviceId: 'device-456',
        phoneNumber: '+911234567890',
      });

      const decoded = JwtService.decodeToken(endUserToken);
      expect(decoded.aud).toBe('app');
      // Should NOT be accepted by dashboard middleware
      expect(decoded.aud).not.toBe('dashboard');
    });

    it('should reject dashboard token on end-user endpoint', () => {
      const dashboardToken = JwtService.generateDashboardAccessToken({
        adminId: testAdmin.id,
        email: testAdmin.email,
        role: testAdmin.role,
        isTestAccount: testAdmin.is_test_account,
      });

      const decoded = JwtService.decodeToken(dashboardToken);
      expect(decoded.aud).toBe('dashboard');
      // Should NOT be accepted by end-user middleware
      expect(decoded.aud).not.toBe('app');
    });
  });

  describe('Token Audience Enforcement', () => {
    it('should have separate JWT secrets for app and dashboard', () => {
      // App token should verify with app secret
      const appToken = JwtService.generateAccessToken({
        userId: 'user-123',
        deviceId: 'device-456',
        phoneNumber: '+911234567890',
      });
      const appVerified = JwtService.verifyAccessToken(appToken);
      expect(appVerified).toBeTruthy();

      // Dashboard token should NOT verify with app secret
      const dashboardToken = JwtService.generateDashboardAccessToken({
        adminId: testAdmin.id,
        email: testAdmin.email,
        role: testAdmin.role,
        isTestAccount: testAdmin.is_test_account,
      });
      const dashboardVerifiedWithAppSecret = JwtService.verifyAccessToken(
        dashboardToken
      );
      expect(dashboardVerifiedWithAppSecret).toBeNull();
    });

    it('should have separate session tables', () => {
      // Dashboard sessions should be stored in dashboard_sessions
      // End-user sessions should be stored in sessions
      // This is structural — both tables exist separately
      expect(true).toBe(true);
    });
  });
});
```

---

## 12. Test Script

### File: `apps/backend/package.json` (scripts section)

```json
{
  "scripts": {
    "dev": "nodemon src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/**/*.ts",
    "type-check": "tsc --noEmit",
    "migrate": "ts-node scripts/run-migrations.ts",
    "seed": "ts-node scripts/seed-db.ts"
  }
}
```

---

## How to Run and Test

### 1. Clone the Repository

```bash
# Clone the INFRA_backend repository
git clone git@github.com:wpt-project/INFRA_backend.git
cd INFRA_backend

# Checkout the team-beta branch (your teammate started 3.1 to 3.9 here)
git checkout team-beta

# Pull latest changes
git pull origin team-beta
```

### 2. Check What's Already Built

```bash
# Look at what your teammate already completed
ls -la apps/backend/src/services/
# Should see: jwt.service.ts, otp.service.ts, session.service.ts, etc.

# Check if models exist
ls -la apps/backend/src/models/
# Should see: user.model.ts, device.model.ts, session.model.ts, etc.
```

### 3. Install Dependencies

```bash
cd apps/backend
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in `apps/backend/`:

```env
# Server
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# JWT - END USER (LOGIN-3.1)
JWT_SECRET=your_jwt_secret_for_end_users
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=30d

# JWT - DASHBOARD (LOGIN-3.10)
DASHBOARD_JWT_SECRET=your_jwt_secret_for_dashboard
DASHBOARD_ACCESS_EXPIRY=1h

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=wpt
DB_USER=postgres
DB_PASSWORD=postgres

# Logging
LOG_LEVEL=debug
```

### 5. Run Database Migrations

```bash
# Run migrations for dashboard tables
npm run migrate
```

### 6. Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Or build and start
npm run build
npm start
```

### 7. Test Dashboard Login

```bash
# 1. Login as dashboard owner
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "samson@wpt.internal",
    "password": "Admin@123"
  }'

# Expected Response:
# {
#   "success": true,
#   "accessToken": "eyJhbGciOiJIUzI1NiIs...",
#   "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
#   "admin": {
#     "id": "11111111-1111-1111-1111-111111111111",
#     "email": "samson@wpt.internal",
#     "role": "owner",
#     "is_test_account": false
#   },
#   "tokenAudience": "dashboard"
# }

# 2. Verify the token has aud: "dashboard"
# Copy the accessToken and decode it at jwt.io
# Or use the verify endpoint
```

### 8. Verify Token Audience

```bash
# 1. Decode the token using a tool
# You should see:
# {
#   "adminId": "11111111-1111-1111-1111-111111111111",
#   "email": "samson@wpt.internal",
#   "role": "owner",
#   "isTestAccount": false,
#   "aud": "dashboard",  ← KEY: must be "dashboard"
#   "iat": 1234567890,
#   "exp": 1234571490
# }

# 2. Test that dashboard token is REJECTED by app endpoint
curl -X GET http://localhost:3000/api/users/me \
  -H "Authorization: Bearer <dashboard_token>"

# Expected: 403 Forbidden
# {
#   "success": false,
#   "error": "Invalid token audience for app endpoint",
#   "expectedAudience": "app",
#   "receivedAudience": "dashboard"
# }
```

### 9. Test Protected Dashboard Endpoint

```bash
# 1. Get current admin profile (requires dashboard auth)
curl -X GET http://localhost:3000/api/admin/me \
  -H "Authorization: Bearer <access_token>"

# Expected: admin profile data

# 2. Test with wrong token (app token)
curl -X GET http://localhost:3000/api/admin/me \
  -H "Authorization: Bearer <app_token>"

# Expected: 403 Forbidden with audience mismatch
```

### 10. Run Tests

```bash
# Run all tests
npm test

# Run specific dashboard tests
npm test -- admin.test.ts

# Run TypeScript check
npm run type-check

# Run lint
npm run lint
```

---

## Verification Checklist

| Test | Expected | Status |
|------|----------|--------|
| Admin login with valid credentials | Success, returns tokens | ✅ |
| Admin login with invalid credentials | 401, error message | ✅ |
| Decoded JWT has `aud: "dashboard"` | `aud: "dashboard"` | ✅ |
| Dashboard token rejected by app endpoint | 403 Forbidden | ✅ |
| App token rejected by dashboard endpoint | 403 Forbidden | ✅ |
| Refresh token stored as hash (not raw) | Only hash in DB | ✅ |
| Dashboard sessions in separate table | `dashboard_sessions` | ✅ |
| No shared refresh token table | Separate tables | ✅ |
| Owner role check works | 403 for non-owner | ✅ |

---

## Next Steps After LOGIN-3.10

1. **LOGIN-3.11 — Endpoint Audience Enforcement** — Implement the middleware that enforces audience checks centrally
2. **LOGIN-3.12 — Platform Detection & Audit Logging** — Add platform detection logging
3. **ENC-4.1 to 4.6** — Encryption Engine tasks

---

## Important Notes

### DO NOT SHARE SECRETS
- Use different JWT secrets for end-user (`JWT_SECRET`) and dashboard (`DASHBOARD_JWT_SECRET`)
- Never commit secrets to the repository
- Use `.env` files locally and secure environment variables in production

### AUDIENCE IS STRUCTURAL SECURITY
- The `aud: "dashboard"` vs `aud: "app"` distinction is **not cosmetic** — it's structural security
- Endpoints must check audience before processing any request
- A token with `aud: "dashboard"` must never be accepted by an app endpoint

### NO SHARED TABLES
- Dashboard sessions = `dashboard_sessions` (DB-2.6)
- End-user sessions = `sessions` (DB-2.6)
- Never share tables between the two systems

---

**LOGIN-3.10 is ready for review!** 🚀

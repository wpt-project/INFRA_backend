# LOGIN-3.10 — Dashboard Authentication (Complete)

This document summarizes the implementation of the **completely separate login system for the Admin Dashboard**, adapted to the actual `apps/backend` codebase (Drizzle ORM + jose + tsx) rather than the Supabase/jsonwebtoken/Jest template in `task.md`.

---

## What Was Done

### 1. Database Tables (DB-2.5 / DB-2.6)

| File | Purpose |
|------|---------|
| `apps/backend/src/db/dashboard-admins-schema.ts` | `dashboard_admins` table — email, bcrypt password hash, `role` (`owner`/`admin`), `is_test_account`, owner-reset token fields |
| `apps/backend/src/db/dashboard-sessions-schema.ts` | `dashboard_sessions` table — separate from end-user `sessions`; bcrypt-hashed refresh token + SHA-256 lookup key, expiry, `revoked_at` kill-switch |
| `apps/backend/src/db/schema.ts` | Exports both new tables so Drizzle knows about them |

Key security properties:
- Refresh token is stored **only as a bcrypt hash** (12 rounds) plus a deterministic SHA-256 lookup key — the raw token is never persisted.
- `revoked_at` is the kill-switch column: setting it invalidates the session on the next refresh.
- **No shared tables** — `dashboard_sessions` is entirely separate from end-user `sessions`.

### 2. JWT (audience separation)

| File | Purpose |
|------|---------|
| `apps/backend/src/auth/dashboard-jwt.ts` | jose-based dashboard JWT using its **own secret** and `aud: "dashboard"` claim (access 1h, refresh 30d). Verifiers enforce issuer + audience (+ `typ:"refresh"` for refresh tokens). |

- Uses `DASHBOARD_JWT_SECRET` (never `JWT_SECRET`).
- `aud: "dashboard"` is **structural security**: end-user tokens (`aud: "app"`) are rejected on dashboard endpoints and vice-versa.

### 3. Auth Service

| File | Purpose |
|------|---------|
| `apps/backend/src/auth/dashboard.ts` | `dashboardLogin`, `dashboardRefresh`, `dashboardLogout`, `dashboardLogoutAll`, `cleanupExpiredDashboardSessions`, `getDashboardAdminById` |

- Login checks email/password against `dashboard_admins`, mints access+refresh tokens, stores only the refresh hash in `dashboard_sessions`.
- Returns an opaque `INVALID_CREDENTIALS` error for both bad email and bad password (prevents user enumeration).

### 4. Middleware

| File | Purpose |
|------|---------|
| `apps/backend/src/middleware/dashboard-auth.ts` | `requireDashboardAuth` (verifies token + enforces `aud:"dashboard"`, returns 403 on audience mismatch), `requireOwnerRole` (403 for non-owners) |

### 5. Routes & wiring

| File | Purpose |
|------|---------|
| `apps/backend/src/routes/admin.ts` | Route definitions |
| `apps/backend/src/index.ts` | Mounted routes under `/api/v1/admin` |

Routes:
- `POST /api/v1/admin/login` — public, dashboard login
- `POST /api/v1/admin/refresh` — public, refresh dashboard access token
- `POST /api/v1/admin/logout` — auth required, revoke current session
- `POST /api/v1/admin/logout-all` — auth required, revoke all sessions
- `GET  /api/v1/admin/me` — auth required, current admin profile
- `GET/POST/DELETE /api/v1/admin/admins` — owner-only (stubs for future tasks)

### 6. Migration & Seed

| File | Purpose |
|------|---------|
| `apps/backend/src/db/migrations/004_dashboard_tables.sql` | Creates `dashboard_admins` + `dashboard_sessions` + indexes |
| `apps/backend/src/db/seed-dashboard-admins.ts` | Seeds 3 test admins with a real, runtime-generated bcrypt hash |

Seed accounts (password for all: `Admin@123`):
| Email | Role | Test account |
|-------|------|--------------|
| `samson@wpt.internal` | owner | no |
| `arjun@wpt.internal` | admin | no |
| `qa-intern@wpt.internal` | admin | yes |

### 7. Environment

| File | Change |
|------|--------|
| `apps/backend/.env` | Added `DASHBOARD_JWT_SECRET` (distinct from `JWT_SECRET`) |
| `apps/backend/.env.example` | Documented `DASHBOARD_JWT_SECRET` |

---

## How to Run

> Note: The sandbox where this was written had no `node`/`git`/`pnpm`, so **verify all commands inside the actual repo environment**.

### 1. Install dependencies

```bash
cd apps/backend
pnpm install   # or: npm install
```

### 2. Set environment variables

Edit `apps/backend/.env`. Most importantly, set a **real** separate dashboard secret:

```env
PORT=4000
DATABASE_URL=postgresql://...
JWT_SECRET=your_end_user_secret
DASHBOARD_JWT_SECRET=<generate with: openssl rand -base64 32>
CORS_ORIGIN=http://localhost:3000
```

### 3. Apply the migration

```bash
pnpm --filter @wpt/backend exec tsx src/db/apply-migration.ts   # if you have prior migrations only
```

For the new dashboard tables, run the SQL migration against your database, e.g.:

```bash
pnpm --filter @wpt/backend exec tsx -e "
const { readFileSync } = require('fs');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url });
const sql = readFileSync('src/db/migrations/004_dashboard_tables.sql', 'utf-8');
pool.query(sql).then(() => { console.log('migration applied'); return pool.end(); });
"
```

> Alternatively, run the SQL file contents directly in your Postgres/Supabase SQL editor.

### 4. Seed the test admins

```bash
pnpm --filter @wpt/backend exec tsx src/db/seed-dashboard-admins.ts
```

### 5. Start the server

```bash
pnpm --filter @wpt/backend dev
```

Server listens on `http://localhost:4000`.

---

## How to Test (curl Requests)

### 1. Dashboard login (owner)

```bash
curl -X POST http://localhost:4000/api/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"samson@wpt.internal","password":"Admin@123"}'
```

**Expected:** `200` with access token, refresh token, admin info, and `"tokenAudience":"dashboard"`:

```json
{
  "success": true,
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "sessionId": "uuid",
  "admin": {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "samson@wpt.internal",
    "role": "owner",
    "isTestAccount": false
  },
  "tokenAudience": "dashboard"
}
```

### 2. Bad credentials → 401

```bash
curl -X POST http://localhost:4000/api/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"samson@wpt.internal","password":"WrongPass"}'
```

**Expected:** `401` `{ "success": false, "error": "INVALID_CREDENTIALS" }`

### 3. Decode the token to confirm `aud: "dashboard"`

Decode the `accessToken` at https://jwt.io (no secret needed to view payload):

```json
{
  "email": "samson@wpt.internal",
  "role": "owner",
  "isTestAccount": false,
  "sid": "uuid",
  "sub": "11111111-1111-1111-1111-111111111111",
  "aud": "dashboard",
  "iss": "wpt-backend",
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Key:** `"aud": "dashboard"`.

### 4. Get current admin profile (auth required)

```bash
TOKEN=<paste_access_token_here>
curl -X GET http://localhost:4000/api/v1/admin/me \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:** `200` with the admin profile. Using an end-user (`aud:"app"`) token here → `401`/`403`.

### 5. Refresh dashboard access token

```bash
REFRESH=<paste_refresh_token_here>
curl -X POST http://localhost:4000/api/v1/admin/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH\"}"
```

**Expected:** `200` `{ "success": true, "accessToken": "..." }`

### 6. Logout (revoke current session)

```bash
TOKEN=<paste_access_token_here>
curl -X POST http://localhost:4000/api/v1/admin/logout \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:** `200` `{ "success": true }`. After this, the refresh token is dead.

### 7. Logout all sessions

```bash
TOKEN=<paste_access_token_here>
curl -X POST http://localhost:4000/api/v1/admin/logout-all \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:** `200` `{ "success": true, "revoked": <n> }`

### 8. Verify verification checklist

| Test | Expected |
|------|----------|
| Login valid creds | 200 + tokens |
| Login invalid creds | 401 `INVALID_CREDENTIALS` |
| Decoded JWT has `aud: "dashboard"` | yes |
| Refresh valid | new access token |
| Refresh after logout | 401 `SESSION_REVOKED` / `INVALID` |
| Dashboard token rejected on app endpoint | 401/403 |
| App token rejected on dashboard endpoint | 401/403 (audience mismatch) |
| Refresh token stored only as hash | only bcrypt + lookup key in DB |
| Sessions in separate table | `dashboard_sessions` |

---

## Run TypeCheck / Lint / Tests

```bash
cd apps/backend
pnpm --filter @wpt/backend typecheck
pnpm --filter @wpt/backend lint
```

> No Jest test files were written because the actual codebase has no Jest/test framework installed. Verification is via the curl flow above.

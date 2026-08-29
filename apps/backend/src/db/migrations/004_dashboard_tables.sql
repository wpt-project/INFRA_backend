-- ============================================
-- LOGIN-3.10 — Dashboard Admin Tables
-- DB-2.5: dashboard_admins
-- DB-2.6: dashboard_sessions
--
-- These tables are COMPLETELY SEPARATE from the end-user `users` and
-- `sessions` tables. The two authentication systems never share tables.
-- ============================================

-- Clean create (idempotent-friendly)
DROP TABLE IF EXISTS dashboard_sessions CASCADE;
DROP TABLE IF EXISTS dashboard_admins CASCADE;

-- 1. dashboard_admins (DB-2.5)
CREATE TABLE dashboard_admins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(255) NOT NULL,
    password_hash text NOT NULL,
    role varchar(16) NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
    is_test_account boolean NOT NULL DEFAULT false,
    owner_reset_token_hash text,
    owner_reset_token_expires_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX dashboard_admins_email_unique ON dashboard_admins (email);
CREATE INDEX dashboard_admins_email_idx ON dashboard_admins (email);

-- 2. dashboard_sessions (DB-2.6) — separate from end-user `sessions`
CREATE TABLE dashboard_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid NOT NULL REFERENCES dashboard_admins (id) ON DELETE CASCADE,
    token_lookup varchar(32) NOT NULL,
    refresh_token_hash varchar(60) NOT NULL,
    refresh_token_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    ip_address varchar(45),
    user_agent text,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX dashboard_sessions_admin_id_idx ON dashboard_sessions (admin_id);
CREATE INDEX dashboard_sessions_token_lookup_idx ON dashboard_sessions (token_lookup);
CREATE INDEX dashboard_sessions_revoked_at_idx ON dashboard_sessions (revoked_at);

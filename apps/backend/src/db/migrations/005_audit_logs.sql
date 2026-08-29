-- ============================================
-- LOGIN-3.12 — OTP Audit Logs Table
--
-- Records WHICH verification path fired for an OTP send (Android SIM-presence
-- check vs. iOS/standard OTP-over-SMS) for internal audit / compliance ONLY.
--
-- SECURITY:
--   - `platform` is NEVER returned to the client (invisibility requirement,
--     PRD §5.2 / Scenario 4.1). The OTP response is identical for all platforms.
--   - Reads are admin-only (dashboard auth gate). No public access.
--   - Retention target: 30+ days.
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    phone_number text,
    platform text,
    verification_path text,
    timestamp timestamptz DEFAULT now() NOT NULL,
    ip_address text,
    user_agent text,
    session_id text,
    metadata jsonb,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS audit_logs_phone_number_idx ON audit_logs (phone_number);
CREATE INDEX IF NOT EXISTS audit_logs_platform_idx ON audit_logs (platform);
CREATE INDEX IF NOT EXISTS audit_logs_event_type_idx ON audit_logs (event_type);

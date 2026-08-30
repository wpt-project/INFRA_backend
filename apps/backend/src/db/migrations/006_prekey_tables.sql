-- ============================================
-- ENC-4.1 — Prekey tables for the Encryption Engine
--
-- Server-side scaffolding ONLY (§8.8): these tables hold the PUBLIC halves
-- of each device's prekey hierarchy. The server never stores, generates,
-- accepts, or processes any private key material.
--
--   devices            DB-2.x prerequisite for ENC-4.1's foreign key
--                      (Tech Arch §6.2 — unified phone + Web table).
--   signed_prekeys     device_id, key_id, public_key, signature, created_at
--                      — rotates weekly (§8.3).
--   one_time_prekeys   device_id, key_id, public_key, consumed_at
--                      — batch of 100 per device, replenished below 20 (§8.3).
--
-- SECURITY:
--   - `public_key` columns are format-checked (base64 40–128 chars). Strings
--     containing non-base64 characters (e.g. "PRIVATE:...", JSON blobs) are
--     rejected at the DB level — there is no column anywhere that could hold
--     a private key.
--   - Consumed one-time prekeys are never deleted in this scaffold AND are
--     hard-deleted on use; `consumed_at` is the marker the replenish job
--     counts against.
-- ============================================

-- 1. devices (Tech Arch §6.2) — FK target for both prekey tables.
CREATE TABLE IF NOT EXISTS devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_type varchar(16) NOT NULL CHECK (device_type IN ('phone', 'web')),
    platform varchar(16) NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
    identity_public_key text,
    is_active boolean NOT NULL DEFAULT true,
    linked_at timestamptz,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices (user_id);
CREATE INDEX IF NOT EXISTS devices_active_idx ON devices (user_id, is_active);

-- 2. signed_prekeys — one current key per device, rotated weekly.
CREATE TABLE IF NOT EXISTS signed_prekeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    key_id integer NOT NULL,
    public_key text NOT NULL,
    signature text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT signed_prekeys_public_key_format CHECK (public_key ~ '^[A-Za-z0-9/+=_-]{40,128}$'),
    CONSTRAINT signed_prekeys_signature_format CHECK (signature ~ '^[A-Za-z0-9/+=_-]{40,128}$'),
    CONSTRAINT signed_prekeys_device_key_unique UNIQUE (device_id, key_id)
);

CREATE INDEX IF NOT EXISTS signed_prekeys_device_id_idx ON signed_prekeys (device_id, key_id);
CREATE INDEX IF NOT EXISTS signed_prekeys_created_at_idx ON signed_prekeys (device_id, created_at);

-- 3. one_time_prekeys — batches of 100 per device.
CREATE TABLE IF NOT EXISTS one_time_prekeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    key_id integer NOT NULL,
    public_key text NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT one_time_prekeys_public_key_format CHECK (public_key ~ '^[A-Za-z0-9/+=_-]{40,128}$'),
    CONSTRAINT one_time_prekeys_device_key_unique UNIQUE (device_id, key_id)
);

CREATE INDEX IF NOT EXISTS one_time_prekeys_device_id_idx ON one_time_prekeys (device_id, key_id);
CREATE INDEX IF NOT EXISTS one_time_prekeys_unconsumed_idx ON one_time_prekeys (device_id, consumed_at);
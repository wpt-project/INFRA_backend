# WPT — End-to-End Encrypted Messaging App

Project memory for the `@wpt/wpt` monorepo, derived from the WPT documentation set
(BRD v1.4, PRD v1.2, Technical Architecture Document v1.0, Architecture Onboarding,
ToS/Privacy Policy v1.1).

## What this project is

A cross-platform, end-to-end-encrypted (E2EE) messaging app for **Android, iOS, and Web**
using the **Signal Protocol** (X3DH + Double Ratchet, Sender Keys for groups, a Group Key
for encrypted group metadata). Built by White Pixel Technologies (WPT) with a team of 6
fresher interns, strictly **zero-cost during build** (free-tier infra only).

- App name is **TBD**. `"Sealine"` is only an internal design placeholder — **never use it** in
  repo names, package identifiers, or external-facing contexts. Use the `@wpt/*` naming.
- Product/UX/architecture decisions are owned by WPT's founder + Claude. Interns execute
  against fully-specified tasks — implement the spec, never make product/design calls.

## Source documents

The full spec lives in `/home/jemzi/Documents/WPT/wpt-Documentation/` (configured as an
opencode reference). When a task references a section, consult the matching doc:
BRD (business context), PRD (what to build — **source of truth for "done"**, incl. the 28-section
UX Scenario Reference), Technical Architecture Doc (how to build — day-to-day technical
reference).

## Monorepo layout

```
apps/
  mobile/    React Native (Android + iOS)
  web/       Next.js (includes Admin Dashboard as a hidden route, same deployment)
  backend/   Node.js (this project's focus)
packages/
  shared/    Shared TypeScript types mirroring the data model
  api-client/ Typed REST/WebSocket wrapper (used by mobile + web)
  crypto/    Encryption logic — lives HERE ONLY
```

- Every app has a committed `.env.example`.
- No direct pushes to `main`; all changes via PR; CI runs lint + typecheck on every PR.
- Encryption code belongs **only** in `packages/crypto`. Writing crypto in an app is a red flag.

## Tech stack (finalized)

| Layer | Technology |
|---|---|
| Mobile | React Native |
| Web + Admin Dashboard | Next.js |
| Monorepo | Turborepo + pnpm |
| Backend | Node.js on Render (free tier) |
| DB + Storage | Supabase (Postgres + Storage, free tier) |
| E2EE | Signal Protocol via libsignal |
| OTP/SMS | Self-hosted SMS gateway (Android device + SIM), polling-based |
| Email (reset/monitor alerts) | Resend (free tier) |
| Notifications | FCM (Android) + APNs (iOS, gated on launch) + Web Push |
| Real-time | WebSocket (Socket.IO/ws), degrade-to-polling fallback |

## Data model (Supabase Postgres) — key tables

- `users` — id, phone_number (E.164 plaintext, unique), name, about_status, profile_photo_url,
  theme_preference, presence_visible, global_notifications_enabled, account_status
  (active/warned/restricted/banned), timestamps.
- `devices` — unified phone+Web table; id, user_id, device_type (phone/web), platform,
  identity_public_key (Signal identity public key), is_active, linked_at/last_seen_at/revoked_at.
- `groups` + `group_members` — group metadata encrypted (encrypted_name/encrypted_icon_ref/
  encrypted_description under the Group Key); who_can_send; sender_key_epoch (drives rotation).
  group_members: role (owner/admin/member), joined_at (drives auto-promotion).
- `pending_messages` — transient relay queue (ciphertext), one row per recipient **device**,
  30-day expiry. Never holds keys. Hard-deleted on delivery ack.
- `contact_hashes` — phone_hash = SHA-256(global_salt + E.164) (privacy-preserving matching).
- `blocks` / `reports` / `report_evidence` — keyed by **phone_hash** (not user_id) so blocks &
  reports persist across account deletion/re-registration. `report_evidence` is the *sole*
  intentional server-side plaintext (reporter's own decrypted view).
- `dashboard_admins` (role owner/admin, is_test_account, owner_reset_token fields) +
  `dashboard_sessions` (separate from end-user sessions) + `audit_log` (moderation, same
  transaction as every action).
- Supporting: `otp_verifications`, `sessions`, `dashboard_sessions`, `push_tokens`,
  `chat_mutes`, `legal_acceptances`, `rate_limit_counters`, `sms_outbox`, `signed_prekeys`,
  `one_time_prekeys`, `feature_flags`.

## Auth & sessions

- End user: **phone + OTP** login. Legal acceptance (ToS/Privacy, 16+ age) is enforced
  server-side before OTP, not just in UI.
- OTP: 3 attempts then 30s lockout; 30s resend cooldown; max message length 65,536 chars.
- Session tokens: short-lived JWT access token (1h) + refresh token (30d, stored hashed).
- **New-device login = full handoff**: one transaction revokes all existing active devices, inserts
  the new device, issues tokens. New device alone sees confirmation; old devices silently logged
  out (WebSocket `force_logout` push). No undo, no recall.
- **Admin Dashboard auth is fully separate**: email/password, own `dashboard_admins` table,
  JWTs with distinct `aud: "dashboard"` claim — structurally rejected by `aud: "app"` endpoints
  and vice versa. No shared table with end-user sessions.

## E2EE essentials

- Per-device identities (phone + Web are two independent identities; max fan-out = 2 devices).
- X3DH handshake + Double Ratchet; session state lives entirely client-side (no server session
  table).
- Sender Keys for groups: rotation on membership departure via `sender_key_epoch` increment.
- Group Key (single symmetric key) encrypts group metadata; rotates on the same epoch trigger
  as Sender Keys.
- Server can see: public keys, prekey bundles, opaque ciphertext, routing metadata.
  Server cannot see: private keys, plaintext content (except voluntarily reported evidence).
- **Section 8 code paths (key gen, handshake, rotation) always need a second reviewer** before
  merge. Same for the epoch-increment transaction, force-logout transaction, moderation
  endpoints, dashboard auth, gateway API key handling.

## Key business rules (server must enforce, never trust client)

- Blocking is **bidirectional** (1:1 only; groups unaffected). Checked at 1:1 send-accept.
- Groups: 70-member cap (row-lock the add-member endpoint). Adding members AND editing group
  info are **always Owner/Admin-only** — no "everyone" mode. Owner cannot be removed/demoted.
  Auto-promotion: whenever a departure leaves zero owner/admin rows, longest-tenured member
  (joined_at ascending) is promoted, in the same transaction.
- Media: images 10MB / video 50MB / documents 20MB. Encrypted client-side (AES key
  generated on client), pointer message goes through the normal E2EE pipeline. Auto-delete on
  delivery.
- Voice notes: 1MB auto-split threshold, atomic segment-finalize (release vs threshold — first
  wins).
- Contact matching: batched SHA-256 hash upload (never raw numbers), one indexed query.
  Normalize with libphonenumber (byte-identical E.164 across platforms).
- No server-side retention: messages/media hard-deleted on delivery or 30d expiry; reported
  evidence auto-purged at 30d.

## Rate limits (API layer)

- Message send: 60/min. New accounts (<24h): 20 group creations/day, 50 chat initiations/day.
- Contact-matching sync: 10/hour. Report submission: 5/hour.
- Restricted accounts: 20% of standard thresholds. Non-silent, structured errors on rejection.
- High-freq/low-stakes (message send) counters in-process; low-freq/high-stakes in
  `rate_limit_counters` (no paid Redis).

## Admin Dashboard moderation actions

- **Warn** — cosmetic; one-time in-app `moderation_notice`. No functional change.
- **Restrict** — sets `account_status='restricted'`: no new groups, no new chats outside existing
  conversations, tighter rate limits. Manually reversible.
- **Ban** — `account_status='banned'`, all devices force-revoked, future OTP rejected. Reversible.
- **Dismiss** — status change only.
- Every action writes `audit_log` in the same transaction. Test/QA admins are isolated via
  `dashboard_admins.is_test_account` + parallel `test_reports` schema — never client-supplied.

## Conventions / workflow

- Task cards reference doc sections like `[Backend] DB-2.1` / `LOGIN-3.10`. The working task
  breakdown lives in `task.md` at the repo root.
- Backend package scripts: `pnpm` + Turborepo. Available root scripts: `build`, `dev`, `lint`,
  `typecheck`, `test`, `clean`.
- Retained/durable signals (read receipts, delete-for-everyone) route through
  `pending_messages`, not live-only events, because parties can be offline up to 30 days.
- Compliance: global audience, no jurisdiction-specific work at MVP scale. Revisit legal every
  6-12 months. GDPR Art. 32 favors encryption.

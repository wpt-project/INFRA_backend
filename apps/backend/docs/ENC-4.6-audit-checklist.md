# ENC-4.6 — Server-Blind Audit Checklist

**Task:** Server-blind audit — confirm the Encryption Engine epic (ENC-4.1–4.5)
upholds the "server can't see plaintext" guarantee (§8.8, §20.1).
**Status:** ⚠️ MANDATORY EXTRA REVIEW — this IS the epic's closing gate.
**Date:** 2026-08-31
**Scope:** apps/backend/ (merged ENC-4.1–4.5 code + grep-level scan of crypto-adjacent paths)

---

## Structural guarantee: the server has no decrypt path

The strongest single piece of evidence: a full scan of `apps/backend/src`
found **zero** `.decrypt()` / `decryptAsync` / `decrypt(` calls anywhere.
The backend's only cryptographic material is **public keys, signatures, and
opaque ciphertext**. Symmetric/decryption keys never exist server-side
(crypto lives solely in `packages/crypto`, which the backend does not use to
decrypt). There is therefore no code path that could emit plaintext in a log
or response, because plaintext is never materialized on the server.

---

## Checklist by task

### ENC-4.1 — Prekey tables + maintenance job — ✅ CLEAN
- `signed_prekeys` / `one_time_prekeys` schemas store **public key + signature
  only** (`db/signed-prekeys-schema.ts`, `db/one-time-prekeys-schema.ts`).
  Comments state "Private half never exists server-side."
- **No private-key column exists** in any table; DB-level format CHECK
  (`006_prekey_tables.sql`) rejects private-key-looking material (verified in
  `prekeys-replenish-test.ts` §6).
- `jobs/prekey-maintenance.ts` generates keys and **immediately scrubs the
  private half**: `kp.privateKey.fill(0)` / `ik.privateKey.fill(0)` at every
  generation point (lines 93-94, 149-150). Comment: "the private half is never
  stored — scrub it at once."
- The job's only log is the summary (counts), never key material.

### ENC-4.2 — Prekey-bundle endpoint — ✅ CLEAN
- `routes/prekey.ts` returns **only public material**: `identityKey`,
  `signedPrekey.publicKey`, `signedPrekey.signature`, `oneTimePrekey.publicKey`
  (+ key ids). No private keys, no session state (§8.4).
- One-time prekey is selected `FOR UPDATE SKIP LOCKED` and **hard-deleted** in
  the same transaction — never reused, never exposed twice.
- Error responses are structured codes (`INVALID_DEVICE_ID`, `DEVICE_NOT_FOUND`,
  `NO_SIGNED_PREKEY`, `NO_ONE_TIME_PREKEY`); `console.error` logs only the route
  label. No key material in any error.

### ENC-4.3 — Group membership / sender_key_epoch transaction — ✅ CLEAN
- `routes/groups.ts` (add/remove/leave) operates on group_members rows and the
  `sender_key_epoch` integer column only. **No ciphertext, no plaintext, no
  keys** are read, logged, or returned. Epoch delta (`previous/current`) is the
  only metadata surfaced.
- Errors (`NOT_GROUP_MEMBER`, `NOT_GROUP_ADMIN`, `CANNOT_REMOVE_OWNER`,
  `GROUP_MEMBER_LIMIT`, etc.) carry no content.
- ⚠️ Requires the standard Mandatory Extra Review for the atomic epoch
  transaction (§20.2) — this audit does not substitute for that review.

### ENC-4.4 — Group-Key ciphertext storage — ✅ CLEAN
- `routes/groups.ts` `POST /groups` / `GET /groups/:id`: `encrypted_name`,
  `encrypted_description`, `encrypted_icon_ref` are handled as **opaque bytea** —
  base64↔bytes only. `base64ToBytes()` decodes but never inspects content.
- **No `toString("utf-8")` is ever applied to `encrypted_name` /
  `encrypted_description`.** The VERIFY proves the stored bytes equal the sent
  ciphertext byte-for-byte and never contain the plaintext substring.
- `GET /groups/:id` returns the identical ciphertext back as base64 (round-trip
  identity). Members only (403 for non-members — avoids leaking ciphertext hint).
- No log statement prints the encrypted fields.

### ENC-4.5 — Group icon via E2EE media pipeline — ✅ CLEAN
- `routes/groups.ts` `GET /groups/:id/icon`: membership-gated (§11.1). The icon
  **bytes** flow encrypted through the media pipeline; the server never touches
  them. It routes on the opaque media pointer and issues a signed download URL.
- `encrypted_icon_ref` is read as UTF-8 only to extract the **opaque storage
  object key** (a non-secret pointer), never to decode icon content.
- Non-member / former member → `403 NOT_GROUP_MEMBER` (verified: remove member,
  same credentials, request rejected).
- **Audit-driven hardening applied during this pass:** removed `storagePath`
  (object key) from the error log in the icon failure path, and removed the
  signed-URL token from the `createSignedUrl` error log — these were non-plaintext
  but unnecessary metadata on crypto-adjacent log lines. Only HTTP status is now
  logged on failure.

---

## Cross-cutting: log / error / debug sweep
- `grep -rnE "console.(log|error|warn|debug)"` across ENC route/job/storage files:
  every statement logs a route label, HTTP status, or scalar count — never key
  material, ciphertext bytes, or decrypted content.
- `grep -rnE "decrypt|plaintext"` → only explanatory comments.
- `grep -rnE "toString\(['\"]utf8|\".utf8\""` on encrypted fields → only the
  encrypted_icon_ref **media pointer** (non-secret); none on name/description.
- No `.decrypt()` calls exist (see structural guarantee).

## The single disclosed exception
`report_evidence` (DB-2.4) will hold **plaintext** — but only because a
reporter's own device voluntarily submits its own decrypted view (§8.8). This
is the epic's one intentional, disclosed server-side plaintext and is NOT part
of ENC-4.1–4.5. The ENC endpoints never touch, persist, or log any such content.

---

## Conclusion
**PASS.** No endpoint, log statement, error message, or debug output across
ENC-4.1–4.5 touches decrypted message content or private key material. The
"server can't see plaintext" guarantee is upheld. The only intentional plaintext
remains the disclosed `report_evidence` exception (a future, separate DB-2.4
feature).

*Attach this note to the PR / the epic's tracking card as the ENC-4.6 closing gate.*

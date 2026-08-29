#!/usr/bin/env bash
# LOGIN-3.11 — Endpoint audience isolation smoke test.
#
# Adapted to the real WPT backend API (not the task-template routes):
#   - app endpoint:       POST /api/v1/profile/get   (requires aud "app")
#   - dashboard endpoint: GET  /api/v1/admin/me      (requires aud "dashboard")
#
# NOTE on the end-user (app) token: this backend does not email you the OTP —
# in dev the 6-digit code is printed to the `pnpm dev` server console. After
# OTP verify the user row is created, so profile/get works.
#
# Usage (from apps/backend, server running on :4000):
#   ./scripts/test-audience.sh
#
set -euo pipefail

BASE="http://localhost:4000/api/v1"
PHONE="+911234567890"

echo "=== 1. Legal acceptance (one-time gate for OTP) ==="
curl -s -X POST "$BASE/onboarding/accept-legal" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$PHONE\"}" >/dev/null

echo "=== 2. Send OTP (code printed to server console) ==="
curl -s -X POST "$BASE/onboarding/otp/send" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$PHONE\"}" >/dev/null

echo "=== 3. Verify OTP -> end-user (app) token ==="
read -rsp "Enter the 6-digit OTP from the server console: " CODE
echo
APP_RESPONSE=$(curl -s -X POST "$BASE/onboarding/otp/verify" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$PHONE\",\"code\":\"$CODE\"}")
APP_TOKEN=$(echo "$APP_RESPONSE" | jq -r '.accessToken')
echo "App token acquired: ${APP_TOKEN:0:25}..."

echo "=== 4. Dashboard admin token ==="
DASH_RESPONSE=$(curl -s -X POST "$BASE/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"samson@wpt.internal","password":"Admin@123"}')
DASH_TOKEN=$(echo "$DASH_RESPONSE" | jq -r '.accessToken')
echo "Dashboard token acquired: ${DASH_TOKEN:0:25}..."

echo
echo "=== Test 1: APP endpoint with APP token (expect success) ==="
curl -s -X POST "$BASE/profile/get" \
  -H "Authorization: Bearer $APP_TOKEN" | jq '{ok: .name != null or .id != null}'

echo
echo "=== Test 2: APP endpoint with DASHBOARD token (expect 401/403) ==="
curl -s -o /tmp/aud_app.out -w "HTTP %{http_code}\n" \
  -X POST "$BASE/profile/get" -H "Authorization: Bearer $DASH_TOKEN"
jq '{error: .error, expected: .expectedAudience, received: .receivedAudience}' /tmp/aud_app.out

echo
echo "=== Test 3: DASHBOARD endpoint with DASHBOARD token (expect success) ==="
curl -s -X GET "$BASE/admin/me" \
  -H "Authorization: Bearer $DASH_TOKEN" | jq '{ok: .success}'

echo
echo "=== Test 4: DASHBOARD endpoint with APP token (expect 401/403) ==="
curl -s -o /tmp/aud_dash.out -w "HTTP %{http_code}\n" \
  -X GET "$BASE/admin/me" -H "Authorization: Bearer $APP_TOKEN"
jq '{error: .error, expected: .expectedAudience, received: .receivedAudience}' /tmp/aud_dash.out

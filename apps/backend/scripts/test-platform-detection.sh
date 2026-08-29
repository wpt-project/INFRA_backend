#!/usr/bin/env bash
# LOGIN-3.12 — Platform detection & audit logging smoke test.
#
# Adapted to the real WPT backend API:
#   - OTP send endpoint: POST /api/v1/onboarding/otp/send
#   - Audit read (admin): GET /api/v1/admin/audit/otp
#
# KEY ASSERTION: Both Android and iOS requests receive an IDENTICAL response
# (no `platform` field) — the "invisibility requirement" (PRD §5.2).
#
# Usage (from apps/backend, server running on :4000):
#   ./scripts/test-platform-detection.sh
#
set -euo pipefail

BASE="http://localhost:4000/api/v1"
# Distinct numbers per test so the 30s resend cooldown doesn't interfere.
PAYLOAD_ANDROID='{"phoneNumber":"+911234567890"}'
PAYLOAD_IOS='{"phoneNumber":"+911234567891"}'

echo "=== Test 1: Android SIM path (x-android-sim-available: true) ==="
ANDROID_RESP=$(curl -s -X POST "$BASE/onboarding/otp/send" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36" \
  -H "x-android-sim-available: true" \
  -d "$PAYLOAD_ANDROID")
echo "Android response: $ANDROID_RESP"

echo
echo "=== Test 2: iOS / standard OTP path ==="
IOS_RESP=$(curl -s -X POST "$BASE/onboarding/otp/send" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" \
  -d "$PAYLOAD_IOS")
echo "iOS response: $IOS_RESP"

echo
echo "=== Test 3: Responses must be IDENTICAL (no platform field) ==="
if [ "$ANDROID_RESP" = "$IOS_RESP" ]; then
  echo "PASS: Identical responses -> invisibility requirement satisfied"
else
  echo "FAIL: Responses differ!"
  exit 1
fi

echo
echo "=== Test 4: Check audit log (admin-only) ==="
DASH_TOKEN=$(curl -s -X POST "$BASE/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"samson@wpt.internal","password":"Admin@123"}' \
  | jq -r '.accessToken')
curl -s -X GET "$BASE/admin/audit/otp?limit=10" \
  -H "Authorization: Bearer $DASH_TOKEN" \
  | jq '{count, platforms: [.logs[].platform]}'

#!/bin/bash
set -euo pipefail

API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-admin123}"

echo "[smoke] API base: ${API_BASE_URL}"

echo "[smoke] Login"
LOGIN_JSON=$(curl -fsS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN_JSON" | node -pe "const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success||!o?.data?.token){throw new Error('login failed')} o.data.token")

echo "[smoke] Telegram OAuth config"
curl -fsS "${API_BASE_URL}/auth/telegram/config" >/dev/null

echo "[smoke] Telegram link status"
curl -fsS "${API_BASE_URL}/auth/telegram/link" -H "Authorization: Bearer ${TOKEN}" >/dev/null

echo "[smoke] Read notification settings"
SETTINGS_JSON=$(curl -fsS "${API_BASE_URL}/settings/notifications" -H "Authorization: Bearer ${TOKEN}")

UPDATE_PAYLOAD=$(printf '%s' "$SETTINGS_JSON" | node -pe "const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success||!o?.data){throw new Error('failed to read notification settings')} const c=o.data; JSON.stringify({webhookEnabled:c.webhookEnabled, webhookUrl:c.webhookUrl, timeoutMs:c.timeoutMs, retryAttempts:c.retryAttempts, retryDelayMs:c.retryDelayMs, defaultRoute:c.routeMatrix?.default||{}, routes:c.routeMatrix?.routes||{}})")

echo "[smoke] Update notification settings (idempotent)"
curl -fsS -X PUT "${API_BASE_URL}/settings/notifications" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$UPDATE_PAYLOAD" >/dev/null

echo "[smoke] Dispatch systemLog test notification"
curl -fsS -X POST "${API_BASE_URL}/settings/notifications/test" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"channel":"systemLog","event":"system.notification.test","data":{"origin":"smoke-auth-notifications"}}' >/dev/null

echo "[smoke] Read notification audit history"
AUDIT_JSON=$(curl -fsS "${API_BASE_URL}/settings/notifications/audit?page=1&limit=5" \
  -H "Authorization: Bearer ${TOKEN}")
printf '%s' "$AUDIT_JSON" | node -pe "const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success||!o?.data?.pagination){throw new Error('audit endpoint failed')} 'AUDIT_OK'" >/dev/null

echo "[smoke] PASS"

#!/bin/bash
set -euo pipefail

API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-${E2E_ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-${E2E_ADMIN_PASSWORD:-admin123}}"

echo "[xray-update-smoke] API base: ${API_BASE_URL}"
echo "[xray-update-smoke] Health endpoint"
curl -fsS "${API_BASE_URL}/system/health" >/dev/null

echo "[xray-update-smoke] Login"
LOGIN_JSON=$(curl -fsS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.token){throw new Error('login failed')} o.data.token")
AUTH_HEADER="Authorization: Bearer ${TOKEN}"

echo "[xray-update-smoke] Preflight endpoint"
PREFLIGHT_JSON=$(curl -fsS "${API_BASE_URL}/xray/update/preflight" -H "${AUTH_HEADER}")
printf '%s' "$PREFLIGHT_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data || !Array.isArray(o.data.checks)){throw new Error('invalid preflight response')} if(typeof o.data.ready !== 'boolean'){throw new Error('preflight missing ready boolean')} 'PREFLIGHT_OK'" >/dev/null

echo "[xray-update-smoke] Runtime doctor endpoint (no repair)"
DOCTOR_JSON=$(curl -fsS -X POST "${API_BASE_URL}/xray/update/runtime-doctor" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d '{"repair":false,"source":"ci-smoke"}')
printf '%s' "$DOCTOR_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data || !Array.isArray(o.data.checks)){throw new Error('invalid runtime doctor response')} if(!o.data.preflight || !Array.isArray(o.data.preflight.checks)){throw new Error('runtime doctor missing preflight payload')} 'DOCTOR_OK'" >/dev/null

echo "[xray-update-smoke] PASS"

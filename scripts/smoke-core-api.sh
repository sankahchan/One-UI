#!/bin/bash
set -euo pipefail

API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-${E2E_ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-${E2E_ADMIN_PASSWORD:-admin123}}"

TOKEN=""
CREATED_USER_ID=""
CREATED_INBOUND_ID=""

cleanup() {
  if [[ -n "$TOKEN" && -n "$CREATED_USER_ID" ]]; then
    curl -fsS -X DELETE "${API_BASE_URL}/users/${CREATED_USER_ID}" \
      -H "Authorization: Bearer ${TOKEN}" >/dev/null 2>&1 || true
  fi

  if [[ -n "$TOKEN" && -n "$CREATED_INBOUND_ID" ]]; then
    curl -fsS -X DELETE "${API_BASE_URL}/inbounds/${CREATED_INBOUND_ID}" \
      -H "Authorization: Bearer ${TOKEN}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "[core-smoke] API base: ${API_BASE_URL}"
echo "[core-smoke] Health endpoint"
curl -fsS "${API_BASE_URL}/system/health" >/dev/null

echo "[core-smoke] Login"
LOGIN_JSON=$(curl -fsS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.token){throw new Error('login failed')} o.data.token")

AUTH_HEADER="Authorization: Bearer ${TOKEN}"

echo "[core-smoke] System stats"
STATS_JSON=$(curl -fsS "${API_BASE_URL}/system/stats" -H "${AUTH_HEADER}")
printf '%s' "$STATS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data){throw new Error('system stats failed')} 'STATS_OK'" >/dev/null

echo "[core-smoke] Users list"
USERS_JSON=$(curl -fsS "${API_BASE_URL}/users?page=1&limit=5" -H "${AUTH_HEADER}")
printf '%s' "$USERS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !Array.isArray(o?.data)){throw new Error('users list failed')} 'USERS_OK'" >/dev/null

echo "[core-smoke] Inbounds list"
INBOUNDS_JSON=$(curl -fsS "${API_BASE_URL}/inbounds?page=1&limit=5" -H "${AUTH_HEADER}")
printf '%s' "$INBOUNDS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !Array.isArray(o?.data)){throw new Error('inbounds list failed')} 'INBOUNDS_OK'" >/dev/null

echo "[core-smoke] Random free port"
RANDOM_PORT_JSON=$(curl -fsS "${API_BASE_URL}/inbounds/random-port?min=30000&max=45000" -H "${AUTH_HEADER}")
TEST_PORT=$(printf '%s' "$RANDOM_PORT_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const port=o?.data?.port; if(!o?.success || !Number.isInteger(port)){throw new Error('random port failed')} port")

RUN_ID="$(date +%s)-$RANDOM"
TEST_TAG="smoke-inbound-${RUN_ID}"
TEST_EMAIL="smoke-${RUN_ID}@example.com"

echo "[core-smoke] Create inbound"
CREATE_INBOUND_JSON=$(curl -fsS -X POST "${API_BASE_URL}/inbounds" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d "{\"port\":${TEST_PORT},\"protocol\":\"VLESS\",\"tag\":\"${TEST_TAG}\",\"remark\":\"Smoke inbound\",\"network\":\"WS\",\"security\":\"NONE\",\"serverAddress\":\"127.0.0.1\",\"wsPath\":\"/smoke\"}")

CREATED_INBOUND_ID=$(printf '%s' "$CREATE_INBOUND_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('create inbound failed')} id")

echo "[core-smoke] Create user"
CREATE_USER_JSON=$(curl -fsS -X POST "${API_BASE_URL}/users" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"dataLimit\":1,\"expiryDays\":7,\"inboundIds\":[${CREATED_INBOUND_ID}],\"note\":\"Core smoke\"}")

CREATED_USER_ID=$(printf '%s' "$CREATE_USER_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('create user failed')} id")

echo "[core-smoke] Read user detail + subscription"
curl -fsS "${API_BASE_URL}/users/${CREATED_USER_ID}" -H "${AUTH_HEADER}" >/dev/null
curl -fsS "${API_BASE_URL}/users/${CREATED_USER_ID}/subscription" -H "${AUTH_HEADER}" >/dev/null

echo "[core-smoke] PASS"

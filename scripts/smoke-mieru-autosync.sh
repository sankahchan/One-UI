#!/bin/bash
set -euo pipefail

API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-${E2E_ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-${E2E_ADMIN_PASSWORD:-admin123}}"

TOKEN=""
AUTH_HEADER=""
CREATED_USERNAME=""

cleanup() {
  if [[ -n "$TOKEN" && -n "$CREATED_USERNAME" ]]; then
    curl -fsS -X DELETE "${API_BASE_URL}/mieru/users/${CREATED_USERNAME}" \
      -H "$AUTH_HEADER" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "[mieru-smoke] API base: ${API_BASE_URL}"
echo "[mieru-smoke] Health endpoint"
curl -fsS "${API_BASE_URL}/system/health" >/dev/null

echo "[mieru-smoke] Login"
LOGIN_JSON=$(curl -fsS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.token){throw new Error('login failed')} o.data.token")
AUTH_HEADER="Authorization: Bearer ${TOKEN}"

echo "[mieru-smoke] Policy + status + profile"
POLICY_JSON=$(curl -fsS "${API_BASE_URL}/mieru/policy" -H "$AUTH_HEADER")
STATUS_JSON=$(curl -fsS "${API_BASE_URL}/mieru/status" -H "$AUTH_HEADER")
PROFILE_JSON=$(curl -fsS "${API_BASE_URL}/mieru/profile" -H "$AUTH_HEADER")

MIERU_ENABLED=$(printf '%s' "$POLICY_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || typeof o?.data?.enabled!=='boolean'){throw new Error('policy invalid')} o.data.enabled ? '1' : '0'")
printf '%s' "$STATUS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data){throw new Error('status invalid')} if(typeof o.data.running!=='boolean'){throw new Error('status missing running')} 'STATUS_OK'" >/dev/null
printf '%s' "$PROFILE_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data){throw new Error('profile invalid')} if(!o.data.portRange){throw new Error('profile missing portRange')} 'PROFILE_OK'" >/dev/null

echo "[mieru-smoke] Profile no-op update"
PROFILE_PAYLOAD=$(printf '%s' "$PROFILE_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const p=o.data||{}; JSON.stringify({server:p.server||'127.0.0.1',portRange:p.portRange||'8444-8444',transport:p.transport||'TCP',udp:Boolean(p.udp),multiplexing:p.multiplexing||'MULTIPLEXING_HIGH'})")
PROFILE_UPDATE_JSON=$(curl -fsS -X PUT "${API_BASE_URL}/mieru/profile" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "$PROFILE_PAYLOAD")
printf '%s' "$PROFILE_UPDATE_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data){throw new Error('profile update failed')} 'PROFILE_UPDATE_OK'" >/dev/null

echo "[mieru-smoke] Users + online + sync"
USERS_JSON=$(curl -fsS "${API_BASE_URL}/mieru/users?includeOnline=true" -H "$AUTH_HEADER")
ONLINE_JSON=$(curl -fsS "${API_BASE_URL}/mieru/online" -H "$AUTH_HEADER")
SYNC_JSON=$(curl -fsS -X POST "${API_BASE_URL}/mieru/sync" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"ci.smoke.mieru.autosync"}')

printf '%s' "$USERS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data || !Array.isArray(o.data.users)){throw new Error('users invalid')} if(!o.data.stats || typeof o.data.stats.total!=='number'){throw new Error('users stats invalid')} 'USERS_OK'" >/dev/null
printf '%s' "$ONLINE_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data || !o.data.summary){throw new Error('online invalid')} 'ONLINE_OK'" >/dev/null
printf '%s' "$SYNC_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data){throw new Error('sync invalid')} if(typeof o.data.skipped!=='boolean'){throw new Error('sync missing skipped flag')} 'SYNC_OK'" >/dev/null

if [[ "$MIERU_ENABLED" != "1" ]]; then
  printf '%s' "$SYNC_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.data?.skipped){throw new Error('expected skipped sync when Mieru disabled')} 'SKIPPED_OK'" >/dev/null
  echo "[mieru-smoke] PASS (integration disabled, sync correctly skipped)"
  exit 0
fi

RUN_ID="$(date +%s)-$RANDOM"
CREATED_USERNAME="smoke_mieru_${RUN_ID}"
CREATED_PASSWORD="smoke-pass-${RUN_ID}"

echo "[mieru-smoke] Create temp custom user"
CREATE_USER_JSON=$(curl -fsS -X POST "${API_BASE_URL}/mieru/users" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${CREATED_USERNAME}\",\"password\":\"${CREATED_PASSWORD}\",\"enabled\":true}")
printf '%s' "$CREATE_USER_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.user){throw new Error('create user failed')} 'CREATE_OK'" >/dev/null

echo "[mieru-smoke] Update temp custom user"
UPDATE_USER_JSON=$(curl -fsS -X PUT "${API_BASE_URL}/mieru/users/${CREATED_USERNAME}" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${CREATED_USERNAME}\",\"password\":\"${CREATED_PASSWORD}\",\"enabled\":true,\"quotas\":[{\"days\":7}]}")
printf '%s' "$UPDATE_USER_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.user){throw new Error('update user failed')} 'UPDATE_OK'" >/dev/null

echo "[mieru-smoke] Export + subscription URL"
EXPORT_JSON=$(curl -fsS "${API_BASE_URL}/mieru/users/${CREATED_USERNAME}/export" -H "$AUTH_HEADER")
SUB_URL_JSON=$(curl -fsS "${API_BASE_URL}/mieru/users/${CREATED_USERNAME}/subscription-url" -H "$AUTH_HEADER")
printf '%s' "$EXPORT_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.clashYaml){throw new Error('export failed')} 'EXPORT_OK'" >/dev/null
printf '%s' "$SUB_URL_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.subscriptionUrl){throw new Error('subscription url failed')} 'SUB_URL_OK'" >/dev/null

echo "[mieru-smoke] Delete temp custom user"
DELETE_USER_JSON=$(curl -fsS -X DELETE "${API_BASE_URL}/mieru/users/${CREATED_USERNAME}" -H "$AUTH_HEADER")
printf '%s' "$DELETE_USER_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success){throw new Error('delete user failed')} 'DELETE_OK'" >/dev/null
CREATED_USERNAME=""

echo "[mieru-smoke] PASS"

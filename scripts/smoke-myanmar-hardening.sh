#!/bin/bash
set -euo pipefail

API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-${E2E_ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-${E2E_ADMIN_PASSWORD:-admin123}}"
PACK_SERVER_ADDRESS="${SMOKE_PACK_SERVER_ADDRESS:-127.0.0.1}"
PACK_SERVER_NAME="${SMOKE_PACK_SERVER_NAME:-$PACK_SERVER_ADDRESS}"
PACK_CDN_HOST="${SMOKE_PACK_CDN_HOST:-$PACK_SERVER_NAME}"
PACK_FALLBACK_PORTS="${SMOKE_PACK_FALLBACK_PORTS:-8443,9443}"

TOKEN=""
AUTH_HEADER=""
RUN_ID="$(date +%s)-$RANDOM"

BOOTSTRAP_INBOUND_ID=""
BOOTSTRAP_INBOUND_CREATED="0"
GROUP_ID=""
USER_ONE_ID=""
USER_TWO_ID=""
PACK_INBOUND_IDS_JSON="[]"

cleanup() {
  if [[ -n "$TOKEN" ]]; then
    if [[ -n "$USER_ONE_ID" ]]; then
      curl -fsS -X DELETE "${API_BASE_URL}/users/${USER_ONE_ID}" -H "$AUTH_HEADER" >/dev/null 2>&1 || true
    fi

    if [[ -n "$USER_TWO_ID" ]]; then
      curl -fsS -X DELETE "${API_BASE_URL}/users/${USER_TWO_ID}" -H "$AUTH_HEADER" >/dev/null 2>&1 || true
    fi

    if [[ -n "$GROUP_ID" ]]; then
      curl -fsS -X DELETE "${API_BASE_URL}/groups/${GROUP_ID}" -H "$AUTH_HEADER" >/dev/null 2>&1 || true
    fi

    if [[ "$PACK_INBOUND_IDS_JSON" != "[]" ]]; then
      while IFS= read -r inbound_id; do
        if [[ -n "$inbound_id" ]]; then
          curl -fsS -X DELETE "${API_BASE_URL}/inbounds/${inbound_id}" -H "$AUTH_HEADER" >/dev/null 2>&1 || true
        fi
      done < <(printf '%s' "$PACK_INBOUND_IDS_JSON" | node -pe "const fs=require('fs');const ids=JSON.parse(fs.readFileSync(0,'utf8')); ids.join('\\n')")
    fi

    if [[ "$BOOTSTRAP_INBOUND_CREATED" == "1" && -n "$BOOTSTRAP_INBOUND_ID" ]]; then
      curl -fsS -X DELETE "${API_BASE_URL}/inbounds/${BOOTSTRAP_INBOUND_ID}" -H "$AUTH_HEADER" >/dev/null 2>&1 || true
    fi
  fi
}

trap cleanup EXIT

echo "[myanmar-smoke] API base: ${API_BASE_URL}"
echo "[myanmar-smoke] Health endpoint"
curl -fsS "${API_BASE_URL}/system/health" >/dev/null

echo "[myanmar-smoke] Login"
LOGIN_JSON=$(curl -fsS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.token){throw new Error('login failed')} o.data.token")
AUTH_HEADER="Authorization: Bearer ${TOKEN}"

echo "[myanmar-smoke] Resolve bootstrap inbound"
FIRST_INBOUND_JSON=$(curl -fsS "${API_BASE_URL}/inbounds?page=1&limit=1" -H "$AUTH_HEADER")
BOOTSTRAP_INBOUND_ID=$(printf '%s' "$FIRST_INBOUND_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const first=o?.data?.[0]; first?.id ? String(first.id) : ''")

if [[ -z "$BOOTSTRAP_INBOUND_ID" ]]; then
  echo "[myanmar-smoke] No inbounds found, creating bootstrap inbound"
  RANDOM_PORT_JSON=$(curl -fsS "${API_BASE_URL}/inbounds/random-port?min=30000&max=45000" -H "$AUTH_HEADER")
  BOOTSTRAP_PORT=$(printf '%s' "$RANDOM_PORT_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const port=o?.data?.port; if(!o?.success || !Number.isInteger(port)){throw new Error('random port failed')} port")

  BOOTSTRAP_TAG="smoke-bootstrap-${RUN_ID}"
  CREATE_BOOTSTRAP_JSON=$(curl -fsS -X POST "${API_BASE_URL}/inbounds" \
    -H "$AUTH_HEADER" \
    -H 'Content-Type: application/json' \
    -d "{\"port\":${BOOTSTRAP_PORT},\"protocol\":\"VLESS\",\"tag\":\"${BOOTSTRAP_TAG}\",\"remark\":\"Smoke bootstrap inbound\",\"network\":\"WS\",\"security\":\"NONE\",\"serverAddress\":\"127.0.0.1\",\"wsPath\":\"/bootstrap\"}")

  BOOTSTRAP_INBOUND_ID=$(printf '%s' "$CREATE_BOOTSTRAP_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('bootstrap inbound creation failed')} id")
  BOOTSTRAP_INBOUND_CREATED="1"
fi

echo "[myanmar-smoke] Create temporary users"
USER_ONE_EMAIL="smoke-mm-u1-${RUN_ID}@example.com"
USER_TWO_EMAIL="smoke-mm-u2-${RUN_ID}@example.com"

CREATE_USER_ONE_JSON=$(curl -fsS -X POST "${API_BASE_URL}/users" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${USER_ONE_EMAIL}\",\"dataLimit\":1,\"expiryDays\":7,\"inboundIds\":[${BOOTSTRAP_INBOUND_ID}],\"note\":\"Myanmar smoke user 1\"}")
USER_ONE_ID=$(printf '%s' "$CREATE_USER_ONE_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('create user one failed')} id")

CREATE_USER_TWO_JSON=$(curl -fsS -X POST "${API_BASE_URL}/users" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${USER_TWO_EMAIL}\",\"dataLimit\":1,\"expiryDays\":7,\"inboundIds\":[${BOOTSTRAP_INBOUND_ID}],\"note\":\"Myanmar smoke user 2\"}")
USER_TWO_ID=$(printf '%s' "$CREATE_USER_TWO_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('create user two failed')} id")

CREATED_USER_IDS_JSON="[${USER_ONE_ID},${USER_TWO_ID}]"

echo "[myanmar-smoke] Create temporary group"
GROUP_NAME="smoke-mm-group-${RUN_ID}"
CREATE_GROUP_JSON=$(curl -fsS -X POST "${API_BASE_URL}/groups" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"${GROUP_NAME}\",\"remark\":\"Myanmar smoke group\",\"userIds\":[${USER_ONE_ID},${USER_TWO_ID}]}")
GROUP_ID=$(printf '%s' "$CREATE_GROUP_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('create group failed')} id")

echo "[myanmar-smoke] Myanmar pack dry-run"
PACK_PREVIEW_JSON=$(curl -fsS -X POST "${API_BASE_URL}/inbounds/presets/myanmar" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "{\"serverAddress\":\"${PACK_SERVER_ADDRESS}\",\"serverName\":\"${PACK_SERVER_NAME}\",\"cdnHost\":\"${PACK_CDN_HOST}\",\"fallbackPorts\":\"${PACK_FALLBACK_PORTS}\",\"dryRun\":true}")

printf '%s' "$PACK_PREVIEW_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success){throw new Error('dry-run failed')} const planned=o?.data?.planned||[]; if(!Array.isArray(planned) || planned.length!==3){throw new Error('expected 3 planned profiles in dry-run')} 'DRY_RUN_OK'" >/dev/null

echo "[myanmar-smoke] Apply Myanmar pack"
PACK_APPLY_JSON=$(curl -fsS -X POST "${API_BASE_URL}/inbounds/presets/myanmar" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "{\"serverAddress\":\"${PACK_SERVER_ADDRESS}\",\"serverName\":\"${PACK_SERVER_NAME}\",\"cdnHost\":\"${PACK_CDN_HOST}\",\"fallbackPorts\":\"${PACK_FALLBACK_PORTS}\",\"dryRun\":false}")

PACK_INBOUND_IDS_JSON=$(printf '%s' "$PACK_APPLY_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const created=o?.data?.created||[]; if(!o?.success || !Array.isArray(created) || created.length!==3){throw new Error('expected 3 created profiles')} const ids=created.map((row)=>Number(row?.id)).filter((id)=>Number.isInteger(id)&&id>0); if(ids.length!==3){throw new Error('invalid created profile IDs')} JSON.stringify(ids)")

echo "[myanmar-smoke] Assign pack to users (bulk assign endpoint)"
ASSIGN_USERS_PAYLOAD=$(node -e "const users=JSON.parse(process.argv[1]);const inbounds=JSON.parse(process.argv[2]);console.log(JSON.stringify({userIds:users,inboundIds:inbounds,mode:'merge'}));" "$CREATED_USER_IDS_JSON" "$PACK_INBOUND_IDS_JSON")
ASSIGN_USERS_JSON=$(curl -fsS -X POST "${API_BASE_URL}/users/bulk/assign-inbounds" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "$ASSIGN_USERS_PAYLOAD")
printf '%s' "$ASSIGN_USERS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success){throw new Error('bulk assign failed')} 'ASSIGN_USERS_OK'" >/dev/null

echo "[myanmar-smoke] Assign pack to group"
SET_GROUP_PAYLOAD=$(node -e "const inbounds=JSON.parse(process.argv[1]);console.log(JSON.stringify({inboundIds:inbounds}));" "$PACK_INBOUND_IDS_JSON")
SET_GROUP_JSON=$(curl -fsS -X PUT "${API_BASE_URL}/groups/${GROUP_ID}/inbounds" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "$SET_GROUP_PAYLOAD")
printf '%s' "$SET_GROUP_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success){throw new Error('group inbound assign failed')} 'ASSIGN_GROUP_OK'" >/dev/null

echo "[myanmar-smoke] Verify users received pack inbounds"
USER_ONE_DETAILS=$(curl -fsS "${API_BASE_URL}/users/${USER_ONE_ID}" -H "$AUTH_HEADER")
USER_TWO_DETAILS=$(curl -fsS "${API_BASE_URL}/users/${USER_TWO_ID}" -H "$AUTH_HEADER")
printf '%s' "$USER_ONE_DETAILS" | node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8'));const expected=new Set(JSON.parse(process.argv[1]));const actual=(o?.data?.inbounds||[]).map((r)=>Number(r?.inboundId)).filter((n)=>Number.isInteger(n));for(const id of expected){if(!actual.includes(id)){throw new Error('user one missing inbound '+id)}}" "$PACK_INBOUND_IDS_JSON"
printf '%s' "$USER_TWO_DETAILS" | node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8'));const expected=new Set(JSON.parse(process.argv[1]));const actual=(o?.data?.inbounds||[]).map((r)=>Number(r?.inboundId)).filter((n)=>Number.isInteger(n));for(const id of expected){if(!actual.includes(id)){throw new Error('user two missing inbound '+id)}}" "$PACK_INBOUND_IDS_JSON"

echo "[myanmar-smoke] Reorder inbound priority for user one"
REORDER_ASSIGNMENTS_JSON=$(node -e "const ids=JSON.parse(process.argv[1]);const reversed=[...ids].reverse();const assignments=reversed.map((id,idx)=>({inboundId:id,priority:(idx+1)*10,enabled:true}));console.log(JSON.stringify(assignments));" "$PACK_INBOUND_IDS_JSON")
REORDER_PAYLOAD=$(node -e "const assignments=JSON.parse(process.argv[1]);console.log(JSON.stringify({assignments}));" "$REORDER_ASSIGNMENTS_JSON")
REORDER_JSON=$(curl -fsS -X POST "${API_BASE_URL}/users/${USER_ONE_ID}/inbounds/reorder" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "$REORDER_PAYLOAD")
printf '%s' "$REORDER_JSON" | node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8'));const expected=JSON.parse(process.argv[1]);if(!o?.success){throw new Error('reorder failed')}const rows=o?.data||[];for(const row of expected){const found=rows.find((r)=>Number(r?.inboundId)===Number(row.inboundId));if(!found){throw new Error('missing reordered inbound '+row.inboundId)}if(Number(found.priority)!==Number(row.priority)){throw new Error('priority mismatch for inbound '+row.inboundId)}}" "$REORDER_ASSIGNMENTS_JSON"

echo "[myanmar-smoke] Verify per-profile quality counters surface"
SESSIONS_JSON=$(curl -fsS "${API_BASE_URL}/users/sessions?includeOffline=true&limit=500" -H "$AUTH_HEADER")
printf '%s' "$SESSIONS_JSON" | node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8'));if(!o?.success){throw new Error('sessions endpoint failed')}const sessions=o?.data?.sessions||[];const targetUsers=new Set(JSON.parse(process.argv[1]));const filtered=sessions.filter((s)=>targetUsers.has(Number(s?.userId)));if(filtered.length===0){throw new Error('no sessions found for test users')}for(const session of filtered){if(!session.quality || !Array.isArray(session.quality.byProfile)){throw new Error('missing quality.byProfile for user '+session.userId)}}" "$CREATED_USER_IDS_JSON"

echo "[myanmar-smoke] PASS"

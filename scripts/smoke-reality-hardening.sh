#!/bin/bash
set -euo pipefail

API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-${E2E_ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-${E2E_ADMIN_PASSWORD:-admin123}}"
REALITY_TEST_DEST="${SMOKE_REALITY_DEST:-www.microsoft.com:443}"

TOKEN=""
CREATED_USER_ID=""
CREATED_INBOUND_ID=""
CREATED_INBOUND_TAG=""

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

echo "[reality-smoke] API base: ${API_BASE_URL}"
echo "[reality-smoke] Health endpoint"
curl -fsS "${API_BASE_URL}/system/health" >/dev/null

echo "[reality-smoke] Login"
LOGIN_JSON=$(curl -fsS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(printf '%s' "$LOGIN_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.token){throw new Error('login failed')} o.data.token")
AUTH_HEADER="Authorization: Bearer ${TOKEN}"

echo "[reality-smoke] Get destinations catalog"
DEST_JSON=$(curl -fsS "${API_BASE_URL}/reality/destinations" -H "${AUTH_HEADER}")
printf '%s' "$DEST_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const list=o?.data?.destinations; if(!o?.success || !Array.isArray(list) || list.length===0){throw new Error('destinations failed')} 'DEST_OK'" >/dev/null

echo "[reality-smoke] Generate REALITY keys"
KEYS_JSON=$(curl -fsS -X POST "${API_BASE_URL}/reality/generate-keys" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d "{\"count\":3,\"serverName\":\"www.microsoft.com\"}")

REALITY_PUBLIC_KEY=$(printf '%s' "$KEYS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const d=o?.data; if(!o?.success || !d?.publicKey || !d?.privateKey || !Array.isArray(d?.shortIds) || d.shortIds.length===0){throw new Error('key generation failed')} d.publicKey")
REALITY_PRIVATE_KEY=$(printf '%s' "$KEYS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); o.data.privateKey")
REALITY_SHORT_ID=$(printf '%s' "$KEYS_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); o.data.shortIds[0]")

echo "[reality-smoke] Test valid destination"
TEST_VALID_JSON=$(curl -fsS -X POST "${API_BASE_URL}/reality/test-destination" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d "{\"dest\":\"${REALITY_TEST_DEST}\"}")
printf '%s' "$TEST_VALID_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.destination){throw new Error('destination test failed')} 'TEST_VALID_OK'" >/dev/null

echo "[reality-smoke] Test invalid destination (expect 400)"
HTTP_CODE=$(curl -sS -o /tmp/oneui-reality-invalid.json -w "%{http_code}" -X POST "${API_BASE_URL}/reality/test-destination" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d '{"dest":"bad host:abc"}')
if [[ "$HTTP_CODE" != "400" ]]; then
  echo "Expected 400 for invalid destination, got ${HTTP_CODE}"
  cat /tmp/oneui-reality-invalid.json
  exit 1
fi

RANDOM_PORT_JSON=$(curl -fsS "${API_BASE_URL}/inbounds/random-port?min=30000&max=45000" -H "${AUTH_HEADER}")
TEST_PORT=$(printf '%s' "$RANDOM_PORT_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const port=o?.data?.port; if(!o?.success || !Number.isInteger(port)){throw new Error('random port failed')} port")

RUN_ID="$(date +%s)-$RANDOM"
CREATED_INBOUND_TAG="smoke-reality-${RUN_ID}"
TEST_EMAIL="smoke-reality-${RUN_ID}@example.com"

echo "[reality-smoke] Create REALITY inbound"
CREATE_INBOUND_JSON=$(curl -fsS -X POST "${API_BASE_URL}/inbounds" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d "{
    \"port\": ${TEST_PORT},
    \"protocol\": \"VLESS\",
    \"tag\": \"${CREATED_INBOUND_TAG}\",
    \"remark\": \"Smoke REALITY inbound\",
    \"network\": \"TCP\",
    \"security\": \"REALITY\",
    \"serverAddress\": \"1.1.1.1\",
    \"serverName\": \"www.microsoft.com\",
    \"realityPublicKey\": \"${REALITY_PUBLIC_KEY}\",
    \"realityPrivateKey\": \"${REALITY_PRIVATE_KEY}\",
    \"realityShortIds\": [\"${REALITY_SHORT_ID}\"],
    \"realityServerNames\": [\"www.microsoft.com\"],
    \"realityFingerprint\": \"chrome\",
    \"realityDest\": \"www.microsoft.com:443\",
    \"realitySpiderX\": \"/\"
  }")

CREATED_INBOUND_ID=$(printf '%s' "$CREATE_INBOUND_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('create inbound failed')} id")

echo "[reality-smoke] Create user assigned to REALITY inbound"
CREATE_USER_JSON=$(curl -fsS -X POST "${API_BASE_URL}/users" \
  -H "${AUTH_HEADER}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"dataLimit\":1,\"expiryDays\":7,\"inboundIds\":[${CREATED_INBOUND_ID}],\"note\":\"Reality smoke\"}")
CREATED_USER_ID=$(printf '%s' "$CREATE_USER_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const id=o?.data?.id; if(!o?.success || !Number.isInteger(id)){throw new Error('create user failed')} id")

echo "[reality-smoke] Verify inbound fields persisted"
GET_INBOUND_JSON=$(curl -fsS "${API_BASE_URL}/inbounds/${CREATED_INBOUND_ID}" -H "${AUTH_HEADER}")
printf '%s' "$GET_INBOUND_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const d=o?.data; if(!o?.success || d?.realityDest!=='www.microsoft.com:443' || d?.realitySpiderX!=='/'){throw new Error('inbound reality fields mismatch')} 'INBOUND_REALITY_FIELDS_OK'" >/dev/null

echo "[reality-smoke] Verify Xray config includes REALITY dest/spiderX"
XRAY_JSON=$(curl -fsS "${API_BASE_URL}/xray/config" -H "${AUTH_HEADER}")
printf '%s' "$XRAY_JSON" | node -pe "const fs=require('fs');const o=JSON.parse(fs.readFileSync(0,'utf8')); const inbounds=o?.data?.inbounds||[]; const target=inbounds.find((row)=>row.tag===process.argv[1]); if(!target){throw new Error('xray config missing test inbound')} const rs=target?.streamSettings?.realitySettings||{}; if(rs.dest!=='www.microsoft.com:443' || rs.spiderX!=='/'){throw new Error('xray reality settings mismatch')} 'XRAY_REALITY_OK'" "${CREATED_INBOUND_TAG}" >/dev/null

echo "[reality-smoke] PASS"

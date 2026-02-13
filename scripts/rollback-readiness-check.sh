#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-${E2E_ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-${E2E_ADMIN_PASSWORD:-admin123}}"
REQUIRE_BACKUPS="${ROLLBACK_REQUIRE_BACKUPS:-true}"
REQUIRE_SNAPSHOTS="${ROLLBACK_REQUIRE_SNAPSHOTS:-false}"
QUIET=false

pass_count=0
warn_count=0
fail_count=0

usage() {
  cat <<'EOF'
Usage: ./scripts/rollback-readiness-check.sh [options]

Checks rollback readiness for One-UI/Xray update operations:
  - system health
  - update script availability
  - update policy + preflight readiness
  - rollback backup tags
  - config snapshots (optional strict mode)

Options:
  --allow-empty-backups     Do not fail when no rollback backup tags exist
  --require-snapshots       Fail if no config snapshots exist
  --quiet                   Minimal output
  -h, --help                Show this help

Environment:
  SMOKE_API_BASE_URL / E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD
  ROLLBACK_REQUIRE_BACKUPS (default: true)
  ROLLBACK_REQUIRE_SNAPSHOTS (default: false)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-empty-backups)
      REQUIRE_BACKUPS=false
      shift
      ;;
    --require-snapshots)
      REQUIRE_SNAPSHOTS=true
      shift
      ;;
    --quiet)
      QUIET=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

print() {
  if [[ "$QUIET" != "true" ]]; then
    echo "$@"
  fi
}

pass() {
  pass_count=$((pass_count + 1))
  print "[PASS] $1"
}

warn() {
  warn_count=$((warn_count + 1))
  print "[WARN] $1"
}

fail() {
  fail_count=$((fail_count + 1))
  print "[FAIL] $1"
}

api_get() {
  local path="$1"
  curl -fsS "${API_BASE_URL}${path}" -H "Authorization: Bearer ${TOKEN}"
}

print "[rollback-readiness] API base: ${API_BASE_URL}"

if [[ ! -x "$ROOT_DIR/scripts/update-xray-core.sh" ]]; then
  fail "scripts/update-xray-core.sh missing or not executable"
else
  pass "update-xray-core.sh is executable"
fi

if curl -fsS "${API_BASE_URL}/system/health" >/dev/null; then
  pass "system health endpoint reachable"
else
  fail "system health endpoint unreachable"
fi

LOGIN_JSON="$(curl -fsS -X POST "${API_BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}")"

TOKEN="$(printf '%s' "$LOGIN_JSON" | node -pe "const fs=require('fs'); const o=JSON.parse(fs.readFileSync(0,'utf8')); if(!o?.success || !o?.data?.token){throw new Error('login failed')} o.data.token")"
pass "admin login successful"

POLICY_JSON="$(api_get '/xray/update/policy')"
POLICY_SUMMARY="$(printf '%s' "$POLICY_JSON" | node -pe "const fs=require('fs'); const o=JSON.parse(fs.readFileSync(0,'utf8')); const d=o?.data||{}; const mode=d.mode||'docker'; const enabled=d.updatesEnabled!==false; const channel=d.defaultChannel||'stable'; [mode, enabled, channel].join('|')")"
UPDATE_MODE="$(printf '%s' "$POLICY_SUMMARY" | cut -d'|' -f1)"
UPDATES_ENABLED="$(printf '%s' "$POLICY_SUMMARY" | cut -d'|' -f2)"
DEFAULT_CHANNEL="$(printf '%s' "$POLICY_SUMMARY" | cut -d'|' -f3)"
pass "update policy loaded (mode=${UPDATE_MODE}, updatesEnabled=${UPDATES_ENABLED}, defaultChannel=${DEFAULT_CHANNEL})"

PREFLIGHT_JSON="$(api_get '/xray/update/preflight')"
PREFLIGHT_SUMMARY="$(printf '%s' "$PREFLIGHT_JSON" | node -pe "const fs=require('fs'); const o=JSON.parse(fs.readFileSync(0,'utf8')); const d=o?.data||{}; const ready=Boolean(d.ready); const blocking=(d.checks||[]).filter((c)=>!c.ok&&c.blocking).length; [ready, blocking].join('|')")"
PREFLIGHT_READY="$(printf '%s' "$PREFLIGHT_SUMMARY" | cut -d'|' -f1)"
BLOCKING_CHECKS="$(printf '%s' "$PREFLIGHT_SUMMARY" | cut -d'|' -f2)"
if [[ "$PREFLIGHT_READY" == "true" ]]; then
  pass "update preflight ready"
else
  fail "update preflight blocked (${BLOCKING_CHECKS} blocking checks)"
fi

BACKUPS_JSON="$(api_get '/xray/update/backups')"
BACKUP_COUNT="$(printf '%s' "$BACKUPS_JSON" | node -pe "const fs=require('fs'); const o=JSON.parse(fs.readFileSync(0,'utf8')); const arr=Array.isArray(o?.data)?o.data:[]; arr.length")"
if [[ "$REQUIRE_BACKUPS" == "true" && "$UPDATES_ENABLED" == "true" && "$UPDATE_MODE" != "manual" && "$BACKUP_COUNT" -lt 1 ]]; then
  fail "no rollback backup tags available"
elif [[ "$BACKUP_COUNT" -lt 1 ]]; then
  warn "no rollback backup tags available"
else
  pass "rollback backup tags available (${BACKUP_COUNT})"
fi

SNAPSHOTS_JSON="$(api_get '/xray/config/snapshots?limit=5')"
SNAPSHOT_COUNT="$(printf '%s' "$SNAPSHOTS_JSON" | node -pe "const fs=require('fs'); const o=JSON.parse(fs.readFileSync(0,'utf8')); const snaps=o?.data?.snapshots; Array.isArray(snaps)?snaps.length:0")"
if [[ "$REQUIRE_SNAPSHOTS" == "true" && "$SNAPSHOT_COUNT" -lt 1 ]]; then
  fail "no config snapshots found"
elif [[ "$SNAPSHOT_COUNT" -lt 1 ]]; then
  warn "no config snapshots found (recommended before rollout)"
else
  pass "config snapshots found (${SNAPSHOT_COUNT})"
fi

print
print "Summary: PASS=${pass_count} WARN=${warn_count} FAIL=${fail_count}"

if [[ "$fail_count" -gt 0 ]]; then
  exit 1
fi

exit 0


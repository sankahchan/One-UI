#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

BOOTSTRAP=false
TEARDOWN=false
QUIET=false
PREFLIGHT_RESET=false
LOG_DIR="$ROOT_DIR/.run/release-check"

# Default higher limiter caps to reduce false 429s during chained release checks.
export AUTH_RATE_LIMIT_MAX="${AUTH_RATE_LIMIT_MAX:-1000}"
export RATE_LIMIT_MAX_REQUESTS="${RATE_LIMIT_MAX_REQUESTS:-5000}"

usage() {
  cat <<'EOF'
Usage: ./scripts/release-check.sh [options]

Runs release gate checks in order:
  1) smoke-core-api.sh
  2) smoke-myanmar-hardening.sh
  3) api-budget-check.sh
  4) api-slo-check.sh
  5) rollback-readiness-check.sh

Options:
  --bootstrap    Start local stack with scripts/bootstrap-local.sh before checks
  --teardown     Stop local stack with scripts/dev-down.sh after checks
  --preflight-reset
                 Reset backend process (clears in-memory rate-limit state) before checks
  --quiet        Minimize console output and store step logs in .run/release-check/
  -h, --help     Show this help

Environment:
  BASE_URL / SMOKE_API_BASE_URL controls backend target (default: http://127.0.0.1:3000)
  E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD for auth checks
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bootstrap)
      BOOTSTRAP=true
      shift
      ;;
    --teardown)
      TEARDOWN=true
      shift
      ;;
    --quiet)
      QUIET=true
      shift
      ;;
    --preflight-reset)
      PREFLIGHT_RESET=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

declare -a STEP_NAMES=(
  "Core API smoke"
  "Myanmar hardening smoke"
  "API budget checks"
  "API SLO checks"
  "Rollback readiness"
)
declare -a STEP_CMDS=(
  "$ROOT_DIR/scripts/smoke-core-api.sh"
  "$ROOT_DIR/scripts/smoke-myanmar-hardening.sh"
  "$ROOT_DIR/scripts/api-budget-check.sh"
  "$ROOT_DIR/scripts/api-slo-check.sh"
  "$ROOT_DIR/scripts/rollback-readiness-check.sh"
)
declare -a STEP_STATUS=()
declare -a STEP_SECONDS=()
declare -a STEP_CODES=()

cleanup() {
  if [[ "$TEARDOWN" == "true" ]]; then
    echo
    echo "[release-check] Tearing down local stack..."
    bash "$ROOT_DIR/scripts/dev-down.sh" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for script_path in "${STEP_CMDS[@]}"; do
  if [[ ! -x "$script_path" ]]; then
    chmod +x "$script_path"
  fi
done

if [[ "$BOOTSTRAP" == "true" ]]; then
  echo "[release-check] Bootstrapping local stack..."
  if ! bash "$ROOT_DIR/scripts/bootstrap-local.sh"; then
    echo "[release-check] Bootstrap failed."
    exit 1
  fi
elif [[ "$PREFLIGHT_RESET" == "true" ]]; then
  echo "[release-check] Running preflight reset..."
  if ! bash "$ROOT_DIR/scripts/release-preflight-reset.sh"; then
    echo "[release-check] Preflight reset failed."
    exit 1
  fi
fi

if [[ "$QUIET" == "true" ]]; then
  mkdir -p "$LOG_DIR"
  rm -f "$LOG_DIR"/*.log 2>/dev/null || true
fi

echo "[release-check] Running release checks..."
echo

failures=0

for i in "${!STEP_NAMES[@]}"; do
  name="${STEP_NAMES[$i]}"
  cmd="${STEP_CMDS[$i]}"
  start_ts="$(date +%s)"
  rc=0

  echo "==> ${name}"
  if [[ "$QUIET" == "true" ]]; then
    log_file="$LOG_DIR/step-$((i + 1)).log"
    if bash "$cmd" >"$log_file" 2>&1; then
      status="PASS"
      code=0
    else
      rc=$?
      status="FAIL"
      code="$rc"
      failures=$((failures + 1))
      echo "    failed with exit ${code}; tail of ${log_file}:"
      tail -n 40 "$log_file" || true
    fi
  elif bash "$cmd"; then
    status="PASS"
    code=0
  else
    rc=$?
    status="FAIL"
    code="$rc"
    failures=$((failures + 1))
  fi

  end_ts="$(date +%s)"
  elapsed=$((end_ts - start_ts))

  STEP_STATUS+=("$status")
  STEP_SECONDS+=("$elapsed")
  STEP_CODES+=("$code")
  echo
done

echo "=============================================="
echo " Release Checklist Summary"
echo "=============================================="
printf "%-28s %-6s %-7s %s\n" "Check" "State" "Time" "Exit"
printf "%-28s %-6s %-7s %s\n" "----------------------------" "------" "-------" "----"

for i in "${!STEP_NAMES[@]}"; do
  printf "%-28s %-6s %4ss   %s\n" "${STEP_NAMES[$i]}" "${STEP_STATUS[$i]}" "${STEP_SECONDS[$i]}" "${STEP_CODES[$i]}"
done

echo "----------------------------------------------"
if [[ "$failures" -gt 0 ]]; then
  echo "[release-check] FAIL (${failures} check(s) failed)"
  exit 1
fi

echo "[release-check] PASS (all checks passed)"

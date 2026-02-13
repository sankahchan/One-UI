#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATE_SCRIPT="$ROOT_DIR/scripts/update-xray-core.sh"
SMOKE_CORE_SCRIPT="$ROOT_DIR/scripts/smoke-core-api.sh"
SMOKE_MYANMAR_SCRIPT="$ROOT_DIR/scripts/smoke-myanmar-hardening.sh"
RELEASE_CHECK_SCRIPT="$ROOT_DIR/scripts/release-check.sh"
VERIFY_SCRIPT="$ROOT_DIR/scripts/verify.sh"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
CONTAINER_NAME="${CONTAINER_NAME:-xray-core}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

print_header() {
  echo
  echo "=================================="
  echo " One-UI Operations Menu"
  echo "=================================="
}

show_xray_status() {
  if ! docker ps --format '{{.Names}}' | grep -Fx "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "xray container '$CONTAINER_NAME' is not running."
    return
  fi

  echo "Container: $CONTAINER_NAME"
  docker exec "$CONTAINER_NAME" xray version 2>/dev/null | head -n 1 || echo "Unable to read Xray version"
}

run_update() {
  local channel="$1"
  echo
  echo "Running Xray update channel: $channel (with canary preflight)"
  "$UPDATE_SCRIPT" "--$channel" --canary
}

run_smoke_suite() {
  echo
  echo "Running One-UI smoke suite (core + Myanmar hardening)..."

  if [[ ! -x "$SMOKE_CORE_SCRIPT" ]]; then
    chmod +x "$SMOKE_CORE_SCRIPT"
  fi
  if [[ ! -x "$SMOKE_MYANMAR_SCRIPT" ]]; then
    chmod +x "$SMOKE_MYANMAR_SCRIPT"
  fi

  "$SMOKE_CORE_SCRIPT"
  "$SMOKE_MYANMAR_SCRIPT"
  echo "Smoke suite passed."
}

run_release_check() {
  echo
  echo "Running release checklist (with preflight reset + rollback readiness + quiet logs)..."

  if [[ ! -x "$RELEASE_CHECK_SCRIPT" ]]; then
    chmod +x "$RELEASE_CHECK_SCRIPT"
  fi

  "$RELEASE_CHECK_SCRIPT" --preflight-reset --quiet
}

run_verify_quick() {
  echo
  echo "Running verify quick gate (backend check + frontend lint/build)..."

  if [[ ! -x "$VERIFY_SCRIPT" ]]; then
    chmod +x "$VERIFY_SCRIPT"
  fi

  (
    cd "$ROOT_DIR"
    npm run verify:quick
  )
}

run_predeploy_gate() {
  echo
  echo "Running pre-deploy gate: verify + release checklist..."

  if [[ ! -x "$VERIFY_SCRIPT" ]]; then
    chmod +x "$VERIFY_SCRIPT"
  fi
  if [[ ! -x "$RELEASE_CHECK_SCRIPT" ]]; then
    chmod +x "$RELEASE_CHECK_SCRIPT"
  fi

  (
    cd "$ROOT_DIR"
    npm run verify
  )

  "$RELEASE_CHECK_SCRIPT" --preflight-reset --quiet
}

require_cmd docker
require_cmd npm
if [[ ! -x "$UPDATE_SCRIPT" ]]; then
  chmod +x "$UPDATE_SCRIPT"
fi

while true; do
  print_header
  echo "1) Update Xray (stable channel)"
  echo "2) Update Xray (latest channel)"
  echo "3) Rollback Xray (latest backup)"
  echo "4) List rollback backup tags"
  echo "5) Show Xray version/status"
  echo "6) Show last 100 xray logs"
  echo "7) Run smoke suite (core + Myanmar hardening)"
  echo "8) Run verify quick gate"
  echo "9) Run release checklist"
  echo "10) Run pre-deploy gate (verify + release checklist)"
  echo "11) Exit"
  echo
  read -r -p "Select option [1-11]: " choice

  case "$choice" in
    1)
      run_update "stable"
      ;;
    2)
      run_update "latest"
      ;;
    3)
      "$UPDATE_SCRIPT" --rollback
      ;;
    4)
      "$UPDATE_SCRIPT" --list-backups
      ;;
    5)
      show_xray_status
      ;;
    6)
      if command -v docker >/dev/null 2>&1; then
        docker compose -f "$COMPOSE_FILE" logs --tail=100 xray || docker-compose -f "$COMPOSE_FILE" logs --tail=100 xray
      fi
      ;;
    7)
      run_smoke_suite
      ;;
    8)
      run_verify_quick
      ;;
    9)
      run_release_check
      ;;
    10)
      run_predeploy_gate
      ;;
    11)
      echo "Bye."
      exit 0
      ;;
    *)
      echo "Invalid choice."
      ;;
  esac

  echo
  read -r -p "Press Enter to continue..." _
done

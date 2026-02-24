#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ONEUI_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-one-ui-backend}"
DB_CONTAINER="${DB_CONTAINER:-one-ui-db}"
XRAY_CONTAINER="${XRAY_CONTAINER:-xray-core}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"
PUBLIC_IP_INPUT="${1:-}"

red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
cyan() { printf '\033[0;36m%s\033[0m\n' "$*"; }

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return
  fi
  red "[error] Docker Compose is not available."
  exit 1
}

compose() {
  if [[ -f "$COMPOSE_FILE" ]]; then
    "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" "$@"
  else
    "${COMPOSE_CMD[@]}" "$@"
  fi
}

read_panel_port() {
  if [[ -n "${PANEL_PORT:-}" ]]; then
    printf '%s\n' "$PANEL_PORT"
    return
  fi
  if [[ -f "$ROOT_DIR/.panel_port" ]]; then
    cat "$ROOT_DIR/.panel_port"
    return
  fi
  if [[ -f "$ROOT_DIR/backend/.env" ]]; then
    local env_port
    env_port="$(grep -E '^PORT=' "$ROOT_DIR/backend/.env" | tail -n1 | cut -d= -f2)"
    if [[ -n "$env_port" ]]; then
      printf '%s\n' "$env_port"
      return
    fi
  fi
  printf '3000\n'
}

resolve_public_ip() {
  if [[ -n "$PUBLIC_IP_INPUT" ]]; then
    printf '%s\n' "$PUBLIC_IP_INPUT"
    return
  fi

  local ip
  ip="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s\n' "$ip"
}

wait_backend_health() {
  local panel_port="$1"
  local attempts="$2"
  local url="http://127.0.0.1:${panel_port}/api/system/health"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 4 "$url" >/dev/null 2>&1; then
      green "PASS: backend health endpoint is reachable (${url})"
      return 0
    fi
    sleep 1
  done

  red "FAIL: backend health endpoint did not become ready (${url})"
  return 1
}

check_container_running() {
  local name="$1"
  local label="$2"
  local running

  running="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)"
  if [[ "$running" == "true" ]]; then
    green "PASS: ${label} container is running (${name})"
    return 0
  fi

  red "FAIL: ${label} container is not running (${name})"
  return 1
}

xray_version_check() {
  local version_line
  version_line="$(docker exec "$XRAY_CONTAINER" xray version 2>/dev/null | head -n1 || true)"
  if [[ "$version_line" == Xray* ]]; then
    green "PASS: ${version_line}"
    return 0
  fi

  red "FAIL: could not read xray version from ${XRAY_CONTAINER}"
  return 1
}

xray_config_check() {
  if docker exec "$XRAY_CONTAINER" xray -test -config /etc/xray/config.json >/dev/null 2>&1; then
    green "PASS: xray config test succeeded"
    return 0
  fi

  red "FAIL: xray config test failed"
  return 1
}

inbound_count() {
  local config_file="$ROOT_DIR/xray/config.json"
  if [[ -f "$config_file" ]] && command -v jq >/dev/null 2>&1; then
    jq -r '(.inbounds // []) | length' "$config_file" 2>/dev/null || echo 0
    return
  fi

  docker exec "$XRAY_CONTAINER" sh -lc 'cat /etc/xray/config.json' 2>/dev/null \
    | jq -r '(.inbounds // []) | length' 2>/dev/null || echo 0
}

subscription_probe() {
  local panel_port="$1"
  local token

  token="$(docker exec "$DB_CONTAINER" psql -U postgres -d xray_panel -t -A -c \
    "select \"subscriptionToken\" from users where status='ACTIVE' order by id desc limit 1;" 2>/dev/null || true)"

  if [[ -z "$token" ]]; then
    yellow "WARN: no active user token found; skipping subscription probe"
    return 0
  fi

  if curl -fsS --max-time 8 "http://127.0.0.1:${panel_port}/sub/${token}?target=v2ray" >/dev/null 2>&1; then
    green "PASS: subscription endpoint responds for active user"
    return 0
  fi

  red "FAIL: subscription endpoint probe failed"
  return 1
}

main() {
  local failures=0
  local panel_port
  local public_ip
  local safe_wait_seconds
  local probe_attempts

  resolve_compose_cmd

  if [[ ! -d "$ROOT_DIR" ]]; then
    red "[error] Root directory not found: $ROOT_DIR"
    exit 1
  fi

  cd "$ROOT_DIR"
  panel_port="$(read_panel_port)"
  public_ip="$(resolve_public_ip)"
  safe_wait_seconds="$(printf '%s\n' "$WAIT_SECONDS" | awk '{ if ($1 ~ /^[0-9]+$/) print $1; else print 90 }')"
  probe_attempts="$safe_wait_seconds"

  cyan "=== One-UI post-update verification ==="
  echo "Root:        $ROOT_DIR"
  echo "Compose file:${COMPOSE_FILE}"
  echo "Panel port:  $panel_port"
  echo "Public IP:   ${public_ip:-unknown}"
  echo

  if ! compose ps >/dev/null 2>&1; then
    red "FAIL: docker compose is not healthy for this stack"
    exit 1
  fi

  check_container_running "$BACKEND_CONTAINER" "backend" || failures=$((failures + 1))
  check_container_running "$DB_CONTAINER" "database" || failures=$((failures + 1))
  check_container_running "$XRAY_CONTAINER" "xray" || failures=$((failures + 1))
  wait_backend_health "$panel_port" "$probe_attempts" || failures=$((failures + 1))
  xray_version_check || failures=$((failures + 1))
  xray_config_check || failures=$((failures + 1))
  subscription_probe "$panel_port" || failures=$((failures + 1))

  local inbound_total
  inbound_total="$(inbound_count)"
  if [[ "${inbound_total:-0}" =~ ^[0-9]+$ ]] && [[ "${inbound_total}" -gt 0 ]]; then
    if [[ -x "$ROOT_DIR/scripts/check-connectivity.sh" ]]; then
      if "$ROOT_DIR/scripts/check-connectivity.sh" "${public_ip:-}" >/dev/null; then
        green "PASS: connectivity matrix check passed"
      else
        red "FAIL: connectivity matrix check failed"
        failures=$((failures + 1))
      fi
    else
      yellow "WARN: scripts/check-connectivity.sh missing or not executable; skipping connectivity matrix"
    fi
  else
    yellow "WARN: no inbounds found; skipping connectivity matrix check"
  fi

  echo
  cyan "--- Summary ---"
  if [[ "$failures" -eq 0 ]]; then
    green "PASS: post-update verification completed successfully."
    exit 0
  fi

  red "FAIL: post-update verification found ${failures} issue(s)."
  echo "Run detailed checks:"
  echo "  cd $ROOT_DIR"
  echo "  docker compose ps"
  echo "  docker compose logs --tail=120 backend xray"
  echo "  scripts/check-connectivity.sh ${public_ip:-}"
  exit 1
}

main "$@"

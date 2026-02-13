#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BASE_URL="${BASE_URL:-${SMOKE_API_BASE_URL:-http://127.0.0.1:3000}}"
SCREEN_BACKEND_NAME="${SCREEN_BACKEND_NAME:-oneui_backend}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-90}"

COMPOSE_CMD=()

detect_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose -f "$COMPOSE_FILE")
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose -f "$COMPOSE_FILE")
    return 0
  fi

  return 1
}

wait_for_backend() {
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  local health_url="${BASE_URL%/}/api/system/health"

  until curl -fsS --max-time 3 "$health_url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "[preflight-reset] Timed out waiting for backend: $health_url"
      return 1
    fi
    sleep 1
  done

  echo "[preflight-reset] Backend is healthy: $health_url"
}

is_compose_backend_running() {
  if [[ ${#COMPOSE_CMD[@]} -eq 0 ]]; then
    return 1
  fi

  "${COMPOSE_CMD[@]}" ps --services --filter status=running 2>/dev/null | grep -Fx "backend" >/dev/null 2>&1
}

read_database_url() {
  if [[ -n "${DATABASE_URL_LOCAL:-}" ]]; then
    echo "$DATABASE_URL_LOCAL"
    return
  fi

  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "$DATABASE_URL"
    return
  fi

  if [[ -f "$BACKEND_DIR/.env" ]]; then
    local env_url
    env_url="$(grep -E '^DATABASE_URL=' "$BACKEND_DIR/.env" | head -n 1 | cut -d '=' -f2- || true)"
    env_url="${env_url%\"}"
    env_url="${env_url#\"}"
    env_url="${env_url%\'}"
    env_url="${env_url#\'}"
    if [[ -n "$env_url" ]]; then
      echo "$env_url"
      return
    fi
  fi

  echo "postgresql://postgres:changeme@127.0.0.1:5432/xray_panel"
}

stop_local_backend() {
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    local marker
    marker="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if [[ "$marker" == screen:* ]]; then
      local session_name="${marker#screen:}"
      screen -S "$session_name" -X quit >/dev/null 2>&1 || true
    elif [[ -n "$marker" ]] && kill -0 "$marker" >/dev/null 2>&1; then
      kill "$marker" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$BACKEND_PID_FILE"
  fi

  screen -S "$SCREEN_BACKEND_NAME" -X quit >/dev/null 2>&1 || true

  if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill -TERM >/dev/null 2>&1 || true
    sleep 1
  fi

  if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill -KILL >/dev/null 2>&1 || true
  fi
}

start_local_backend() {
  local database_url
  database_url="$(read_database_url)"

  mkdir -p "$RUN_DIR"
  : > "$RUN_DIR/backend.log"

  if command -v screen >/dev/null 2>&1; then
    screen -S "$SCREEN_BACKEND_NAME" -X quit >/dev/null 2>&1 || true
    screen -dmS "$SCREEN_BACKEND_NAME" bash -lc \
      "cd \"$BACKEND_DIR\" && exec env DATABASE_URL=\"$database_url\" TELEGRAM_ENABLED=false JOBS_ENABLED=false BACKUP_ENABLED=false node src/index.js >> \"$RUN_DIR/backend.log\" 2>&1"
    echo "screen:$SCREEN_BACKEND_NAME" > "$BACKEND_PID_FILE"
  else
    (
      cd "$BACKEND_DIR"
      nohup env \
        DATABASE_URL="$database_url" \
        TELEGRAM_ENABLED=false \
        JOBS_ENABLED=false \
        BACKUP_ENABLED=false \
        node src/index.js > "$RUN_DIR/backend.log" 2>&1 < /dev/null &
      echo $! > "$BACKEND_PID_FILE"
    )
  fi
}

main() {
  echo "[preflight-reset] Clearing local rate-limit state..."

  detect_compose_cmd || true
  if is_compose_backend_running; then
    echo "[preflight-reset] Restarting compose backend service..."
    "${COMPOSE_CMD[@]}" restart backend >/dev/null
    wait_for_backend
    echo "[preflight-reset] Compose backend reset completed."
    return 0
  fi

  local backend_running=false
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    backend_running=true
  elif lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    backend_running=true
  fi

  if [[ "$backend_running" == "true" ]]; then
    echo "[preflight-reset] Restarting local backend process..."
    stop_local_backend
    start_local_backend
    wait_for_backend
    echo "[preflight-reset] Local backend reset completed."
    return 0
  fi

  echo "[preflight-reset] No running backend detected. Bootstrapping local stack..."
  bash "$ROOT_DIR/scripts/bootstrap-local.sh" --skip-seed
  wait_for_backend
  echo "[preflight-reset] Bootstrap reset completed."
}

main "$@"

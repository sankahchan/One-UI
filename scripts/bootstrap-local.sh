#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUN_DIR="$ROOT_DIR/.run"
USE_SCREEN_MODE="${USE_SCREEN:-auto}"
SCREEN_BACKEND_NAME="${SCREEN_BACKEND_NAME:-oneui_backend}"
SCREEN_FRONTEND_NAME="${SCREEN_FRONTEND_NAME:-oneui_frontend}"

PREPARE_ONLY=false
SKIP_SEED=false
STARTUP_MAX_ATTEMPTS="${STARTUP_MAX_ATTEMPTS:-2}"
BACKEND_READY_TIMEOUT_SECONDS="${BACKEND_READY_TIMEOUT_SECONDS:-90}"
FRONTEND_READY_TIMEOUT_SECONDS="${FRONTEND_READY_TIMEOUT_SECONDS:-90}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prepare-only)
      PREPARE_ONLY=true
      shift
      ;;
    --skip-seed)
      SKIP_SEED=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--prepare-only] [--skip-seed]"
      exit 1
      ;;
  esac
done

COMPOSE_CMD=()
USE_DOCKER_DB=true

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose -f "$ROOT_DIR/docker-compose.yml")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose -f "$ROOT_DIR/docker-compose.yml")
else
  USE_DOCKER_DB=false
fi

if [[ "${SKIP_DOCKER_DB:-0}" == "1" ]]; then
  USE_DOCKER_DB=false
fi

read_env_database_url() {
  if [[ -f "$BACKEND_DIR/.env" ]]; then
    local envUrl
    envUrl="$(grep -E '^DATABASE_URL=' "$BACKEND_DIR/.env" | head -n 1 | cut -d '=' -f2- || true)"
    envUrl="${envUrl%\"}"
    envUrl="${envUrl#\"}"
    envUrl="${envUrl%\'}"
    envUrl="${envUrl#\'}"
    if [[ -n "$envUrl" ]]; then
      echo "$envUrl"
      return
    fi
  fi

  echo ""
}

DB_PASSWORD="${DB_PASSWORD:-changeme}"
DATABASE_URL_LOCAL="${DATABASE_URL_LOCAL:-}"

mkdir -p "$RUN_DIR"

should_use_screen() {
  if [[ "$USE_SCREEN_MODE" == "auto" ]]; then
    if [[ ! -t 1 ]]; then
      return 1
    fi
    command -v screen >/dev/null 2>&1
    return $?
  fi

  if [[ "$USE_SCREEN_MODE" == "1" || "$USE_SCREEN_MODE" == "true" ]]; then
    command -v screen >/dev/null 2>&1
    return $?
  fi

  if [[ "$USE_SCREEN_MODE" == "0" || "$USE_SCREEN_MODE" == "false" ]]; then
    return 1
  fi
  return 1
}

wait_for_screen_session() {
  local session_name="$1"
  local timeout_seconds="${2:-4}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if screen -ls 2>/dev/null | grep -E "[[:digit:]]+\\.${session_name}[[:space:]]" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  return 1
}

ensure_env_file() {
  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    echo "Created backend/.env from .env.example"
  fi

  if [[ -z "$DATABASE_URL_LOCAL" ]]; then
    if [[ "$USE_DOCKER_DB" == "true" ]]; then
      DATABASE_URL_LOCAL="postgresql://postgres:${DB_PASSWORD}@127.0.0.1:5432/xray_panel"
    else
      DATABASE_URL_LOCAL="$(read_env_database_url)"
      if [[ -z "$DATABASE_URL_LOCAL" ]]; then
        DATABASE_URL_LOCAL="postgresql://postgres:changeme@127.0.0.1:5432/xray_panel"
      fi
    fi
  fi
}

ensure_dependencies() {
  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    echo "Installing backend dependencies..."
    (cd "$BACKEND_DIR" && npm install)
  fi

  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
  fi
}

start_database() {
  if [[ "$USE_DOCKER_DB" != "true" ]]; then
    echo "Docker Compose not available or disabled; using DATABASE_URL from backend/.env."
    return
  fi

  echo "Starting Postgres container..."
  "${COMPOSE_CMD[@]}" up -d db >/dev/null

  echo "Waiting for Postgres to become healthy..."
  local attempt=0
  until "${COMPOSE_CMD[@]}" exec -T db pg_isready -U postgres -d xray_panel >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge 60 ]]; then
      echo "Postgres did not become ready in time."
      exit 1
    fi
    sleep 1
  done

  echo "Postgres is ready."
}

prepare_database_schema() {
  echo "Preparing Prisma client and database schema..."
  (
    cd "$BACKEND_DIR"
    DATABASE_URL="$DATABASE_URL_LOCAL" npm run prisma:generate >/dev/null
    DATABASE_URL="$DATABASE_URL_LOCAL" npm run prisma:deploy >/dev/null
    if [[ "$SKIP_SEED" == "false" ]]; then
      DATABASE_URL="$DATABASE_URL_LOCAL" npm run prisma:seed >/dev/null
    fi
  )
  echo "Database schema ready."
}

stop_stale_ports() {
  kill_listeners() {
    local port="$1"
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -z "$pids" ]]; then
      return
    fi

    echo "$pids" | xargs kill -TERM >/dev/null 2>&1 || true
    sleep 1

    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      echo "$pids" | xargs kill -KILL >/dev/null 2>&1 || true
    fi
  }

  wait_port_free() {
    local port="$1"
    local timeout_seconds="${2:-10}"
    local deadline=$((SECONDS + timeout_seconds))
    while lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
      if (( SECONDS >= deadline )); then
        echo "Port ${port} is still in use after waiting ${timeout_seconds}s."
        return 1
      fi
      sleep 1
    done
    return 0
  }

  screen -S "$SCREEN_BACKEND_NAME" -X quit >/dev/null 2>&1 || true
  screen -S "$SCREEN_FRONTEND_NAME" -X quit >/dev/null 2>&1 || true

  kill_listeners 3000
  kill_listeners 5173

  wait_port_free 3000 12 || true
  wait_port_free 5173 12 || true
}

is_runtime_alive() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local marker
  marker="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$marker" ]]; then
    return 1
  fi

  if [[ "$marker" == screen:* ]]; then
    local session_name="${marker#screen:}"
    screen -ls 2>/dev/null | grep -E "[[:digit:]]+\.${session_name}[[:space:]]" >/dev/null 2>&1
    return $?
  fi

  kill -0 "$marker" >/dev/null 2>&1
}

wait_for_http_ready() {
  local label="$1"
  local url="$2"
  local timeout_seconds="$3"
  local pid_file="$4"

  local deadline=$((SECONDS + timeout_seconds))

  until curl -fsS --max-time 2 "$url" >/dev/null 2>&1; do
    if ! is_runtime_alive "$pid_file"; then
      echo "${label} process exited before ${url} became ready."
      return 1
    fi

    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for ${label} readiness: ${url}"
      return 1
    fi

    sleep 1
  done

  echo "${label} ready: ${url}"
}

print_failure_diagnostics() {
  echo "----- Backend log tail -----"
  tail -n 80 "$RUN_DIR/backend.log" 2>/dev/null || true
  echo "----- Frontend log tail -----"
  tail -n 80 "$RUN_DIR/frontend.log" 2>/dev/null || true
}

start_backend() {
  : > "$RUN_DIR/backend.log"

  if should_use_screen; then
    screen -S "$SCREEN_BACKEND_NAME" -X quit >/dev/null 2>&1 || true
    screen -dmS "$SCREEN_BACKEND_NAME" bash -lc "cd \"$BACKEND_DIR\" && exec env DATABASE_URL=\"$DATABASE_URL_LOCAL\" TELEGRAM_ENABLED=false JOBS_ENABLED=false BACKUP_ENABLED=false node src/index.js >> \"$RUN_DIR/backend.log\" 2>&1"
    echo "screen:$SCREEN_BACKEND_NAME" > "$RUN_DIR/backend.pid"
    wait_for_screen_session "$SCREEN_BACKEND_NAME" 4 || true
  else
    (
      cd "$BACKEND_DIR"
      nohup env \
        DATABASE_URL="$DATABASE_URL_LOCAL" \
        TELEGRAM_ENABLED=false \
        JOBS_ENABLED=false \
        BACKUP_ENABLED=false \
        node src/index.js > "$RUN_DIR/backend.log" 2>&1 < /dev/null &
      echo $! > "$RUN_DIR/backend.pid"
    )
  fi
}

start_frontend() {
  : > "$RUN_DIR/frontend.log"

  if should_use_screen; then
    screen -S "$SCREEN_FRONTEND_NAME" -X quit >/dev/null 2>&1 || true
    screen -dmS "$SCREEN_FRONTEND_NAME" bash -lc "cd \"$FRONTEND_DIR\" && exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort >> \"$RUN_DIR/frontend.log\" 2>&1"
    echo "screen:$SCREEN_FRONTEND_NAME" > "$RUN_DIR/frontend.pid"
    wait_for_screen_session "$SCREEN_FRONTEND_NAME" 4 || true
  else
    (
      cd "$FRONTEND_DIR"
      nohup npm run dev -- --host 127.0.0.1 --port 5173 --strictPort > "$RUN_DIR/frontend.log" 2>&1 < /dev/null &
      echo $! > "$RUN_DIR/frontend.pid"
    )
  fi
}

start_runtime_with_retries() {
  local attempt=1
  while (( attempt <= STARTUP_MAX_ATTEMPTS )); do
    echo "Starting runtime services (attempt ${attempt}/${STARTUP_MAX_ATTEMPTS})..."
    stop_stale_ports
    start_backend
    start_frontend

    if wait_for_http_ready "Backend" "http://127.0.0.1:3000/api/system/health" "$BACKEND_READY_TIMEOUT_SECONDS" "$RUN_DIR/backend.pid" \
      && wait_for_http_ready "Frontend" "http://127.0.0.1:5173" "$FRONTEND_READY_TIMEOUT_SECONDS" "$RUN_DIR/frontend.pid"; then
      return 0
    fi

    echo "Runtime startup attempt ${attempt} failed."
    print_failure_diagnostics
    attempt=$((attempt + 1))
    sleep 2
  done

  return 1
}

print_runtime_info() {
  sleep 2

  echo "Backend listener:"
  lsof -nP -iTCP:3000 -sTCP:LISTEN || true

  echo "Frontend listener:"
  lsof -nP -iTCP:5173 -sTCP:LISTEN || true

  if should_use_screen; then
    echo "Screen sessions:"
    screen -ls | grep -E "$SCREEN_BACKEND_NAME|$SCREEN_FRONTEND_NAME" || true
  fi

  echo "Health:"
  curl -s http://127.0.0.1:3000/api/system/health || true
  echo

  echo "Frontend URL: http://127.0.0.1:5173"
  echo "Default admin: admin / admin123"
  echo "Logs:"
  echo "  tail -f $RUN_DIR/backend.log"
  echo "  tail -f $RUN_DIR/frontend.log"
}

ensure_env_file
ensure_dependencies
start_database
prepare_database_schema

if [[ "$PREPARE_ONLY" == "true" ]]; then
  echo "Preparation completed."
  exit 0
fi

if ! start_runtime_with_retries; then
  echo "Unable to start local stack after ${STARTUP_MAX_ATTEMPTS} attempt(s)."
  exit 1
fi

print_runtime_info

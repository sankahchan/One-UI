#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STOP_DB=false
SCREEN_BACKEND_NAME="${SCREEN_BACKEND_NAME:-oneui_backend}"
SCREEN_FRONTEND_NAME="${SCREEN_FRONTEND_NAME:-oneui_frontend}"

if [[ "${1:-}" == "--with-db" ]]; then
  STOP_DB=true
fi

for pidfile in "$ROOT_DIR/.run/backend.pid" "$ROOT_DIR/.run/frontend.pid"; do
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    if [[ "${pid:-}" == screen:* ]]; then
      session_name="${pid#screen:}"
      screen -S "$session_name" -X quit >/dev/null 2>&1 || true
    elif [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" || true
    fi
    rm -f "$pidfile"
  fi
done

screen -S "$SCREEN_BACKEND_NAME" -X quit >/dev/null 2>&1 || true
screen -S "$SCREEN_FRONTEND_NAME" -X quit >/dev/null 2>&1 || true

if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill || true
fi
if lsof -tiTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -tiTCP:5173 -sTCP:LISTEN | xargs kill || true
fi

suffix=""
if [[ "$STOP_DB" == "true" ]]; then
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$ROOT_DIR/docker-compose.yml" stop db >/dev/null || true
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$ROOT_DIR/docker-compose.yml" stop db >/dev/null || true
  fi
  suffix=" and db container"
fi

echo "Stopped local dev services${suffix}."

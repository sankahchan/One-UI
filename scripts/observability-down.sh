#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose -f "$ROOT_DIR/docker-compose.yml")
else
  echo "Docker Compose is required."
  exit 1
fi

"${COMPOSE[@]}" stop grafana prometheus alertmanager

echo "Stopped Grafana, Prometheus, and Alertmanager."

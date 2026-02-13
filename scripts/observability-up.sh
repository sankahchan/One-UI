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

"${COMPOSE[@]}" up -d alertmanager prometheus grafana

echo "Waiting for Alertmanager, Prometheus, and Grafana to be reachable..."
for i in $(seq 1 60); do
  if curl -sSf http://127.0.0.1:9093/-/healthy >/dev/null 2>&1 \
    && curl -sSf http://127.0.0.1:9090/-/healthy >/dev/null 2>&1 \
    && curl -sSf http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "Observability stack is ready."
    echo "Alertmanager: http://127.0.0.1:9093"
    echo "Prometheus: http://127.0.0.1:9090"
    echo "Grafana:    http://127.0.0.1:3001"
    echo "Alert webhook secret: ${ALERT_WEBHOOK_SECRET:-change_this_alert_secret}"
    echo "Grafana credentials: ${GRAFANA_ADMIN_USER:-admin} / ${GRAFANA_ADMIN_PASSWORD:-admin}"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for observability stack."
exit 1

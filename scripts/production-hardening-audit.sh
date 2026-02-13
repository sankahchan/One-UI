#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/backend/.env}"

pass_count=0
warn_count=0
fail_count=0

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$1"; }
red() { printf '\033[0;31m%s\033[0m\n' "$1"; }

pass() {
  pass_count=$((pass_count + 1))
  green "PASS: $1"
}

warn() {
  warn_count=$((warn_count + 1))
  yellow "WARN: $1"
}

fail() {
  fail_count=$((fail_count + 1))
  red "FAIL: $1"
}

get_env() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 1
  fi
  awk -F'=' -v target="$key" '$1 == target {print substr($0, index($0, "=") + 1)}' "$ENV_FILE" | tail -n1
}

echo "== One-UI Production Hardening Audit =="
echo "Workspace: $ROOT_DIR"
echo "Env file : $ENV_FILE"
echo

if [[ -f "$ENV_FILE" ]]; then
  pass "backend/.env exists"
else
  fail "backend/.env not found"
fi

node_env="$(get_env NODE_ENV || true)"
if [[ "$node_env" == "production" ]]; then
  pass "NODE_ENV is production"
else
  fail "NODE_ENV should be production (current: ${node_env:-unset})"
fi

jwt_secret="$(get_env JWT_SECRET || true)"
if [[ -z "$jwt_secret" ]]; then
  fail "JWT_SECRET is missing"
elif [[ ${#jwt_secret} -lt 32 ]]; then
  fail "JWT_SECRET must be at least 32 characters"
else
  pass "JWT_SECRET length is >= 32"
fi

db_url="$(get_env DATABASE_URL || true)"
if [[ -z "$db_url" ]]; then
  fail "DATABASE_URL is missing"
elif [[ "$db_url" == *"changeme"* ]]; then
  fail "DATABASE_URL still contains default password"
else
  pass "DATABASE_URL is configured"
fi

if command -v docker >/dev/null 2>&1; then
  pass "docker binary found"
else
  fail "docker binary not found"
fi

if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    pass "docker compose plugin found"
  elif command -v docker-compose >/dev/null 2>&1; then
    pass "docker-compose binary found"
  else
    fail "docker compose is not available"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  running_containers="$(docker ps --format '{{.Names}}' | tr '\n' ' ')"
  if [[ "$running_containers" == *"xray-panel-backend"* ]]; then
    pass "backend container is running"
  else
    warn "backend container is not running (expected: xray-panel-backend)"
  fi

  if [[ "$running_containers" == *"xray-panel-db"* ]]; then
    pass "db container is running"
  else
    warn "db container is not running (expected: xray-panel-db)"
  fi
fi

ssl_domain="$(get_env SSL_DOMAIN || true)"
ssl_cert_path="$(get_env SSL_CERT_PATH || true)"
if [[ -n "$ssl_domain" ]]; then
  if [[ -n "$ssl_cert_path" && -f "$ssl_cert_path/fullchain.pem" && -f "$ssl_cert_path/key.pem" ]]; then
    pass "SSL certificate files found for $ssl_domain"
  else
    warn "SSL domain configured but certificate files were not found"
  fi
else
  warn "SSL_DOMAIN is unset"
fi

if [[ -x "$ROOT_DIR/scripts/release-check.sh" ]]; then
  pass "release-check.sh is executable"
else
  warn "release-check.sh is missing or not executable"
fi

if [[ -x "$ROOT_DIR/scripts/rollback-readiness-check.sh" ]]; then
  pass "rollback-readiness-check.sh is executable"
else
  warn "rollback-readiness-check.sh is missing or not executable"
fi

if [[ -x "$ROOT_DIR/scripts/update-xray-core.sh" ]]; then
  pass "update-xray-core.sh is executable"
else
  warn "update-xray-core.sh is missing or not executable"
fi

if [[ -x "$ROOT_DIR/scripts/smoke-core-api.sh" ]]; then
  pass "smoke-core-api.sh is executable"
else
  warn "smoke-core-api.sh is missing or not executable"
fi

echo
echo "Summary: PASS=$pass_count WARN=$warn_count FAIL=$fail_count"

if [[ $fail_count -gt 0 ]]; then
  exit 1
fi

exit 0

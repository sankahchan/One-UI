#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Prevent auth/global limiter flakiness during local contract runs.
export AUTH_RATE_LIMIT_MAX="${AUTH_RATE_LIMIT_MAX:-1000}"
export RATE_LIMIT_MAX_REQUESTS="${RATE_LIMIT_MAX_REQUESTS:-5000}"

cleanup() {
  if [[ "${SKIP_BOOTSTRAP:-0}" != "1" ]]; then
    "$ROOT_DIR/scripts/dev-down.sh" >/dev/null 2>&1 || true
  fi
}

if [[ "${SKIP_BOOTSTRAP:-0}" != "1" ]]; then
  trap cleanup EXIT
  "$ROOT_DIR/scripts/bootstrap-local.sh"
fi

if [[ "${PLAYWRIGHT_INSTALL:-0}" == "1" ]]; then
  (
    cd "$ROOT_DIR/frontend"
    if [[ "${CI:-}" == "true" ]]; then
      npx playwright install --with-deps chromium
    else
      npx playwright install chromium
    fi
  )
fi

(
  cd "$ROOT_DIR/frontend"
  npm run e2e:api -- "$@"
)

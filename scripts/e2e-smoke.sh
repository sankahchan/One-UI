#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Prevent auth/global limiter flakiness during local smoke runs.
export AUTH_RATE_LIMIT_MAX="${AUTH_RATE_LIMIT_MAX:-1000}"
export RATE_LIMIT_MAX_REQUESTS="${RATE_LIMIT_MAX_REQUESTS:-5000}"

cleanup() {
  "$ROOT_DIR/scripts/dev-down.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$ROOT_DIR/scripts/bootstrap-local.sh"

if [[ "${SKIP_CORE_SMOKE:-0}" != "1" ]]; then
  "$ROOT_DIR/scripts/smoke-core-api.sh"
fi

if [[ "${SKIP_API_BUDGET:-0}" != "1" ]]; then
  "$ROOT_DIR/scripts/api-budget-check.sh"
fi

if [[ "${SKIP_API_SLO:-0}" != "1" ]]; then
  "$ROOT_DIR/scripts/api-slo-check.sh"
fi

"$ROOT_DIR/scripts/smoke-auth-notifications.sh"

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
  npm run e2e:smoke -- "$@"
)

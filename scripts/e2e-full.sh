#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  "$ROOT_DIR/scripts/dev-down.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$ROOT_DIR/scripts/bootstrap-local.sh"

if [[ "${SKIP_CORE_SMOKE:-0}" != "1" ]]; then
  "$ROOT_DIR/scripts/smoke-core-api.sh"
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
  npm run e2e:full -- "$@"
)

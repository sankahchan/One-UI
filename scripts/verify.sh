#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_E2E=false

usage() {
  cat <<'EOF'
Usage: ./scripts/verify.sh [options]

Runs:
  1) backend static checks
  2) frontend lint + production build
  3) local smoke checks (API + Playwright) via scripts/e2e-smoke.sh

Options:
  --skip-e2e   Skip smoke tests and only run static/build checks
  -h, --help   Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-e2e)
      SKIP_E2E=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

echo "[verify] backend check"
(
  cd "$ROOT_DIR/backend"
  # prisma validate requires DATABASE_URL to be present, even though it doesn't connect.
  # Prefer DATABASE_URL_LOCAL (used in CI) if DATABASE_URL isn't already set.
  export DATABASE_URL="${DATABASE_URL:-${DATABASE_URL_LOCAL:-postgresql://postgres:postgres@127.0.0.1:5432/xray_panel}}"
  npm run check
)

echo "[verify] frontend lint"
(
  cd "$ROOT_DIR/frontend"
  npm run lint
)

echo "[verify] frontend build"
(
  cd "$ROOT_DIR/frontend"
  npm run build
)

if [[ "$SKIP_E2E" == "true" ]]; then
  echo "[verify] smoke checks skipped (--skip-e2e)"
  exit 0
fi

echo "[verify] smoke checks (API contracts + UI flows)"
"$ROOT_DIR/scripts/e2e-smoke.sh"

echo "[verify] all checks passed"

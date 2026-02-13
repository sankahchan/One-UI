#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting One-UI local stack..."
"$ROOT_DIR/scripts/bootstrap-local.sh" "$@"

echo
echo "Open: http://127.0.0.1:5173"
echo "Stop: ./scripts/dev-down.sh"

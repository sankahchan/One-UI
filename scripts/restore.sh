#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ $# -lt 1 ]; then
  echo "Usage: $0 /path/to/backup-file.tar.gz"
  exit 1
fi

INPUT_FILE="$1"
if [ -f "${INPUT_FILE}" ]; then
  BACKUP_FILE="$(cd "$(dirname "${INPUT_FILE}")" && pwd)/$(basename "${INPUT_FILE}")"
elif [ -f "/var/backups/xray-panel/${INPUT_FILE}" ]; then
  BACKUP_FILE="/var/backups/xray-panel/${INPUT_FILE}"
else
  echo "Backup file not found: ${INPUT_FILE}"
  exit 1
fi

if [ ! -f "${ROOT_DIR}/backend/.env" ]; then
  echo "Missing ${ROOT_DIR}/backend/.env"
  exit 1
fi

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    docker compose "$@"
  fi
}

echo "Starting database service for restore..."
(
  cd "${ROOT_DIR}"
  compose up -d db
)

echo "Running restore from ${BACKUP_FILE} ..."
(
  cd "${ROOT_DIR}/backend"
  BACKUP_FILE="${BACKUP_FILE}" node - <<'NODE'
const backupManager = require('./src/backup/manager');

(async () => {
  await backupManager.restore(process.env.BACKUP_FILE);
  console.log(`Restore completed: ${process.env.BACKUP_FILE}`);
  process.exit(0);
})().catch((error) => {
  console.error('Restore failed:', error.message);
  process.exit(1);
});
NODE
)

echo "Restore complete."

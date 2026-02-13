#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
SERVICE_NAME="${SERVICE_NAME:-xray}"
CONTAINER_NAME="${CONTAINER_NAME:-xray-core}"
CONFIG_PATH_IN_CONTAINER="${CONFIG_PATH_IN_CONTAINER:-/etc/xray/config.json}"
DEFAULT_BASE_IMAGE="ghcr.io/xtls/xray-core:latest"
STABLE_BASE_IMAGE="${XRAY_STABLE_IMAGE:-$DEFAULT_BASE_IMAGE}"

TARGET_IMAGE=""
DRY_RUN=false
NO_RESTART=false
NO_ROLLBACK=false
YES=false
CANARY=false
ROLLBACK_ONLY=false
LIST_BACKUPS=false
BACKUP_TAG_INPUT=""

usage() {
  cat <<'USAGE'
Usage: scripts/update-xray-core.sh [options]

Safely update Xray-core container image with config test and rollback support.

Options:
  --image <ref>      Full image ref to use for build arg XRAY_BASE_IMAGE
                     Example: ghcr.io/xtls/xray-core:v1.8.24
  --stable           Use XRAY_STABLE_IMAGE channel (env-configurable)
  --latest           Shortcut for --image ghcr.io/xtls/xray-core:latest
  --canary           Run temporary preflight config test on target image first
  --rollback         Roll back xray service to backup image tag
  --backup-tag <tag> Use explicit backup tag for rollback (default: latest)
  --list-backups     List available rollback backup tags and exit
  --no-restart       Build/pull only, do not restart service
  --no-rollback      Disable automatic rollback on failed post-check
  --dry-run          Print commands without executing
  -y, --yes          Skip confirmation prompt
  -h, --help         Show this help

Environment overrides:
  COMPOSE_FILE, SERVICE_NAME, CONTAINER_NAME, CONFIG_PATH_IN_CONTAINER, XRAY_STABLE_IMAGE
USAGE
}

log() {
  printf '[xray-update] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

run() {
  if $DRY_RUN; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

compose() {
  if [[ "${COMPOSE_BIN[0]}" == "docker" ]]; then
    run docker compose -f "$COMPOSE_FILE" "$@"
  else
    run docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

service_has_build() {
  awk -v svc="$SERVICE_NAME" '
  $0 ~ /^services:[[:space:]]*$/ {in_services=1; next}
  in_services && $0 ~ /^[^[:space:]]/ {in_services=0}
  in_services {
    if ($0 ~ "^[[:space:]]{2}"svc":[[:space:]]*$") {in_svc=1; next}
    if (in_svc && $0 ~ "^[[:space:]]{2}[A-Za-z0-9_-]+:[[:space:]]*$") {in_svc=0}
    if (in_svc && $0 ~ /^[[:space:]]{4}build:[[:space:]]*$/) {print "1"; exit}
  }' "$COMPOSE_FILE"
}

resolve_service_image() {
  if [[ "${COMPOSE_BIN[0]}" == "docker" ]]; then
    docker compose -f "$COMPOSE_FILE" config 2>/dev/null | awk -v svc="$SERVICE_NAME" '
      $0 ~ /^services:[[:space:]]*$/ {in_services=1; next}
      in_services && $0 ~ /^[^[:space:]]/ {in_services=0}
      in_services {
        if ($0 ~ "^[[:space:]]{2}"svc":[[:space:]]*$") {in_svc=1; next}
        if (in_svc && $0 ~ "^[[:space:]]{2}[A-Za-z0-9_-]+:[[:space:]]*$") {in_svc=0}
        if (in_svc && $0 ~ /^[[:space:]]{4}image:[[:space:]]*/) {
          sub(/^[[:space:]]{4}image:[[:space:]]*/, "", $0);
          print $0;
          exit;
        }
      }'
  else
    docker-compose -f "$COMPOSE_FILE" config 2>/dev/null | awk -v svc="$SERVICE_NAME" '
      $0 ~ /^services:[[:space:]]*$/ {in_services=1; next}
      in_services && $0 ~ /^[^[:space:]]/ {in_services=0}
      in_services {
        if ($0 ~ "^[[:space:]]{2}"svc":[[:space:]]*$") {in_svc=1; next}
        if (in_svc && $0 ~ "^[[:space:]]{2}[A-Za-z0-9_-]+:[[:space:]]*$") {in_svc=0}
        if (in_svc && $0 ~ /^[[:space:]]{4}image:[[:space:]]*/) {
          sub(/^[[:space:]]{4}image:[[:space:]]*/, "", $0);
          print $0;
          exit;
        }
      }'
  fi
}

run_canary_preflight() {
  local image_ref="$1"
  local canary_config_path="${CANARY_CONFIG_PATH:-$ROOT_DIR/xray/config.json}"

  if [[ -z "$image_ref" || "$image_ref" == "<compose-managed-image>" ]]; then
    log "Canary preflight skipped: target image reference is unavailable."
    return 0
  fi

  if [[ ! -f "$canary_config_path" ]]; then
    log "Canary preflight skipped: config not found at $canary_config_path"
    return 0
  fi

  log "Running canary preflight with image: $image_ref"
  run docker run --rm \
    -v "$canary_config_path:/etc/xray/config.json:ro" \
    "$image_ref" \
    xray -test -config /etc/xray/config.json
}

wait_for_container() {
  local attempts=30
  while (( attempts > 0 )); do
    if docker ps --format '{{.Names}}' | grep -Fx "$CONTAINER_NAME" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempts=$((attempts - 1))
  done
  return 1
}

validate_config() {
  docker exec "$CONTAINER_NAME" xray -test -config "$CONFIG_PATH_IN_CONTAINER" >/dev/null
}

current_version() {
  docker exec "$CONTAINER_NAME" xray version 2>/dev/null | head -n 1 || true
}

list_backup_tags() {
  docker images --format '{{.Repository}}:{{.Tag}}' | grep '^oneui-xray-backup:' | sort -r || true
}

resolve_restore_image_ref() {
  if [[ -n "$CURRENT_IMAGE_REF" ]]; then
    echo "$CURRENT_IMAGE_REF"
    return 0
  fi

  local resolved
  resolved="$(resolve_service_image || true)"
  if [[ -n "$resolved" ]]; then
    echo "$resolved"
    return 0
  fi

  echo ""
}

resolve_rollback_tag() {
  if [[ -n "$BACKUP_TAG_INPUT" ]]; then
    echo "$BACKUP_TAG_INPUT"
    return 0
  fi

  local latest_tag
  latest_tag="$(list_backup_tags | head -n 1 || true)"
  if [[ -z "$latest_tag" ]]; then
    return 1
  fi
  echo "$latest_tag"
}

perform_rollback() {
  local rollback_tag="$1"
  local restore_ref="$2"

  if [[ -z "$rollback_tag" ]]; then
    echo "Rollback tag is required." >&2
    exit 1
  fi
  if [[ -z "$restore_ref" ]]; then
    echo "Could not resolve current service image reference for rollback." >&2
    exit 1
  fi

  log "Rolling back service '$SERVICE_NAME' using backup tag: $rollback_tag"
  run docker image inspect "$rollback_tag" >/dev/null
  run docker image tag "$rollback_tag" "$restore_ref"
  compose up -d --no-build "$SERVICE_NAME"

  if ! wait_for_container; then
    log "Rollback failed: container did not become ready."
    exit 1
  fi

  if ! validate_config; then
    log "Rollback failed: xray config validation failed after restore."
    exit 1
  fi

  local rolled_version
  rolled_version="$(current_version)"
  log "Rollback completed successfully."
  log "Active version: ${rolled_version:-unknown}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      TARGET_IMAGE="${2:-}"
      shift 2
      ;;
    --stable)
      TARGET_IMAGE="$STABLE_BASE_IMAGE"
      shift
      ;;
    --latest)
      TARGET_IMAGE="$DEFAULT_BASE_IMAGE"
      shift
      ;;
    --canary)
      CANARY=true
      shift
      ;;
    --rollback)
      ROLLBACK_ONLY=true
      shift
      ;;
    --backup-tag)
      BACKUP_TAG_INPUT="${2:-}"
      shift 2
      ;;
    --list-backups)
      LIST_BACKUPS=true
      shift
      ;;
    --no-restart)
      NO_RESTART=true
      shift
      ;;
    --no-rollback)
      NO_ROLLBACK=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -y|--yes)
      YES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd docker

if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN=("docker")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN=("docker-compose")
else
  echo "Docker Compose not found (docker compose or docker-compose)." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if $LIST_BACKUPS; then
  list_backup_tags
  exit 0
fi

HAS_BUILD="$(service_has_build || true)"
if [[ -z "$TARGET_IMAGE" ]]; then
  if [[ "$HAS_BUILD" == "1" ]]; then
    TARGET_IMAGE="${XRAY_BASE_IMAGE:-$STABLE_BASE_IMAGE}"
  else
    TARGET_IMAGE="$(resolve_service_image || true)"
    if [[ -z "$TARGET_IMAGE" ]]; then
      TARGET_IMAGE="<compose-managed-image>"
    fi
  fi
fi

RUNNING_BEFORE=false
CURRENT_IMAGE_REF=""
CURRENT_IMAGE_ID=""
CURRENT_VERSION=""
BACKUP_TAG=""

if docker ps -a --format '{{.Names}}' | grep -Fx "$CONTAINER_NAME" >/dev/null 2>&1; then
  RUNNING_BEFORE=true
  CURRENT_IMAGE_REF="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  CURRENT_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  CURRENT_VERSION="$(current_version)"
fi

if $ROLLBACK_ONLY; then
  rollback_tag="$(resolve_rollback_tag || true)"
  if [[ -z "${rollback_tag:-}" ]]; then
    echo "No rollback backup tag found. Run a successful update first to create backups." >&2
    exit 1
  fi

  restore_ref="$(resolve_restore_image_ref)"
  if ! $YES && ! $DRY_RUN; then
    read -r -p "Proceed with rollback using '$rollback_tag'? [y/N] " ANSWER
    case "$ANSWER" in
      y|Y|yes|YES) ;;
      *) log "Canceled."; exit 0 ;;
    esac
  fi

  perform_rollback "$rollback_tag" "$restore_ref"
  exit 0
fi

log "Compose file: $COMPOSE_FILE"
log "Service: $SERVICE_NAME"
log "Container: $CONTAINER_NAME"
log "Current version: ${CURRENT_VERSION:-unknown}"
log "Target image: $TARGET_IMAGE"
log "Mode: $([[ "$HAS_BUILD" == "1" ]] && echo 'build' || echo 'pull')"
log "Canary preflight: $($CANARY && echo enabled || echo disabled)"

if ! $YES && ! $DRY_RUN; then
  read -r -p "Proceed with Xray-core update? [y/N] " ANSWER
  case "$ANSWER" in
    y|Y|yes|YES) ;;
    *) log "Canceled."; exit 0 ;;
  esac
fi

if $CANARY; then
  log "Starting canary preflight..."
  run_canary_preflight "$TARGET_IMAGE"
  log "Canary preflight passed."
fi

if [[ -n "$CURRENT_IMAGE_ID" ]]; then
  BACKUP_TAG="oneui-xray-backup:$(date +%Y%m%d%H%M%S)"
  log "Creating rollback tag: $BACKUP_TAG"
  run docker image tag "$CURRENT_IMAGE_ID" "$BACKUP_TAG"
  echo "BACKUP_TAG=$BACKUP_TAG"
fi

if [[ "$HAS_BUILD" == "1" ]]; then
  log "Building xray service with latest base layers..."
  run env XRAY_BASE_IMAGE="$TARGET_IMAGE" "${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" build --pull "$SERVICE_NAME"
  if ! $NO_RESTART; then
    log "Restarting xray service..."
    compose up -d "$SERVICE_NAME"
  fi
else
  log "Pulling service image..."
  compose pull "$SERVICE_NAME"
  if ! $NO_RESTART; then
    log "Restarting xray service..."
    compose up -d "$SERVICE_NAME"
  fi
fi

if $NO_RESTART; then
  log "Update build/pull complete (restart skipped by --no-restart)."
  exit 0
fi

if ! wait_for_container; then
  log "Container did not start after update."
  if $NO_ROLLBACK || [[ -z "$BACKUP_TAG" || -z "$CURRENT_IMAGE_REF" ]]; then
    exit 1
  fi
  log "Rolling back..."
  run docker image tag "$BACKUP_TAG" "$CURRENT_IMAGE_REF"
  compose up -d --no-build "$SERVICE_NAME"
  exit 1
fi

if ! validate_config; then
  log "Post-update config validation failed."
  if $NO_ROLLBACK || [[ -z "$BACKUP_TAG" || -z "$CURRENT_IMAGE_REF" ]]; then
    exit 1
  fi
  log "Rolling back to previous image..."
  run docker image tag "$BACKUP_TAG" "$CURRENT_IMAGE_REF"
  compose up -d --no-build "$SERVICE_NAME"
  if wait_for_container && validate_config; then
    log "Rollback succeeded."
  else
    log "Rollback failed. Manual intervention required."
    exit 1
  fi
fi

NEW_VERSION="$(current_version)"
log "Update completed."
log "New version: ${NEW_VERSION:-unknown}"

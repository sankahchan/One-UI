#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/one-ui}"
MIERU_DIR="${MIERU_DIR:-$INSTALL_DIR/mieru}"
CONTAINER_NAME="${CONTAINER_NAME:-${MIERU_CONTAINER_NAME:-mieru-sidecar}}"
IMAGE_NAME="${IMAGE_NAME:-one-ui-mieru}"
CONFIG_SOURCE="${CONFIG_SOURCE:-$MIERU_DIR/server_config.json}"
DATA_VOLUME="${DATA_VOLUME:-one-ui_mieru_data}"
RUN_VOLUME="${RUN_VOLUME:-one-ui_mieru_run}"
NETWORK_MODE="${NETWORK_MODE:-host}"
RESTART_POLICY="${RESTART_POLICY:-always}"

TARGET_VERSION=""
DRY_RUN=false
YES=false

usage() {
  cat <<'USAGE'
Usage: scripts/update-mieru.sh [options] [version]

Rebuild and recreate the One-UI Mieru sidecar from official GitHub releases.

Options:
  --version <ver>    Install an explicit version, for example 3.28.0
  --latest           Resolve the latest release automatically (default)
  --container <name> Override the Mieru container name (default: mieru-sidecar)
  --image <name>     Override the local Docker image name (default: one-ui-mieru)
  --install-dir <p>  Override the One-UI install dir (default: /opt/one-ui)
  --dry-run          Print the actions without executing them
  -y, --yes          Skip confirmation
  -h, --help         Show this help

Environment overrides:
  INSTALL_DIR, MIERU_DIR, CONTAINER_NAME, IMAGE_NAME, CONFIG_SOURCE,
  DATA_VOLUME, RUN_VOLUME, NETWORK_MODE, RESTART_POLICY
USAGE
}

log() {
  printf '[mieru-update] %s\n' "$*"
}

fail() {
  printf '[mieru-update] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Required command not found: $1"
  fi
}

run() {
  if $DRY_RUN; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

detect_archive_arch() {
  local machine
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64)
      printf 'amd64\n'
      ;;
    aarch64|arm64)
      printf 'arm64\n'
      ;;
    *)
      fail "Unsupported architecture for official Mieru release tarballs: $machine"
      ;;
  esac
}

resolve_latest_version() {
  local resolved
  resolved="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/enfein/mieru/releases/latest)"
  resolved="${resolved%/}"
  resolved="${resolved##*/}"
  resolved="${resolved#v}"
  [[ -n "$resolved" ]] || fail 'Unable to resolve latest Mieru release version'
  printf '%s\n' "$resolved"
}

normalize_version() {
  local input
  input="${1:-}"
  input="${input#v}"
  [[ -n "$input" ]] || fail 'Version cannot be empty'
  printf '%s\n' "$input"
}

current_version() {
  docker exec "$CONTAINER_NAME" sh -lc 'mita version || /usr/local/bin/mita version' 2>/dev/null | head -n 1 || true
}

inspect_current_container() {
  if ! docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    return 0
  fi

  local current_network current_restart current_config current_data current_run
  current_network="$(docker inspect "$CONTAINER_NAME" --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || true)"
  current_restart="$(docker inspect "$CONTAINER_NAME" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || true)"
  current_config="$(docker inspect "$CONTAINER_NAME" --format '{{range .Mounts}}{{if eq .Destination "/etc/mita/server_config.json"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  current_data="$(docker inspect "$CONTAINER_NAME" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mita"}}{{if .Name}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' 2>/dev/null || true)"
  current_run="$(docker inspect "$CONTAINER_NAME" --format '{{range .Mounts}}{{if eq .Destination "/var/run/mita"}}{{if .Name}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' 2>/dev/null || true)"

  if [[ -n "$current_network" ]]; then
    NETWORK_MODE="$current_network"
  fi
  if [[ -n "$current_restart" ]]; then
    RESTART_POLICY="$current_restart"
  fi
  if [[ -n "$current_config" ]]; then
    CONFIG_SOURCE="$current_config"
  fi
  if [[ -n "$current_data" ]]; then
    DATA_VOLUME="$current_data"
  fi
  if [[ -n "$current_run" ]]; then
    RUN_VOLUME="$current_run"
  fi
}

write_temp_dockerfile() {
  local dockerfile_path archive_arch
  dockerfile_path="$1"
  archive_arch="$2"

  cat >"$dockerfile_path" <<EOF
FROM alpine:3.20
ARG MITA_VERSION
RUN apk add --no-cache ca-certificates curl tar \\
  && addgroup -S mita \\
  && adduser -S -D -H -G mita mita \\
  && mkdir -p /etc/mita /var/lib/mita /var/run/mita \\
  && chown -R mita:mita /etc/mita /var/lib/mita /var/run/mita \\
  && chmod 775 /etc/mita /var/lib/mita /var/run/mita \\
  && curl -fsSL "https://github.com/enfein/mieru/releases/download/v\${MITA_VERSION}/mita_\${MITA_VERSION}_linux_${archive_arch}.tar.gz" -o /tmp/mita.tar.gz \\
  && tar -xzf /tmp/mita.tar.gz -C /usr/local/bin mita \\
  && chmod +x /usr/local/bin/mita \\
  && rm -f /tmp/mita.tar.gz
USER mita
ENV MITA_CONFIG_JSON_FILE=/etc/mita/server_config.json
ENV MITA_INSECURE_UDS=1
CMD ["/usr/local/bin/mita", "run"]
EOF
}

start_container() {
  local image_ref
  image_ref="$1"

  run docker volume create "$DATA_VOLUME" >/dev/null
  run docker volume create "$RUN_VOLUME" >/dev/null
  run docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

  run docker run -d \
    --name "$CONTAINER_NAME" \
    --restart "$RESTART_POLICY" \
    --network "$NETWORK_MODE" \
    -v "$CONFIG_SOURCE:/etc/mita/server_config.json:ro" \
    -v "$DATA_VOLUME:/var/lib/mita" \
    -v "$RUN_VOLUME:/var/run/mita" \
    "$image_ref" >/dev/null
}

wait_for_version() {
  local attempts=20
  while (( attempts > 0 )); do
    if docker exec "$CONTAINER_NAME" sh -lc 'mita version >/dev/null 2>&1 || /usr/local/bin/mita version >/dev/null 2>&1'; then
      return 0
    fi
    sleep 1
    attempts=$((attempts - 1))
  done
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || fail '--version requires a value'
      TARGET_VERSION="$2"
      shift 2
      ;;
    --latest)
      TARGET_VERSION="latest"
      shift
      ;;
    --container)
      [[ $# -ge 2 ]] || fail '--container requires a value'
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --image)
      [[ $# -ge 2 ]] || fail '--image requires a value'
      IMAGE_NAME="$2"
      shift 2
      ;;
    --install-dir)
      [[ $# -ge 2 ]] || fail '--install-dir requires a value'
      INSTALL_DIR="$2"
      MIERU_DIR="$INSTALL_DIR/mieru"
      CONFIG_SOURCE="$MIERU_DIR/server_config.json"
      shift 2
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
      if [[ -z "$TARGET_VERSION" ]]; then
        TARGET_VERSION="$1"
        shift
      else
        fail "Unknown argument: $1"
      fi
      ;;
  esac
done

require_cmd docker
require_cmd curl

inspect_current_container

if [[ "${TARGET_VERSION:-latest}" == "latest" ]]; then
  TARGET_VERSION="$(resolve_latest_version)"
else
  TARGET_VERSION="$(normalize_version "$TARGET_VERSION")"
fi

ARCHIVE_ARCH="$(detect_archive_arch)"
CURRENT_VERSION="$(current_version)"
BACKUP_IMAGE_TAG=""

[[ -f "$CONFIG_SOURCE" ]] || fail "Mieru config not found at $CONFIG_SOURCE"

if docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  BACKUP_IMAGE_TAG="${IMAGE_NAME}:backup-$(date +%Y%m%d-%H%M%S)"
fi

log "Target version: $TARGET_VERSION"
log "Current version: ${CURRENT_VERSION:-unknown}"
log "Container: $CONTAINER_NAME"
log "Image: $IMAGE_NAME"
log "Config: $CONFIG_SOURCE"
log "Network mode: $NETWORK_MODE"
log "Data volume: $DATA_VOLUME"
log "Run volume: $RUN_VOLUME"

if ! $YES && ! $DRY_RUN; then
  read -r -p "Proceed with Mieru update? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES)
      ;;
    *)
      log 'Cancelled.'
      exit 0
      ;;
  esac
fi

if [[ -n "$BACKUP_IMAGE_TAG" ]]; then
  log "Saving image rollback tag: $BACKUP_IMAGE_TAG"
  run docker image tag "$IMAGE_NAME" "$BACKUP_IMAGE_TAG"
fi

if ! $DRY_RUN; then
  backup_path="${CONFIG_SOURCE}.bak.$(date +%Y%m%d-%H%M%S)"
  log "Backing up config to $backup_path"
  cp "$CONFIG_SOURCE" "$backup_path"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DOCKERFILE_PATH="$TMP_DIR/Dockerfile"
write_temp_dockerfile "$DOCKERFILE_PATH" "$ARCHIVE_ARCH"

log 'Building updated Mieru image'
run docker build --pull --build-arg "MITA_VERSION=$TARGET_VERSION" -t "$IMAGE_NAME" -f "$DOCKERFILE_PATH" "$TMP_DIR"

log 'Recreating sidecar container'
if ! start_container "$IMAGE_NAME"; then
  if [[ -n "$BACKUP_IMAGE_TAG" ]]; then
    log "Update failed during container start. Rolling back to $BACKUP_IMAGE_TAG"
    start_container "$BACKUP_IMAGE_TAG"
  fi
  fail 'Failed to start updated Mieru container'
fi

if ! $DRY_RUN; then
  if ! wait_for_version; then
    if [[ -n "$BACKUP_IMAGE_TAG" ]]; then
      log "Updated container did not become ready. Rolling back to $BACKUP_IMAGE_TAG"
      start_container "$BACKUP_IMAGE_TAG"
    fi
    fail 'Updated Mieru container did not become ready'
  fi

  NEW_VERSION="$(current_version)"
  log "Mieru version after update: ${NEW_VERSION:-unknown}"
  run docker logs --tail=20 "$CONTAINER_NAME"
fi

log 'Done.'

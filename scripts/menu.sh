#!/usr/bin/env bash
set -euo pipefail

#############################################
# One-UI Management Menu
# X-UI Style Management for One-UI
#
# Usage: one-ui [command]
# Or run without arguments for interactive menu.
#############################################

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
WHITE='\033[1;37m'
NC='\033[0m'

# Configuration
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
CONTAINER_NAME="${CONTAINER_NAME:-xray-core}"
UPDATE_SCRIPT="$ROOT_DIR/scripts/update-xray-core.sh"
SMOKE_CORE_SCRIPT="$ROOT_DIR/scripts/smoke-core-api.sh"
SMOKE_MYANMAR_SCRIPT="$ROOT_DIR/scripts/smoke-myanmar-hardening.sh"
INSTALL_DIR="${ONEUI_INSTALL_DIR:-${ROOT_DIR}}"
DATA_DIR="${ONEUI_DATA_DIR:-/var/lib/one-ui}"
BACKUP_DIR="${ONEUI_BACKUP_DIR:-/var/backups/one-ui}"
SCRIPT_VERSION="1.0.0"
GITHUB_REPO="sankahchan/One-UI"

# ============================================
# Helpers
# ============================================

# Safely set a key=value in an env file.
# If the key already exists, update it. Otherwise, append it.
set_env_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
  else
    echo -e "${RED}[✗]${NC} Docker Compose not found" >&2
    return 1
  fi
}

get_panel_port() {
  if [ -f "$ROOT_DIR/.panel_port" ]; then
    cat "$ROOT_DIR/.panel_port"
  elif [ -f "$ROOT_DIR/backend/.env" ]; then
    grep -oP '^PORT=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "3000"
  else
    echo "3000"
  fi
}

get_panel_path() {
  if [ -f "$ROOT_DIR/.panel_path" ]; then
    cat "$ROOT_DIR/.panel_path"
  elif [ -f "$ROOT_DIR/backend/.env" ]; then
    grep -oP '^PANEL_PATH=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

get_server_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || curl -s ifconfig.me 2>/dev/null || echo "SERVER_IP"
}

get_panel_url() {
  local port path server_ip
  port="$(get_panel_port)"
  path="$(get_panel_path)"
  server_ip="$(get_server_ip)"
  if [ -n "$path" ]; then
    echo "http://${server_ip}:${port}${path}/"
  else
    echo "http://${server_ip}:${port}"
  fi
}

is_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\])${port}$"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -qE "[:.]${port}\\b"
    return $?
  fi
  return 1
}

find_available_port() {
  local port
  for _ in $(seq 1 50); do
    port=$(( (RANDOM % 8000) + 2000 ))
    if ! is_port_in_use "${port}"; then
      echo "${port}"
      return
    fi
  done
  echo "3000"
}

confirm() {
  local prompt="${1:-Are you sure?}"
  echo ""
  read -r -p "  ${prompt} [y/N]: " reply
  case "${reply}" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# ============================================
# Display
# ============================================

print_banner() {
  echo -e "${CYAN}"
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║                                                              ║"
  echo "║          ██████╗ ███╗   ██╗███████╗     ██╗   ██╗██╗         ║"
  echo "║         ██╔═══██╗████╗  ██║██╔════╝     ██║   ██║██║         ║"
  echo "║         ██║   ██║██╔██╗ ██║█████╗ █████╗██║   ██║██║         ║"
  echo "║         ██║   ██║██║╚██╗██║██╔══╝ ╚════╝██║   ██║██║         ║"
  echo "║         ╚██████╔╝██║ ╚████║███████╗     ╚██████╔╝██║         ║"
  echo "║          ╚═════╝ ╚═╝  ╚═══╝╚══════╝      ╚═════╝ ╚═╝         ║"
  echo "║                                                              ║"
  echo "║          One-UI Management Console v${SCRIPT_VERSION}                  ║"
  echo "║          Xray Proxy Management Panel                         ║"
  echo "║                                                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

show_status() {
  local port path server_ip panel_url
  port="$(get_panel_port)"
  path="$(get_panel_path)"
  server_ip="$(get_server_ip)"
  panel_url="$(get_panel_url)"

  echo ""
  echo -e "${CYAN}┌──────────────────────────────────────────────────────────────┐${NC}"
  echo -e "${CYAN}│${NC}  ${YELLOW}One-UI Service Status${NC}"
  echo -e "${CYAN}├──────────────────────────────────────────────────────────────┤${NC}"

  # Backend status
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qFx "one-ui-backend"; then
    echo -e "${CYAN}│${NC}  Backend:    ${GREEN}● Running${NC}"
  else
    echo -e "${CYAN}│${NC}  Backend:    ${RED}○ Stopped${NC}"
  fi

  # Database status
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qFx "one-ui-db"; then
    echo -e "${CYAN}│${NC}  Database:   ${GREEN}● Running${NC}"
  else
    echo -e "${CYAN}│${NC}  Database:   ${RED}○ Stopped${NC}"
  fi

  # Xray status
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qFx "$CONTAINER_NAME"; then
    local xray_ver
    xray_ver="$(docker exec "$CONTAINER_NAME" xray version 2>/dev/null | head -n 1 || echo "unknown")"
    echo -e "${CYAN}│${NC}  Xray:       ${GREEN}● Running${NC} (${xray_ver})"
  else
    echo -e "${CYAN}│${NC}  Xray:       ${RED}○ Stopped${NC}"
  fi

  # Autostart status (Docker restart policy)
  local restart_policy
  restart_policy="$(docker inspect --format='{{.HostConfig.RestartPolicy.Name}}' one-ui-backend 2>/dev/null || echo "unknown")"
  if [ "$restart_policy" = "always" ] || [ "$restart_policy" = "unless-stopped" ]; then
    echo -e "${CYAN}│${NC}  Auto-start: ${GREEN}Enabled${NC} (${restart_policy})"
  elif [ "$restart_policy" = "unknown" ]; then
    echo -e "${CYAN}│${NC}  Auto-start: ${YELLOW}Unknown${NC}"
  else
    echo -e "${CYAN}│${NC}  Auto-start: ${YELLOW}Disabled${NC} (${restart_policy})"
  fi

  echo -e "${CYAN}│${NC}"
  echo -e "${CYAN}│${NC}  Port:       ${BLUE}${port}${NC}"
  if [ -n "$path" ]; then
    echo -e "${CYAN}│${NC}  Path:       ${BLUE}${path}/${NC}"
  fi
  echo -e "${CYAN}│${NC}  Panel URL:  ${GREEN}${panel_url}${NC}"

  # Version
  if [ -f "$ROOT_DIR/backend/package.json" ]; then
    local version
    version="$(grep '"version"' "$ROOT_DIR/backend/package.json" 2>/dev/null | head -1 | cut -d'"' -f4)"
    if [ -n "$version" ]; then
      echo -e "${CYAN}│${NC}  Version:    ${BLUE}${version}${NC}"
    fi
  fi

  # SSL status
  if [ -f "${DATA_DIR}/certs/fullchain.pem" ]; then
    local ssl_domain ssl_expiry
    ssl_domain="$(openssl x509 -in "${DATA_DIR}/certs/fullchain.pem" -noout -subject 2>/dev/null | sed 's/.*CN = //' || echo "unknown")"
    ssl_expiry="$(openssl x509 -in "${DATA_DIR}/certs/fullchain.pem" -noout -enddate 2>/dev/null | sed 's/.*=//' || echo "unknown")"
    echo -e "${CYAN}│${NC}  SSL:        ${GREEN}● Active${NC} (${ssl_domain})"
    echo -e "${CYAN}│${NC}  SSL Expiry: ${BLUE}${ssl_expiry}${NC}"
  else
    echo -e "${CYAN}│${NC}  SSL:        ${YELLOW}○ Not configured${NC}"
  fi

  # Telegram status
  local tg_enabled_status
  tg_enabled_status="$(grep -oP '^TELEGRAM_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"
  if [ "$tg_enabled_status" = "true" ]; then
    echo -e "${CYAN}│${NC}  Telegram:   ${GREEN}● Enabled${NC}"
  else
    echo -e "${CYAN}│${NC}  Telegram:   ${YELLOW}○ Disabled${NC}"
  fi

  # Backup status
  local bk_enabled_status
  bk_enabled_status="$(grep -oP '^BACKUP_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"
  if [ "$bk_enabled_status" = "true" ]; then
    echo -e "${CYAN}│${NC}  Backup:     ${GREEN}● Enabled${NC}"
  else
    echo -e "${CYAN}│${NC}  Backup:     ${YELLOW}○ Disabled${NC}"
  fi

  echo -e "${CYAN}└──────────────────────────────────────────────────────────────┘${NC}"
  echo ""
}

# ============================================
# 1. Install (Re-install)
# ============================================

do_install() {
  echo -e "${BLUE}[*]${NC} Re-installing One-UI..."
  echo -e "${YELLOW}[!]${NC} This will rebuild and restart all containers."

  if ! confirm "Proceed with re-installation?"; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  cd "$ROOT_DIR"

  echo -e "${BLUE}[*]${NC} Backing up configuration..."
  cp backend/.env backend/.env.backup 2>/dev/null || true
  cp .panel_port .panel_port.backup 2>/dev/null || true
  cp .panel_path .panel_path.backup 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Stopping existing containers..."
  compose down 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Restoring configuration..."
  cp backend/.env.backup backend/.env 2>/dev/null || true
  cp .panel_port.backup .panel_port 2>/dev/null || true
  cp .panel_path.backup .panel_path 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Building frontend assets..."
  local panel_path
  panel_path="$(get_panel_path)"
  docker run --rm \
    -v "${ROOT_DIR}:/work" \
    -w /work/frontend \
    node:20-alpine \
    sh -lc "set -e; npm ci --loglevel=error; VITE_API_URL=${panel_path}/api VITE_PANEL_PATH=${panel_path} npm run build"

  rm -rf "${ROOT_DIR}/backend/public"
  mkdir -p "${ROOT_DIR}/backend/public"
  cp -R "${ROOT_DIR}/frontend/dist/." "${ROOT_DIR}/backend/public/"

  echo -e "${BLUE}[*]${NC} Building and starting containers..."
  compose build
  compose up -d

  sleep 3
  if docker ps --format '{{.Names}}' | grep -qFx "one-ui-backend"; then
    echo -e "${GREEN}[✓]${NC} One-UI re-installed successfully!"
  else
    echo -e "${RED}[✗]${NC} Installation failed. Check logs:"
    compose logs --tail=30 backend
  fi

  show_status
}

# ============================================
# 2. Update One-UI
# ============================================

update_oneui() {
  echo -e "${BLUE}[*]${NC} Updating One-UI to latest version..."
  cd "$ROOT_DIR"

  echo -e "${BLUE}[*]${NC} Backing up configuration..."
  cp backend/.env backend/.env.backup 2>/dev/null || true
  cp .panel_port .panel_port.backup 2>/dev/null || true
  cp .panel_path .panel_path.backup 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Pulling latest code..."
  git pull --ff-only || git pull

  echo -e "${BLUE}[*]${NC} Restoring configuration..."
  cp backend/.env.backup backend/.env 2>/dev/null || true
  cp .panel_port.backup .panel_port 2>/dev/null || true
  cp .panel_path.backup .panel_path 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Rebuilding frontend..."
  local panel_path
  panel_path="$(get_panel_path)"
  docker run --rm \
    -v "${ROOT_DIR}:/work" \
    -w /work/frontend \
    node:20-alpine \
    sh -lc "set -e; npm ci --loglevel=error; VITE_API_URL=${panel_path}/api VITE_PANEL_PATH=${panel_path} npm run build"

  rm -rf "${ROOT_DIR}/backend/public"
  mkdir -p "${ROOT_DIR}/backend/public"
  cp -R "${ROOT_DIR}/frontend/dist/." "${ROOT_DIR}/backend/public/"

  echo -e "${BLUE}[*]${NC} Rebuilding and restarting containers..."
  compose up -d --build

  sleep 3
  echo -e "${GREEN}[✓]${NC} One-UI updated successfully!"
  show_status
}

# ============================================
# 3. Legacy Version
# ============================================

install_legacy_version() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Install Specific Version                        ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  cd "$ROOT_DIR"

  echo -e "${BLUE}[*]${NC} Available tags/versions:"
  git tag -l --sort=-v:refname 2>/dev/null | head -20 || echo "  No tags found."
  echo ""
  echo -e "${BLUE}[*]${NC} Recent commits:"
  git log --oneline -10 2>/dev/null || echo "  Could not read git log."
  echo ""

  local target_version=""
  read -r -p "  Enter version tag or commit hash (or 'cancel'): " target_version

  if [ -z "$target_version" ] || [ "$target_version" = "cancel" ]; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  if ! confirm "Switch to version '${target_version}'? Current changes will be stashed."; then
    return
  fi

  echo -e "${BLUE}[*]${NC} Backing up configuration..."
  cp backend/.env backend/.env.backup 2>/dev/null || true
  cp .panel_port .panel_port.backup 2>/dev/null || true
  cp .panel_path .panel_path.backup 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Stashing local changes..."
  git stash 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Checking out ${target_version}..."
  if ! git checkout "${target_version}"; then
    echo -e "${RED}[✗]${NC} Failed to checkout ${target_version}"
    git stash pop 2>/dev/null || true
    return
  fi

  echo -e "${BLUE}[*]${NC} Restoring configuration..."
  cp backend/.env.backup backend/.env 2>/dev/null || true
  cp .panel_port.backup .panel_port 2>/dev/null || true
  cp .panel_path.backup .panel_path 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Rebuilding frontend..."
  local panel_path
  panel_path="$(get_panel_path)"
  docker run --rm \
    -v "${ROOT_DIR}:/work" \
    -w /work/frontend \
    node:20-alpine \
    sh -lc "set -e; npm ci --loglevel=error; VITE_API_URL=${panel_path}/api VITE_PANEL_PATH=${panel_path} npm run build" || true

  rm -rf "${ROOT_DIR}/backend/public"
  mkdir -p "${ROOT_DIR}/backend/public"
  cp -R "${ROOT_DIR}/frontend/dist/." "${ROOT_DIR}/backend/public/" 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Rebuilding containers..."
  compose up -d --build

  sleep 3
  echo -e "${GREEN}[✓]${NC} Switched to version ${target_version}"
  show_status
}

# ============================================
# 4. Uninstall
# ============================================

do_uninstall() {
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║                    UNINSTALL ONE-UI                          ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}[!]${NC} This will:"
  echo "  • Stop and remove all One-UI containers"
  echo "  • Remove Docker volumes (database data)"
  echo "  • Optionally remove installation files"
  echo ""

  if ! confirm "Are you ABSOLUTELY sure you want to uninstall?"; then
    echo -e "${YELLOW}[!]${NC} Uninstall cancelled."
    return
  fi

  local remove_data="n"
  read -r -p "  Remove database and backup data? [y/N]: " remove_data

  cd "$ROOT_DIR"

  echo -e "${BLUE}[*]${NC} Creating final backup..."
  mkdir -p "${BACKUP_DIR}"
  cp backend/.env "${BACKUP_DIR}/env.backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  cp .panel_port "${BACKUP_DIR}/panel_port.backup" 2>/dev/null || true
  cp .panel_path "${BACKUP_DIR}/panel_path.backup" 2>/dev/null || true

  echo -e "${BLUE}[*]${NC} Stopping containers..."
  compose down -v 2>/dev/null || true

  # Force-stop any stragglers
  for name in one-ui-backend one-ui-db xray-core one-ui-prometheus one-ui-alertmanager one-ui-grafana; do
    docker stop "${name}" 2>/dev/null || true
    docker rm -f "${name}" 2>/dev/null || true
  done

  echo -e "${BLUE}[*]${NC} Removing CLI wrapper..."
  rm -f /usr/local/bin/one-ui 2>/dev/null || true

  # Remove firewall rules
  if command -v ufw >/dev/null 2>&1; then
    local port
    port="$(get_panel_port)"
    ufw delete allow "${port}/tcp" 2>/dev/null || true
    echo -e "${BLUE}[*]${NC} Removed firewall rule for port ${port}"
  fi

  case "${remove_data}" in
    [yY]|[yY][eE][sS])
      echo -e "${BLUE}[*]${NC} Removing data directories..."
      rm -rf "${DATA_DIR}" 2>/dev/null || true
      rm -rf "${BACKUP_DIR}" 2>/dev/null || true
      echo -e "${GREEN}[✓]${NC} Data removed."
      ;;
    *)
      echo -e "${YELLOW}[!]${NC} Data directories preserved:"
      echo "    ${DATA_DIR}"
      echo "    ${BACKUP_DIR}"
      ;;
  esac

  echo ""
  echo -e "${GREEN}[✓]${NC} One-UI has been uninstalled."
  echo -e "${YELLOW}[!]${NC} Installation files remain at: ${ROOT_DIR}"
  echo -e "${YELLOW}[!]${NC} To fully remove, run: rm -rf ${ROOT_DIR}"
  echo ""
}

# ============================================
# 5. Reset Username & Password
# ============================================

reset_credentials() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Reset Admin Credentials                         ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local new_user=""
  local new_pass=""

  read -r -p "  Enter new admin username [admin]: " new_user
  new_user="${new_user:-admin}"

  while true; do
    read -r -s -p "  Enter new admin password: " new_pass
    echo ""
    if [ -n "$new_pass" ]; then
      break
    fi
    echo -e "${YELLOW}[!]${NC} Password cannot be empty."
  done

  echo -e "${BLUE}[*]${NC} Resetting admin credentials..."

  local admin_user_b64 admin_pass_b64
  admin_user_b64="$(printf '%s' "${new_user}" | base64 | tr -d '\n')"
  admin_pass_b64="$(printf '%s' "${new_pass}" | base64 | tr -d '\n')"

  cd "$ROOT_DIR"

  compose run --rm -T \
    -e "ADMIN_USER_B64=${admin_user_b64}" \
    -e "ADMIN_PASS_B64=${admin_pass_b64}" \
    backend node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

(async () => {
  const prisma = new PrismaClient();
  const username = Buffer.from(process.env.ADMIN_USER_B64, 'base64').toString('utf8');
  const password = Buffer.from(process.env.ADMIN_PASS_B64, 'base64').toString('utf8');
  const hash = await bcrypt.hash(password, 12);

  const existing = await prisma.admin.findUnique({ where: { username } });
  if (existing) {
    await prisma.admin.update({
      where: { id: existing.id },
      data: { password: hash }
    });
    console.log('Admin password updated for: ' + username);
  } else {
    await prisma.admin.create({
      data: { username, password: hash, role: 'SUPER_ADMIN' }
    });
    console.log('Admin user created: ' + username);
  }
  await prisma.\$disconnect();
})();
"

  if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}[✓]${NC} Admin credentials updated!"
    echo -e "${CYAN}│${NC}  Username: ${GREEN}${new_user}${NC}"
    echo -e "${CYAN}│${NC}  Password: ${GREEN}${new_pass}${NC}"
    echo ""
  else
    echo -e "${RED}[✗]${NC} Failed to reset credentials. Make sure the database is running."
  fi
}

# ============================================
# 6. Reset Web Base Path
# ============================================

reset_web_base_path() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Reset Web Base Path                             ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local current_path
  current_path="$(get_panel_path)"
  echo -e "  Current path: ${BLUE}${current_path:-/}${NC}"
  echo ""

  local new_path=""
  read -r -p "  Enter new path (leave empty to auto-generate, 'none' for no path): " new_path

  if [ "$new_path" = "none" ]; then
    new_path=""
    echo -e "${BLUE}[*]${NC} Removing panel path (panel will be at root /)"
  elif [ -z "$new_path" ]; then
    new_path="/$(openssl rand -hex 4)"
    echo -e "${BLUE}[*]${NC} Generated new path: ${GREEN}${new_path}${NC}"
  else
    # Ensure path starts with /
    if [[ ! "$new_path" =~ ^/ ]]; then
      new_path="/${new_path}"
    fi
    # Remove trailing slashes
    new_path="${new_path%/}"
  fi

  if ! confirm "Set panel path to '${new_path:-/}'?"; then
    return
  fi

  cd "$ROOT_DIR"

  # Update .panel_path file
  echo "${new_path}" > "$ROOT_DIR/.panel_path"

  # Update backend .env
  if [ -f "$ROOT_DIR/backend/.env" ]; then
    if grep -q '^PANEL_PATH=' "$ROOT_DIR/backend/.env"; then
      sed -i "s|^PANEL_PATH=.*|PANEL_PATH=${new_path}|" "$ROOT_DIR/backend/.env"
    else
      echo "PANEL_PATH=${new_path}" >> "$ROOT_DIR/backend/.env"
    fi
  fi

  # Rebuild frontend with new path
  echo -e "${BLUE}[*]${NC} Rebuilding frontend with new path..."
  docker run --rm \
    -v "${ROOT_DIR}:/work" \
    -w /work/frontend \
    node:20-alpine \
    sh -lc "set -e; npm ci --loglevel=error; VITE_API_URL=${new_path}/api VITE_PANEL_PATH=${new_path} npm run build"

  rm -rf "${ROOT_DIR}/backend/public"
  mkdir -p "${ROOT_DIR}/backend/public"
  cp -R "${ROOT_DIR}/frontend/dist/." "${ROOT_DIR}/backend/public/"

  # Restart backend
  echo -e "${BLUE}[*]${NC} Restarting backend..."
  compose restart backend

  sleep 3
  echo ""
  echo -e "${GREEN}[✓]${NC} Web base path updated!"
  echo -e "${CYAN}│${NC}  New path: ${GREEN}${new_path:-/}${NC}"
  echo -e "${CYAN}│${NC}  Panel URL: ${GREEN}$(get_panel_url)${NC}"
  echo ""
}

# ============================================
# 7. Reset Settings
# ============================================

reset_settings() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Reset Settings to Defaults                      ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}[!]${NC} This will reset backend/.env to default values."
  echo -e "${YELLOW}[!]${NC} Database credentials and JWT secret will be preserved."
  echo ""

  if ! confirm "Reset all settings to defaults?"; then
    return
  fi

  cd "$ROOT_DIR"

  # Preserve critical values
  local db_url jwt_secret panel_port panel_path
  db_url="$(grep -oP '^DATABASE_URL=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"
  jwt_secret="$(grep -oP '^JWT_SECRET=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"
  panel_port="$(get_panel_port)"
  panel_path="$(get_panel_path)"

  # Backup current env
  cp "$ROOT_DIR/backend/.env" "$ROOT_DIR/backend/.env.before-reset.$(date +%Y%m%d%H%M%S)"

  # Reset to example if available
  if [ -f "$ROOT_DIR/backend/.env.example" ]; then
    cp "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env"
  fi

  # Restore critical values
  if [ -n "$db_url" ]; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${db_url}|" "$ROOT_DIR/backend/.env"
  fi
  if [ -n "$jwt_secret" ]; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${jwt_secret}|" "$ROOT_DIR/backend/.env"
  fi
  sed -i "s|^PORT=.*|PORT=${panel_port}|" "$ROOT_DIR/backend/.env"
  if grep -q '^PANEL_PATH=' "$ROOT_DIR/backend/.env"; then
    sed -i "s|^PANEL_PATH=.*|PANEL_PATH=${panel_path}|" "$ROOT_DIR/backend/.env"
  else
    echo "PANEL_PATH=${panel_path}" >> "$ROOT_DIR/backend/.env"
  fi

  # Restart
  echo -e "${BLUE}[*]${NC} Restarting services..."
  compose restart backend

  sleep 3
  echo -e "${GREEN}[✓]${NC} Settings reset to defaults."
  echo -e "${YELLOW}[!]${NC} Previous settings backed up in backend/.env.before-reset.*"
}

# ============================================
# 8. Change Port
# ============================================

change_port() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Change Panel Port                               ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local current_port new_port
  current_port="$(get_panel_port)"
  echo -e "  Current port: ${BLUE}${current_port}${NC}"
  echo ""

  read -r -p "  Enter new port (or 'random' for auto-assign): " new_port

  if [ "$new_port" = "random" ]; then
    new_port="$(find_available_port)"
    echo -e "${BLUE}[*]${NC} Auto-assigned port: ${GREEN}${new_port}${NC}"
  fi

  if [ -z "$new_port" ]; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  # Validate port
  if ! [[ "$new_port" =~ ^[0-9]+$ ]] || [ "$new_port" -lt 1 ] || [ "$new_port" -gt 65535 ]; then
    echo -e "${RED}[✗]${NC} Invalid port: ${new_port}"
    return
  fi

  if [ "$new_port" = "$current_port" ]; then
    echo -e "${YELLOW}[!]${NC} Port is already ${new_port}."
    return
  fi

  # Check if port is in use
  if is_port_in_use "$new_port"; then
    echo -e "${RED}[✗]${NC} Port ${new_port} is already in use by another service."
    return
  fi

  if ! confirm "Change port from ${current_port} to ${new_port}?"; then
    return
  fi

  cd "$ROOT_DIR"

  # Update .panel_port
  echo "${new_port}" > "$ROOT_DIR/.panel_port"

  # Update backend/.env
  if [ -f "$ROOT_DIR/backend/.env" ]; then
    sed -i "s|^PORT=.*|PORT=${new_port}|" "$ROOT_DIR/backend/.env"

    # Update CORS_ORIGIN if it contains the old port
    sed -i "s|:${current_port}|:${new_port}|g" "$ROOT_DIR/backend/.env"
  fi

  # Update firewall
  if command -v ufw >/dev/null 2>&1; then
    ufw delete allow "${current_port}/tcp" 2>/dev/null || true
    ufw allow "${new_port}/tcp" 2>/dev/null || true
    echo -e "${BLUE}[*]${NC} Firewall updated: ${current_port} → ${new_port}"
  fi

  # Restart
  echo -e "${BLUE}[*]${NC} Restarting services..."
  compose restart backend

  sleep 3
  echo ""
  echo -e "${GREEN}[✓]${NC} Port changed!"
  echo -e "${CYAN}│${NC}  New port: ${GREEN}${new_port}${NC}"
  echo -e "${CYAN}│${NC}  Panel URL: ${GREEN}$(get_panel_url)${NC}"
  echo ""
}

# ============================================
# 9. View Current Settings
# ============================================

view_settings() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Current Settings                                ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local port path server_ip panel_url
  port="$(get_panel_port)"
  path="$(get_panel_path)"
  server_ip="$(get_server_ip)"
  panel_url="$(get_panel_url)"

  echo -e "${YELLOW}  Panel Configuration:${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo -e "  Port:          ${GREEN}${port}${NC}"
  echo -e "  Path:          ${GREEN}${path:-/}${NC}"
  echo -e "  Panel URL:     ${GREEN}${panel_url}${NC}"
  echo -e "  Server IP:     ${GREEN}${server_ip}${NC}"
  echo -e "  Install Dir:   ${GREEN}${ROOT_DIR}${NC}"
  echo ""

  if [ -f "$ROOT_DIR/backend/.env" ]; then
    echo -e "${YELLOW}  Backend Environment:${NC}"
    echo -e "  ─────────────────────────────────────────"

    local node_env jwt_expiry rate_limit ssl_enabled ssl_domain telegram_enabled
    local xray_deployment backup_enabled

    node_env="$(grep -oP '^NODE_ENV=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "N/A")"
    jwt_expiry="$(grep -oP '^JWT_EXPIRY=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "N/A")"
    rate_limit="$(grep -oP '^RATE_LIMIT_MAX_REQUESTS=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "N/A")"
    ssl_enabled="$(grep -oP '^SSL_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"
    ssl_domain="$(grep -oP '^SSL_DOMAIN=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "N/A")"
    telegram_enabled="$(grep -oP '^TELEGRAM_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"
    xray_deployment="$(grep -oP '^XRAY_DEPLOYMENT=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "N/A")"
    backup_enabled="$(grep -oP '^BACKUP_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"

    echo -e "  Environment:   ${BLUE}${node_env}${NC}"
    echo -e "  JWT Expiry:    ${BLUE}${jwt_expiry}${NC}"
    echo -e "  Rate Limit:    ${BLUE}${rate_limit} req/window${NC}"
    echo -e "  SSL Enabled:   ${BLUE}${ssl_enabled}${NC}"
    echo -e "  SSL Domain:    ${BLUE}${ssl_domain}${NC}"
    echo -e "  Telegram:      ${BLUE}${telegram_enabled}${NC}"
    echo -e "  Xray Deploy:   ${BLUE}${xray_deployment}${NC}"
    echo -e "  Backup:        ${BLUE}${backup_enabled}${NC}"
  fi

  echo ""

  # Docker container info
  echo -e "${YELLOW}  Docker Containers:${NC}"
  echo -e "  ─────────────────────────────────────────"
  docker ps --format "  {{.Names}}\t{{.Status}}\t{{.Ports}}" --filter "name=one-ui" --filter "name=xray" 2>/dev/null || echo "  No containers found."
  echo ""
}

# ============================================
# 10. Service Management
# ============================================

start_services() {
  echo -e "${BLUE}[*]${NC} Starting One-UI services..."
  cd "$ROOT_DIR"
  compose up -d
  sleep 3
  if docker ps --format '{{.Names}}' | grep -qFx "one-ui-backend"; then
    echo -e "${GREEN}[✓]${NC} One-UI started successfully"
  else
    echo -e "${RED}[✗]${NC} Failed to start One-UI"
    compose logs --tail=20 backend
  fi
}

stop_services() {
  echo -e "${BLUE}[*]${NC} Stopping One-UI services..."
  cd "$ROOT_DIR"
  compose down
  echo -e "${GREEN}[✓]${NC} One-UI stopped"
}

restart_services() {
  echo -e "${BLUE}[*]${NC} Restarting One-UI services..."
  cd "$ROOT_DIR"
  compose restart
  sleep 3
  if docker ps --format '{{.Names}}' | grep -qFx "one-ui-backend"; then
    echo -e "${GREEN}[✓]${NC} One-UI restarted successfully"
  else
    echo -e "${RED}[✗]${NC} Failed to restart One-UI"
    compose logs --tail=20 backend
  fi
}

# ============================================
# 11. Logs Management
# ============================================

show_logs_menu() {
  echo ""
  echo -e "${CYAN}  Logs Management${NC}"
  echo -e "${CYAN}  ─────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN}1)${NC} All logs"
  echo -e "  ${GREEN}2)${NC} Backend logs"
  echo -e "  ${GREEN}3)${NC} Database logs"
  echo -e "  ${GREEN}4)${NC} Xray logs"
  echo -e "  ${GREEN}5)${NC} Xray access log"
  echo -e "  ${GREEN}6)${NC} Xray error log"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-6]: " log_choice

  cd "$ROOT_DIR"

  case "${log_choice}" in
    1)
      echo -e "${CYAN}Showing all logs (Ctrl+C to exit)${NC}"
      compose logs -f --tail=100
      ;;
    2)
      echo -e "${CYAN}Showing backend logs (Ctrl+C to exit)${NC}"
      compose logs -f --tail=100 backend
      ;;
    3)
      echo -e "${CYAN}Showing database logs (Ctrl+C to exit)${NC}"
      compose logs -f --tail=100 db
      ;;
    4)
      echo -e "${CYAN}Showing Xray logs (Ctrl+C to exit)${NC}"
      compose logs -f --tail=100 xray
      ;;
    5)
      echo -e "${CYAN}Showing Xray access log (Ctrl+C to exit)${NC}"
      if [ -f /var/log/xray/access.log ]; then
        tail -f /var/log/xray/access.log
      else
        docker exec "$CONTAINER_NAME" tail -f /var/log/xray/access.log 2>/dev/null || echo -e "${YELLOW}[!]${NC} Access log not found."
      fi
      ;;
    6)
      echo -e "${CYAN}Showing Xray error log (Ctrl+C to exit)${NC}"
      if [ -f /var/log/xray/error.log ]; then
        tail -f /var/log/xray/error.log
      else
        docker exec "$CONTAINER_NAME" tail -f /var/log/xray/error.log 2>/dev/null || echo -e "${YELLOW}[!]${NC} Error log not found."
      fi
      ;;
    0|"")
      return
      ;;
    *)
      echo -e "${RED}Invalid option.${NC}"
      ;;
  esac
}

# ============================================
# 12. Enable / Disable Autostart
# ============================================

enable_autostart() {
  echo -e "${BLUE}[*]${NC} Enabling auto-start for One-UI containers..."
  cd "$ROOT_DIR"

  for svc in backend db xray; do
    local container_name
    container_name="$(compose ps -q "$svc" 2>/dev/null || echo "")"
    if [ -n "$container_name" ]; then
      docker update --restart=always "$container_name" >/dev/null 2>&1
    fi
  done

  echo -e "${GREEN}[✓]${NC} Auto-start enabled. Containers will restart automatically on boot."
}

disable_autostart() {
  echo -e "${BLUE}[*]${NC} Disabling auto-start for One-UI containers..."
  cd "$ROOT_DIR"

  for svc in backend db xray; do
    local container_name
    container_name="$(compose ps -q "$svc" 2>/dev/null || echo "")"
    if [ -n "$container_name" ]; then
      docker update --restart=no "$container_name" >/dev/null 2>&1
    fi
  done

  echo -e "${GREEN}[✓]${NC} Auto-start disabled. Containers will NOT restart on boot."
}

# ============================================
# 13. SSL Certificate Management
# ============================================

ssl_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              SSL Certificate Management                      ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${GREEN}1)${NC} Issue new SSL certificate (Let's Encrypt + Cloudflare DNS)"
  echo -e "  ${GREEN}2)${NC} Renew existing certificate"
  echo -e "  ${GREEN}3)${NC} View certificate info"
  echo -e "  ${GREEN}4)${NC} Remove SSL certificate"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-4]: " ssl_choice

  case "${ssl_choice}" in
    1) ssl_issue ;;
    2) ssl_renew ;;
    3) ssl_info ;;
    4) ssl_remove ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

ssl_issue() {
  echo ""
  local domain=""
  local email=""

  read -r -p "  Enter domain name (e.g., panel.example.com): " domain
  if [ -z "$domain" ]; then
    echo -e "${RED}[✗]${NC} Domain name is required."
    return
  fi

  read -r -p "  Enter email for SSL notifications [admin@${domain}]: " email
  email="${email:-admin@${domain}}"

  # Check for Cloudflare credentials in .env
  local cf_token cf_email cf_key
  cf_token="$(grep -oP '^CLOUDFLARE_API_TOKEN=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"
  cf_email="$(grep -oP '^CLOUDFLARE_EMAIL=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"
  cf_key="$(grep -oP '^CLOUDFLARE_API_KEY=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"

  if [ -z "$cf_token" ] && { [ -z "$cf_email" ] || [ -z "$cf_key" ]; }; then
    echo ""
    echo -e "${YELLOW}[!]${NC} Cloudflare credentials not found in backend/.env"
    echo -e "${YELLOW}[!]${NC} You need to provide Cloudflare API credentials for DNS validation."
    echo ""

    local use_token=""
    read -r -p "  Use API Token (recommended) instead of Global API Key? [Y/n]: " use_token

    case "${use_token}" in
      [nN]|[nN][oO])
        read -r -p "  Enter Cloudflare email: " cf_email
        read -r -p "  Enter Cloudflare Global API Key: " cf_key
        ;;
      *)
        read -r -p "  Enter Cloudflare API Token: " cf_token
        ;;
    esac
  fi

  # Install acme.sh if needed
  if [ ! -x "/root/.acme.sh/acme.sh" ]; then
    echo -e "${BLUE}[*]${NC} Installing acme.sh..."
    curl -fsSL https://get.acme.sh | sh -s email="${email}"
  fi

  # Set Cloudflare credentials
  if [ -n "$cf_token" ]; then
    export CF_Token="${cf_token}"
  fi
  if [ -n "$cf_email" ]; then
    export CF_Email="${cf_email}"
  fi
  if [ -n "$cf_key" ]; then
    export CF_Key="${cf_key}"
  fi

  mkdir -p "${DATA_DIR}/certs"

  echo -e "${BLUE}[*]${NC} Issuing SSL certificate for ${domain}..."
  /root/.acme.sh/acme.sh --issue --dns dns_cf -d "${domain}" -d "*.${domain}" --force

  echo -e "${BLUE}[*]${NC} Installing certificate..."
  /root/.acme.sh/acme.sh --install-cert -d "${domain}" \
    --cert-file "${DATA_DIR}/certs/cert.pem" \
    --key-file "${DATA_DIR}/certs/key.pem" \
    --fullchain-file "${DATA_DIR}/certs/fullchain.pem" \
    --reloadcmd "cd \"${ROOT_DIR}\" && (docker compose restart backend xray 2>/dev/null || docker-compose restart backend xray 2>/dev/null || true)"

  # Update backend .env (set_env_var creates keys that don't exist yet)
  local env_file="$ROOT_DIR/backend/.env"
  set_env_var "$env_file" "SSL_ENABLED" "true"
  set_env_var "$env_file" "SSL_DOMAIN" "${domain}"
  set_env_var "$env_file" "SSL_EMAIL" "${email}"

  if [ -n "$cf_token" ]; then
    set_env_var "$env_file" "CLOUDFLARE_API_TOKEN" "${cf_token}"
  fi
  if [ -n "$cf_email" ]; then
    set_env_var "$env_file" "CLOUDFLARE_EMAIL" "${cf_email}"
    set_env_var "$env_file" "CLOUDFLARE_ACCOUNT_EMAIL" "${cf_email}"
  fi
  if [ -n "$cf_key" ]; then
    set_env_var "$env_file" "CLOUDFLARE_API_KEY" "${cf_key}"
  fi

  echo -e "${BLUE}[*]${NC} Restarting services..."
  cd "$ROOT_DIR"
  compose restart backend xray

  echo ""
  echo -e "${GREEN}[✓]${NC} SSL certificate issued and installed!"
  ssl_info
}

ssl_renew() {
  echo -e "${BLUE}[*]${NC} Renewing SSL certificates..."

  if [ ! -x "/root/.acme.sh/acme.sh" ]; then
    echo -e "${RED}[✗]${NC} acme.sh not installed. Issue a certificate first."
    return
  fi

  /root/.acme.sh/acme.sh --renew-all --force

  echo -e "${BLUE}[*]${NC} Restarting services..."
  cd "$ROOT_DIR"
  compose restart backend xray

  echo -e "${GREEN}[✓]${NC} SSL certificates renewed."
}

ssl_info() {
  echo ""
  if [ -f "${DATA_DIR}/certs/fullchain.pem" ]; then
    echo -e "${YELLOW}  SSL Certificate Information:${NC}"
    echo -e "  ─────────────────────────────────────────"
    openssl x509 -in "${DATA_DIR}/certs/fullchain.pem" -noout \
      -subject -issuer -dates -serial 2>/dev/null | while read -r line; do
      echo -e "  ${line}"
    done
    echo ""

    # Check expiry
    local expiry_epoch now_epoch days_left
    expiry_epoch="$(date -d "$(openssl x509 -in "${DATA_DIR}/certs/fullchain.pem" -noout -enddate 2>/dev/null | sed 's/.*=//')" +%s 2>/dev/null || echo 0)"
    now_epoch="$(date +%s)"
    if [ "$expiry_epoch" -gt 0 ]; then
      days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
      if [ "$days_left" -lt 7 ]; then
        echo -e "  Days until expiry: ${RED}${days_left} days${NC} (RENEW NOW!)"
      elif [ "$days_left" -lt 30 ]; then
        echo -e "  Days until expiry: ${YELLOW}${days_left} days${NC}"
      else
        echo -e "  Days until expiry: ${GREEN}${days_left} days${NC}"
      fi
    fi
  else
    echo -e "${YELLOW}[!]${NC} No SSL certificate found at ${DATA_DIR}/certs/"
  fi
  echo ""
}

ssl_remove() {
  echo -e "${YELLOW}[!]${NC} This will remove the SSL certificate and disable SSL."

  if ! confirm "Remove SSL certificate?"; then
    return
  fi

  rm -f "${DATA_DIR}/certs/cert.pem" 2>/dev/null || true
  rm -f "${DATA_DIR}/certs/key.pem" 2>/dev/null || true
  rm -f "${DATA_DIR}/certs/fullchain.pem" 2>/dev/null || true

  set_env_var "$ROOT_DIR/backend/.env" "SSL_ENABLED" "false"

  cd "$ROOT_DIR"
  compose restart backend

  echo -e "${GREEN}[✓]${NC} SSL certificate removed and SSL disabled."
}

# ============================================
# 14. Cloudflare SSL Certificate
# ============================================

cloudflare_ssl() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Cloudflare SSL Certificate                      ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}  This will:${NC}"
  echo "  • Configure Cloudflare API credentials"
  echo "  • Issue a wildcard SSL certificate via DNS validation"
  echo "  • Auto-renew certificates using acme.sh"
  echo ""

  local domain=""
  local email=""
  local cf_token=""

  read -r -p "  Enter your domain (e.g., example.com): " domain
  if [ -z "$domain" ]; then
    echo -e "${RED}[✗]${NC} Domain is required."
    return
  fi

  read -r -p "  Enter email [admin@${domain}]: " email
  email="${email:-admin@${domain}}"

  echo ""
  echo -e "${YELLOW}  Cloudflare API Token is recommended over Global API Key.${NC}"
  echo -e "${YELLOW}  Create one at: https://dash.cloudflare.com/profile/api-tokens${NC}"
  echo -e "${YELLOW}  Required permissions: Zone:DNS:Edit${NC}"
  echo ""

  read -r -p "  Enter Cloudflare API Token: " cf_token
  if [ -z "$cf_token" ]; then
    echo -e "${RED}[✗]${NC} Cloudflare API Token is required."
    return
  fi

  local cf_zone_id=""
  read -r -p "  Enter Cloudflare Zone ID (optional, press Enter to skip): " cf_zone_id

  # Install acme.sh
  if [ ! -x "/root/.acme.sh/acme.sh" ]; then
    echo -e "${BLUE}[*]${NC} Installing acme.sh..."
    curl -fsSL https://get.acme.sh | sh -s email="${email}"
  fi

  # Set credentials
  export CF_Token="${cf_token}"
  if [ -n "$cf_zone_id" ]; then
    export CF_Zone_ID="${cf_zone_id}"
  fi

  mkdir -p "${DATA_DIR}/certs"

  echo -e "${BLUE}[*]${NC} Issuing wildcard SSL certificate for ${domain}..."
  if /root/.acme.sh/acme.sh --issue --dns dns_cf -d "${domain}" -d "*.${domain}" --force; then
    echo -e "${GREEN}[✓]${NC} Certificate issued!"
  else
    echo -e "${RED}[✗]${NC} Certificate issuance failed. Check your Cloudflare credentials."
    return
  fi

  echo -e "${BLUE}[*]${NC} Installing certificate..."
  /root/.acme.sh/acme.sh --install-cert -d "${domain}" \
    --cert-file "${DATA_DIR}/certs/cert.pem" \
    --key-file "${DATA_DIR}/certs/key.pem" \
    --fullchain-file "${DATA_DIR}/certs/fullchain.pem" \
    --reloadcmd "cd \"${ROOT_DIR}\" && (docker compose restart backend xray 2>/dev/null || docker-compose restart backend xray 2>/dev/null || true)"

  # Update backend .env (set_env_var creates keys that don't exist yet)
  if [ -f "$ROOT_DIR/backend/.env" ]; then
    local env_file="$ROOT_DIR/backend/.env"
    set_env_var "$env_file" "SSL_ENABLED" "true"
    set_env_var "$env_file" "SSL_DOMAIN" "${domain}"
    set_env_var "$env_file" "SSL_EMAIL" "${email}"
    set_env_var "$env_file" "CLOUDFLARE_API_TOKEN" "${cf_token}"
    if [ -n "$cf_zone_id" ]; then
      set_env_var "$env_file" "CLOUDFLARE_ZONE_ID" "${cf_zone_id}"
    fi
  fi

  echo -e "${BLUE}[*]${NC} Restarting services..."
  cd "$ROOT_DIR"
  compose restart backend xray

  echo ""
  echo -e "${GREEN}[✓]${NC} Cloudflare SSL configured successfully!"
  ssl_info
}

# ============================================
# 15. IP Limit Management
# ============================================

ip_limit_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              IP Limit Management                             ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${GREEN}1)${NC} View current IP rules"
  echo -e "  ${GREEN}2)${NC} Block an IP address"
  echo -e "  ${GREEN}3)${NC} Block an IP range (CIDR)"
  echo -e "  ${GREEN}4)${NC} Block a country"
  echo -e "  ${GREEN}5)${NC} Whitelist an IP address"
  echo -e "  ${GREEN}6)${NC} Remove a rule"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-6]: " ip_choice

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  # Get admin token for API calls
  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate. Make sure the backend is running."
    return
  fi

  case "${ip_choice}" in
    1)
      echo ""
      echo -e "${BLUE}[*]${NC} Current security rules:"
      echo ""
      curl -s -H "Authorization: Bearer ${token}" "${api_base}/security-rules" 2>/dev/null | \
        python3 -m json.tool 2>/dev/null || \
        curl -s -H "Authorization: Bearer ${token}" "${api_base}/security-rules" 2>/dev/null
      echo ""
      ;;
    2)
      local block_ip=""
      read -r -p "  Enter IP address to block: " block_ip
      if [ -n "$block_ip" ]; then
        curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
          -d "{\"type\":\"IP\",\"value\":\"${block_ip}\",\"action\":\"BLOCK\",\"enabled\":true}" \
          "${api_base}/security-rules" 2>/dev/null
        echo ""
        echo -e "${GREEN}[✓]${NC} IP ${block_ip} blocked."
      fi
      ;;
    3)
      local block_cidr=""
      read -r -p "  Enter CIDR range to block (e.g., 192.168.1.0/24): " block_cidr
      if [ -n "$block_cidr" ]; then
        curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
          -d "{\"type\":\"CIDR\",\"value\":\"${block_cidr}\",\"action\":\"BLOCK\",\"enabled\":true}" \
          "${api_base}/security-rules" 2>/dev/null
        echo ""
        echo -e "${GREEN}[✓]${NC} CIDR ${block_cidr} blocked."
      fi
      ;;
    4)
      local block_country=""
      read -r -p "  Enter country code to block (e.g., CN, RU, IR): " block_country
      if [ -n "$block_country" ]; then
        curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
          -d "{\"type\":\"COUNTRY\",\"value\":\"${block_country}\",\"action\":\"BLOCK\",\"enabled\":true}" \
          "${api_base}/security-rules" 2>/dev/null
        echo ""
        echo -e "${GREEN}[✓]${NC} Country ${block_country} blocked."
      fi
      ;;
    5)
      local whitelist_ip=""
      read -r -p "  Enter IP address to whitelist: " whitelist_ip
      if [ -n "$whitelist_ip" ]; then
        curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
          -d "{\"type\":\"IP\",\"value\":\"${whitelist_ip}\",\"action\":\"ALLOW\",\"enabled\":true}" \
          "${api_base}/security-rules" 2>/dev/null
        echo ""
        echo -e "${GREEN}[✓]${NC} IP ${whitelist_ip} whitelisted."
      fi
      ;;
    6)
      local rule_id=""
      echo -e "${BLUE}[*]${NC} Current rules:"
      curl -s -H "Authorization: Bearer ${token}" "${api_base}/security-rules" 2>/dev/null | \
        python3 -m json.tool 2>/dev/null || \
        curl -s -H "Authorization: Bearer ${token}" "${api_base}/security-rules" 2>/dev/null
      echo ""
      read -r -p "  Enter rule ID to remove: " rule_id
      if [ -n "$rule_id" ]; then
        curl -s -X DELETE -H "Authorization: Bearer ${token}" "${api_base}/security-rules/${rule_id}" 2>/dev/null
        echo ""
        echo -e "${GREEN}[✓]${NC} Rule ${rule_id} removed."
      fi
      ;;
    0|"")
      return
      ;;
    *)
      echo -e "${RED}Invalid option.${NC}"
      ;;
  esac
}

# Helper: Get admin JWT token for API calls
get_admin_token() {
  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  # Try to get credentials from env or prompt
  local admin_user admin_pass
  admin_user="$(grep -oP '^ADMIN_USERNAME=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "admin")"

  # Get token using a stored credential file or prompt
  if [ -f "$ROOT_DIR/.admin_token" ]; then
    local cached_token
    cached_token="$(cat "$ROOT_DIR/.admin_token" 2>/dev/null)"
    # Verify token is still valid
    local verify_status
    verify_status="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${cached_token}" "${api_base}/system/health" 2>/dev/null || echo "000")"
    if [ "$verify_status" = "200" ]; then
      echo "$cached_token"
      return
    fi
  fi

  # Prompt for credentials
  local login_user=""
  local login_pass=""
  read -r -p "  Admin username [admin]: " login_user
  login_user="${login_user:-admin}"
  read -r -s -p "  Admin password: " login_pass
  echo ""

  if [ -z "$login_pass" ]; then
    return
  fi

  local response
  response="$(curl -s -X POST -H "Content-Type: application/json" \
    -d "{\"username\":\"${login_user}\",\"password\":\"${login_pass}\"}" \
    "${api_base}/auth/login" 2>/dev/null)"

  local token
  token="$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || \
           echo "$response" | grep -oP '"token"\s*:\s*"\K[^"]+' 2>/dev/null || echo "")"

  if [ -n "$token" ]; then
    echo "$token" > "$ROOT_DIR/.admin_token"
    chmod 600 "$ROOT_DIR/.admin_token"
    echo "$token"
  fi
}

# ============================================
# 16. Firewall Management
# ============================================

firewall_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Firewall Management                             ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  if ! command -v ufw >/dev/null 2>&1; then
    echo -e "${YELLOW}[!]${NC} UFW (Uncomplicated Firewall) is not installed."
    if confirm "Install UFW?"; then
      apt-get install -y -qq ufw
    else
      return
    fi
  fi

  echo -e "  ${GREEN}1)${NC} View firewall status"
  echo -e "  ${GREEN}2)${NC} Enable firewall"
  echo -e "  ${GREEN}3)${NC} Disable firewall"
  echo -e "  ${GREEN}4)${NC} Allow a port"
  echo -e "  ${GREEN}5)${NC} Deny a port"
  echo -e "  ${GREEN}6)${NC} Delete a rule"
  echo -e "  ${GREEN}7)${NC} Reset to defaults (SSH + Panel port)"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-7]: " fw_choice

  case "${fw_choice}" in
    1)
      echo ""
      ufw status verbose
      echo ""
      ;;
    2)
      echo -e "${BLUE}[*]${NC} Enabling firewall..."
      # Always allow SSH first
      ufw allow 22/tcp 2>/dev/null || true
      ufw allow "$(get_panel_port)/tcp" 2>/dev/null || true
      ufw --force enable
      echo -e "${GREEN}[✓]${NC} Firewall enabled."
      ;;
    3)
      if confirm "Disable firewall? This removes all protection."; then
        ufw disable
        echo -e "${GREEN}[✓]${NC} Firewall disabled."
      fi
      ;;
    4)
      local allow_port=""
      read -r -p "  Enter port to allow (e.g., 443): " allow_port
      if [ -n "$allow_port" ]; then
        local protocol=""
        read -r -p "  Protocol [tcp/udp/both] (default: tcp): " protocol
        protocol="${protocol:-tcp}"
        if [ "$protocol" = "both" ]; then
          ufw allow "$allow_port"
        else
          ufw allow "${allow_port}/${protocol}"
        fi
        echo -e "${GREEN}[✓]${NC} Port ${allow_port}/${protocol} allowed."
      fi
      ;;
    5)
      local deny_port=""
      read -r -p "  Enter port to deny: " deny_port
      if [ -n "$deny_port" ]; then
        ufw deny "${deny_port}/tcp"
        echo -e "${GREEN}[✓]${NC} Port ${deny_port} denied."
      fi
      ;;
    6)
      echo ""
      ufw status numbered
      echo ""
      local rule_num=""
      read -r -p "  Enter rule number to delete: " rule_num
      if [ -n "$rule_num" ]; then
        ufw --force delete "$rule_num"
        echo -e "${GREEN}[✓]${NC} Rule deleted."
      fi
      ;;
    7)
      if confirm "Reset firewall to defaults? Only SSH (22) and panel port will be allowed."; then
        ufw --force reset
        ufw default deny incoming
        ufw default allow outgoing
        ufw allow 22/tcp
        ufw allow 80/tcp
        ufw allow 443/tcp
        ufw allow "$(get_panel_port)/tcp"
        ufw --force enable
        echo -e "${GREEN}[✓]${NC} Firewall reset to defaults."
        ufw status
      fi
      ;;
    0|"")
      return
      ;;
    *)
      echo -e "${RED}Invalid option.${NC}"
      ;;
  esac
}

# ============================================
# 17. SSH Port Forwarding Management
# ============================================

ssh_forwarding_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              SSH Port Forwarding Management                  ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${GREEN}1)${NC} Show SSH tunnel command (local port forwarding)"
  echo -e "  ${GREEN}2)${NC} Show reverse tunnel command"
  echo -e "  ${GREEN}3)${NC} Configure SSH for tunneling"
  echo -e "  ${GREEN}4)${NC} View active SSH tunnels"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-4]: " ssh_choice

  local port server_ip
  port="$(get_panel_port)"
  server_ip="$(get_server_ip)"

  case "${ssh_choice}" in
    1)
      echo ""
      echo -e "${YELLOW}  Local Port Forwarding:${NC}"
      echo -e "  ─────────────────────────────────────────"
      echo ""
      echo -e "  Access One-UI panel through SSH tunnel."
      echo -e "  Run this on your ${GREEN}local machine${NC}:"
      echo ""
      echo -e "  ${CYAN}ssh -L 8080:127.0.0.1:${port} root@${server_ip}${NC}"
      echo ""
      echo -e "  Then open: ${GREEN}http://localhost:8080$(get_panel_path)/${NC}"
      echo ""
      echo -e "${YELLOW}  Options:${NC}"
      echo -e "  ${CYAN}ssh -L 8080:127.0.0.1:${port} -N -f root@${server_ip}${NC}"
      echo -e "  (-N = no shell, -f = background)"
      echo ""
      ;;
    2)
      echo ""
      echo -e "${YELLOW}  Reverse Port Forwarding:${NC}"
      echo -e "  ─────────────────────────────────────────"
      echo ""
      echo -e "  Expose local panel to a remote server."
      echo -e "  Run this on the ${GREEN}VPS${NC}:"
      echo ""
      local remote_port=""
      read -r -p "  Remote port to expose on [8080]: " remote_port
      remote_port="${remote_port:-8080}"
      echo ""
      echo -e "  ${CYAN}ssh -R ${remote_port}:127.0.0.1:${port} root@<remote-server-ip>${NC}"
      echo ""
      echo -e "  The panel will be accessible on the remote server at:"
      echo -e "  ${GREEN}http://remote-server:${remote_port}$(get_panel_path)/${NC}"
      echo ""
      ;;
    3)
      echo ""
      echo -e "${YELLOW}  Configuring SSH for tunneling...${NC}"
      echo ""

      # Enable GatewayPorts and AllowTcpForwarding
      local sshd_config="/etc/ssh/sshd_config"
      if [ -f "$sshd_config" ]; then
        # Check current settings
        local gateway_ports tcp_forwarding
        gateway_ports="$(grep -i '^GatewayPorts' "$sshd_config" 2>/dev/null | awk '{print $2}' || echo "no")"
        tcp_forwarding="$(grep -i '^AllowTcpForwarding' "$sshd_config" 2>/dev/null | awk '{print $2}' || echo "yes")"

        echo -e "  Current settings:"
        echo -e "  GatewayPorts:       ${BLUE}${gateway_ports:-not set (default: no)}${NC}"
        echo -e "  AllowTcpForwarding: ${BLUE}${tcp_forwarding:-not set (default: yes)}${NC}"
        echo ""

        if confirm "Enable GatewayPorts (allows remote hosts to connect to forwarded ports)?"; then
          if grep -qi '^GatewayPorts' "$sshd_config"; then
            sed -i 's/^GatewayPorts.*/GatewayPorts yes/i' "$sshd_config"
          else
            echo "GatewayPorts yes" >> "$sshd_config"
          fi
          echo -e "${GREEN}[✓]${NC} GatewayPorts enabled."
        fi

        if grep -qi '^AllowTcpForwarding.*no' "$sshd_config"; then
          if confirm "AllowTcpForwarding is disabled. Enable it?"; then
            sed -i 's/^AllowTcpForwarding.*/AllowTcpForwarding yes/i' "$sshd_config"
            echo -e "${GREEN}[✓]${NC} AllowTcpForwarding enabled."
          fi
        fi

        echo -e "${BLUE}[*]${NC} Restarting SSH service..."
        systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true
        echo -e "${GREEN}[✓]${NC} SSH configuration updated."
      else
        echo -e "${RED}[✗]${NC} SSH config not found at ${sshd_config}"
      fi
      ;;
    4)
      echo ""
      echo -e "${YELLOW}  Active SSH Tunnels:${NC}"
      echo -e "  ─────────────────────────────────────────"
      echo ""
      # Show SSH connections with port forwarding
      if command -v ss >/dev/null 2>&1; then
        ss -tnp 2>/dev/null | grep "ssh" || echo "  No active SSH tunnels found."
      elif command -v netstat >/dev/null 2>&1; then
        netstat -tnp 2>/dev/null | grep "ssh" || echo "  No active SSH tunnels found."
      fi
      echo ""
      echo -e "${YELLOW}  Active SSH processes:${NC}"
      ps aux 2>/dev/null | grep "[s]sh.*-[LRD]" || echo "  No SSH tunnel processes found."
      echo ""
      ;;
    0|"")
      return
      ;;
    *)
      echo -e "${RED}Invalid option.${NC}"
      ;;
  esac
}

# ============================================
# 18. Telegram Bot Configuration
# ============================================

telegram_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Telegram Bot Configuration                      ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Show current status
  local tg_enabled tg_token tg_admin_ids tg_polling tg_alerts
  tg_enabled="$(grep -oP '^TELEGRAM_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"
  tg_token="$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"
  tg_admin_ids="$(grep -oP '^TELEGRAM_ADMIN_IDS=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"
  tg_polling="$(grep -oP '^TELEGRAM_POLLING=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "true")"
  tg_alerts="$(grep -oP '^TELEGRAM_ALERTS_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "true")"

  echo -e "${YELLOW}  Current Configuration:${NC}"
  echo -e "  ─────────────────────────────────────────"
  if [ "$tg_enabled" = "true" ]; then
    echo -e "  Status:      ${GREEN}● Enabled${NC}"
  else
    echo -e "  Status:      ${RED}○ Disabled${NC}"
  fi
  if [ -n "$tg_token" ] && [ "$tg_token" != "your_bot_token_from_botfather" ]; then
    echo -e "  Bot Token:   ${GREEN}Configured${NC} (${tg_token:0:10}...)"
  else
    echo -e "  Bot Token:   ${RED}Not configured${NC}"
  fi
  if [ -n "$tg_admin_ids" ]; then
    echo -e "  Admin IDs:   ${GREEN}${tg_admin_ids}${NC}"
  else
    echo -e "  Admin IDs:   ${RED}Not configured${NC}"
  fi
  echo -e "  Polling:     ${BLUE}${tg_polling}${NC}"
  echo -e "  Alerts:      ${BLUE}${tg_alerts}${NC}"
  echo ""

  echo -e "  ${GREEN}1)${NC} Setup Telegram Bot (guided)"
  echo -e "  ${GREEN}2)${NC} Enable Telegram Bot"
  echo -e "  ${GREEN}3)${NC} Disable Telegram Bot"
  echo -e "  ${GREEN}4)${NC} Change Bot Token"
  echo -e "  ${GREEN}5)${NC} Change Admin IDs"
  echo -e "  ${GREEN}6)${NC} Configure Notifications"
  echo -e "  ${GREEN}7)${NC} Test Bot Connection"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-7]: " tg_choice

  case "${tg_choice}" in
    1) telegram_guided_setup ;;
    2) telegram_toggle "true" ;;
    3) telegram_toggle "false" ;;
    4) telegram_change_token ;;
    5) telegram_change_admin_ids ;;
    6) telegram_configure_notifications ;;
    7) telegram_test ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

telegram_guided_setup() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Telegram Bot Setup Guide                        ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}  Step 1: Create a Bot${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo -e "  1. Open Telegram and search for ${CYAN}@BotFather${NC}"
  echo -e "  2. Send ${CYAN}/newbot${NC}"
  echo -e "  3. Choose a name for your bot (e.g., One-UI Panel)"
  echo -e "  4. Choose a username (e.g., oneui_panel_bot)"
  echo -e "  5. Copy the token that BotFather gives you"
  echo ""
  echo -e "${YELLOW}  Step 2: Get Your Telegram ID${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo -e "  1. Search for ${CYAN}@userinfobot${NC} on Telegram"
  echo -e "  2. Send ${CYAN}/start${NC}"
  echo -e "  3. Copy your numeric ID (e.g., 123456789)"
  echo ""

  local bot_token=""
  read -r -p "  Enter Bot Token from @BotFather: " bot_token
  if [ -z "$bot_token" ]; then
    echo -e "${RED}[✗]${NC} Bot token is required."
    return
  fi

  local admin_ids=""
  read -r -p "  Enter your Telegram ID(s) (comma-separated): " admin_ids
  if [ -z "$admin_ids" ]; then
    echo -e "${RED}[✗]${NC} At least one admin ID is required."
    return
  fi

  local bot_username=""
  read -r -p "  Enter bot username (without @) [optional]: " bot_username

  echo ""
  echo -e "${BLUE}[*]${NC} Configuring Telegram bot..."

  # Update .env
  local env_file="$ROOT_DIR/backend/.env"
  sed -i "s|^TELEGRAM_ENABLED=.*|TELEGRAM_ENABLED=true|" "$env_file"
  sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${bot_token}|" "$env_file"
  sed -i "s|^TELEGRAM_ADMIN_IDS=.*|TELEGRAM_ADMIN_IDS=${admin_ids}|" "$env_file"

  if [ -n "$bot_username" ]; then
    if grep -q '^TELEGRAM_BOT_USERNAME=' "$env_file"; then
      sed -i "s|^TELEGRAM_BOT_USERNAME=.*|TELEGRAM_BOT_USERNAME=${bot_username}|" "$env_file"
    else
      echo "TELEGRAM_BOT_USERNAME=${bot_username}" >> "$env_file"
    fi
  fi

  # Ensure polling is enabled
  sed -i "s|^TELEGRAM_POLLING=.*|TELEGRAM_POLLING=true|" "$env_file"
  sed -i "s|^TELEGRAM_ALERTS_ENABLED=.*|TELEGRAM_ALERTS_ENABLED=true|" "$env_file"

  echo -e "${BLUE}[*]${NC} Restarting backend..."
  cd "$ROOT_DIR"
  compose restart backend

  sleep 3

  echo ""
  echo -e "${GREEN}[✓]${NC} Telegram bot configured and enabled!"
  echo ""
  echo -e "${YELLOW}  Available Bot Commands:${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo -e "  ${CYAN}/start${NC}   — Show main menu"
  echo -e "  ${CYAN}/users${NC}   — List all users"
  echo -e "  ${CYAN}/user <id>${NC} — User details"
  echo -e "  ${CYAN}/status${NC}  — System status"
  echo -e "  ${CYAN}/system${NC}  — System overview"
  echo -e "  ${CYAN}/backup${NC}  — Trigger backup"
  echo ""
  echo -e "${YELLOW}  Next Steps:${NC}"
  echo "  • Open Telegram and send /start to your bot"
  echo "  • The bot will show an interactive menu"
  echo "  • You'll receive alerts for user expiry and traffic limits"
  echo ""
}

telegram_toggle() {
  local state="$1"
  local label
  if [ "$state" = "true" ]; then label="Enabling"; else label="Disabling"; fi

  echo -e "${BLUE}[*]${NC} ${label} Telegram bot..."
  set_env_var "$ROOT_DIR/backend/.env" "TELEGRAM_ENABLED" "${state}"

  cd "$ROOT_DIR"
  compose restart backend
  sleep 2

  if [ "$state" = "true" ]; then
    echo -e "${GREEN}[✓]${NC} Telegram bot enabled."
  else
    echo -e "${GREEN}[✓]${NC} Telegram bot disabled."
  fi
}

telegram_change_token() {
  local new_token=""
  read -r -p "  Enter new Bot Token: " new_token
  if [ -z "$new_token" ]; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  set_env_var "$ROOT_DIR/backend/.env" "TELEGRAM_BOT_TOKEN" "${new_token}"

  cd "$ROOT_DIR"
  compose restart backend
  sleep 2
  echo -e "${GREEN}[✓]${NC} Bot token updated."
}

telegram_change_admin_ids() {
  local current_ids
  current_ids="$(grep -oP '^TELEGRAM_ADMIN_IDS=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"
  echo -e "  Current admin IDs: ${BLUE}${current_ids:-none}${NC}"
  echo ""

  local new_ids=""
  read -r -p "  Enter new admin IDs (comma-separated): " new_ids
  if [ -z "$new_ids" ]; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  set_env_var "$ROOT_DIR/backend/.env" "TELEGRAM_ADMIN_IDS" "${new_ids}"

  cd "$ROOT_DIR"
  compose restart backend
  sleep 2
  echo -e "${GREEN}[✓]${NC} Admin IDs updated to: ${new_ids}"
}

telegram_configure_notifications() {
  echo ""
  echo -e "${YELLOW}  Notification Settings:${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo ""

  local env_file="$ROOT_DIR/backend/.env"
  local report_cron expiry_days data_threshold alerts_enabled
  report_cron="$(grep -oP '^TELEGRAM_REPORT_CRON=\K.*' "$env_file" 2>/dev/null || echo "0 9 * * *")"
  expiry_days="$(grep -oP '^TELEGRAM_NOTIFY_EXPIRY_DAYS=\K.*' "$env_file" 2>/dev/null || echo "7")"
  data_threshold="$(grep -oP '^TELEGRAM_NOTIFY_DATA_THRESHOLD=\K.*' "$env_file" 2>/dev/null || echo "10")"
  alerts_enabled="$(grep -oP '^TELEGRAM_ALERTS_ENABLED=\K.*' "$env_file" 2>/dev/null || echo "true")"

  echo -e "  Daily report schedule: ${BLUE}${report_cron}${NC}"
  echo -e "  Expiry warning days:   ${BLUE}${expiry_days}${NC}"
  echo -e "  Data limit threshold:  ${BLUE}${data_threshold}%${NC}"
  echo -e "  Alerts enabled:        ${BLUE}${alerts_enabled}${NC}"
  echo ""

  echo -e "  ${GREEN}1)${NC} Change daily report schedule"
  echo -e "  ${GREEN}2)${NC} Change expiry warning days"
  echo -e "  ${GREEN}3)${NC} Change data limit threshold"
  echo -e "  ${GREEN}4)${NC} Toggle alerts on/off"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-4]: " notif_choice

  case "${notif_choice}" in
    1)
      local new_cron=""
      echo -e "  Examples: ${CYAN}0 9 * * *${NC} (9 AM UTC), ${CYAN}0 21 * * *${NC} (9 PM UTC)"
      read -r -p "  Enter cron schedule: " new_cron
      if [ -n "$new_cron" ]; then
        sed -i "s|^TELEGRAM_REPORT_CRON=.*|TELEGRAM_REPORT_CRON=${new_cron}|" "$env_file"
        echo -e "${GREEN}[✓]${NC} Report schedule updated."
      fi
      ;;
    2)
      local new_days=""
      read -r -p "  Days before expiry to warn [${expiry_days}]: " new_days
      new_days="${new_days:-${expiry_days}}"
      sed -i "s|^TELEGRAM_NOTIFY_EXPIRY_DAYS=.*|TELEGRAM_NOTIFY_EXPIRY_DAYS=${new_days}|" "$env_file"
      echo -e "${GREEN}[✓]${NC} Expiry warning set to ${new_days} days."
      ;;
    3)
      local new_threshold=""
      read -r -p "  Data remaining % to warn [${data_threshold}]: " new_threshold
      new_threshold="${new_threshold:-${data_threshold}}"
      sed -i "s|^TELEGRAM_NOTIFY_DATA_THRESHOLD=.*|TELEGRAM_NOTIFY_DATA_THRESHOLD=${new_threshold}|" "$env_file"
      echo -e "${GREEN}[✓]${NC} Data threshold set to ${new_threshold}%."
      ;;
    4)
      if [ "$alerts_enabled" = "true" ]; then
        sed -i "s|^TELEGRAM_ALERTS_ENABLED=.*|TELEGRAM_ALERTS_ENABLED=false|" "$env_file"
        echo -e "${GREEN}[✓]${NC} Alerts disabled."
      else
        sed -i "s|^TELEGRAM_ALERTS_ENABLED=.*|TELEGRAM_ALERTS_ENABLED=true|" "$env_file"
        echo -e "${GREEN}[✓]${NC} Alerts enabled."
      fi
      ;;
    0|"") return ;;
  esac

  cd "$ROOT_DIR"
  compose restart backend
  sleep 2
  echo -e "${GREEN}[✓]${NC} Backend restarted with new notification settings."
}

telegram_test() {
  echo ""
  echo -e "${BLUE}[*]${NC} Testing Telegram bot connection..."

  local tg_token
  tg_token="$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "")"

  if [ -z "$tg_token" ] || [ "$tg_token" = "your_bot_token_from_botfather" ]; then
    echo -e "${RED}[✗]${NC} Bot token not configured. Run setup first."
    return
  fi

  echo -e "${BLUE}[*]${NC} Checking bot info..."
  local response
  response="$(curl -s "https://api.telegram.org/bot${tg_token}/getMe" 2>/dev/null)"

  if echo "$response" | grep -q '"ok":true'; then
    local bot_name bot_username
    bot_name="$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin)['result']; print(d.get('first_name',''))" 2>/dev/null || echo "unknown")"
    bot_username="$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin)['result']; print(d.get('username',''))" 2>/dev/null || echo "unknown")"
    echo -e "${GREEN}[✓]${NC} Bot is reachable!"
    echo -e "${CYAN}│${NC}  Name:     ${GREEN}${bot_name}${NC}"
    echo -e "${CYAN}│${NC}  Username: ${GREEN}@${bot_username}${NC}"
  else
    echo -e "${RED}[✗]${NC} Bot connection failed!"
    echo -e "${CYAN}│${NC}  Response: ${response}"
    echo ""
    echo -e "${YELLOW}  Possible causes:${NC}"
    echo "  • Invalid bot token"
    echo "  • Network connectivity issues"
    echo "  • Telegram API blocked by firewall"
  fi

  # Check if backend is processing bot updates
  echo ""
  local tg_enabled
  tg_enabled="$(grep -oP '^TELEGRAM_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"
  if [ "$tg_enabled" = "true" ]; then
    echo -e "${GREEN}[✓]${NC} Telegram is enabled in backend config."
  else
    echo -e "${YELLOW}[!]${NC} Telegram is disabled in backend config. Enable it with option 2."
  fi
  echo ""
}

# ============================================
# 19. Backup & Restore Management
# ============================================

backup_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Backup & Restore Management                     ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Show current backup config
  local backup_enabled backup_dir backup_schedule backup_retention
  backup_enabled="$(grep -oP '^BACKUP_ENABLED=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"
  backup_dir="$(grep -oP '^BACKUP_DIR=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "${BACKUP_DIR}")"
  backup_schedule="$(grep -oP '^BACKUP_SCHEDULE=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "0 2 * * *")"
  backup_retention="$(grep -oP '^BACKUP_RETENTION_DAYS=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "7")"

  echo -e "${YELLOW}  Current Configuration:${NC}"
  echo -e "  ─────────────────────────────────────────"
  if [ "$backup_enabled" = "true" ]; then
    echo -e "  Auto-backup: ${GREEN}● Enabled${NC}"
  else
    echo -e "  Auto-backup: ${RED}○ Disabled${NC}"
  fi
  echo -e "  Backup Dir:  ${BLUE}${backup_dir}${NC}"
  echo -e "  Schedule:    ${BLUE}${backup_schedule}${NC}"
  echo -e "  Retention:   ${BLUE}${backup_retention} days${NC}"

  # Count existing backups
  local backup_count=0
  if [ -d "$backup_dir" ]; then
    backup_count="$(find "$backup_dir" -name "backup-*.tar.gz" 2>/dev/null | wc -l || echo 0)"
  fi
  echo -e "  Backups:     ${BLUE}${backup_count} file(s)${NC}"
  echo ""

  echo -e "  ${GREEN}1)${NC} Create Backup Now"
  echo -e "  ${GREEN}2)${NC} List Backups"
  echo -e "  ${GREEN}3)${NC} Restore from Backup"
  echo -e "  ${GREEN}4)${NC} Enable Auto-Backup"
  echo -e "  ${GREEN}5)${NC} Disable Auto-Backup"
  echo -e "  ${GREEN}6)${NC} Configure Schedule & Retention"
  echo -e "  ${GREEN}7)${NC} Download Backup (copy to home dir)"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-7]: " bk_choice

  case "${bk_choice}" in
    1) backup_create ;;
    2) backup_list ;;
    3) backup_restore ;;
    4) backup_toggle "true" ;;
    5) backup_toggle "false" ;;
    6) backup_configure ;;
    7) backup_download ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

backup_create() {
  echo ""
  echo -e "${BLUE}[*]${NC} Creating database backup..."

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  # Try API-based backup first
  local token
  token="$(get_admin_token)"

  if [ -n "$token" ]; then
    echo -e "${BLUE}[*]${NC} Triggering backup via API..."
    local response
    response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      "${api_base}/v1/backup/create" 2>/dev/null || echo "")"

    if echo "$response" | grep -q "archivePath\|success\|backup"; then
      echo ""
      echo -e "${GREEN}[✓]${NC} Backup created successfully!"
      echo "$response" | python3 -m json.tool 2>/dev/null || echo "  $response"
      echo ""
      return
    fi
  fi

  # Fallback: Direct database backup via Docker
  echo -e "${YELLOW}[!]${NC} API backup unavailable, using direct Docker backup..."

  local backup_dir
  backup_dir="$(grep -oP '^BACKUP_DIR=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "${BACKUP_DIR}")"
  mkdir -p "$backup_dir"

  local timestamp backup_file
  timestamp="$(date +%Y%m%d-%H%M%S)"
  backup_file="${backup_dir}/backup-${timestamp}.tar.gz"

  # Dump database
  local db_container="one-ui-db"
  echo -e "${BLUE}[*]${NC} Dumping PostgreSQL database..."
  docker exec "$db_container" pg_dump -U postgres xray_panel > "/tmp/oneui-db-${timestamp}.sql" 2>/dev/null

  if [ ! -s "/tmp/oneui-db-${timestamp}.sql" ]; then
    echo -e "${RED}[✗]${NC} Database dump failed. Is the database container running?"
    rm -f "/tmp/oneui-db-${timestamp}.sql"
    return
  fi

  # Create backup archive
  echo -e "${BLUE}[*]${NC} Creating archive..."
  local tmp_dir="/tmp/oneui-backup-${timestamp}"
  mkdir -p "$tmp_dir"
  mv "/tmp/oneui-db-${timestamp}.sql" "$tmp_dir/database.sql"
  cp "$ROOT_DIR/backend/.env" "$tmp_dir/backend.env" 2>/dev/null || true

  if [ -d "${DATA_DIR}/certs" ] && [ "$(ls -A "${DATA_DIR}/certs" 2>/dev/null)" ]; then
    cp -r "${DATA_DIR}/certs" "$tmp_dir/certs" 2>/dev/null || true
  fi

  tar -czf "$backup_file" -C "/tmp" "oneui-backup-${timestamp}"
  rm -rf "$tmp_dir"

  local file_size
  file_size="$(du -h "$backup_file" | cut -f1)"

  echo ""
  echo -e "${GREEN}[✓]${NC} Backup created!"
  echo -e "${CYAN}│${NC}  File: ${GREEN}${backup_file}${NC}"
  echo -e "${CYAN}│${NC}  Size: ${GREEN}${file_size}${NC}"
  echo ""
}

backup_list() {
  echo ""
  local backup_dir
  backup_dir="$(grep -oP '^BACKUP_DIR=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "${BACKUP_DIR}")"

  echo -e "${YELLOW}  Available Backups:${NC}"
  echo -e "  ─────────────────────────────────────────"

  if [ ! -d "$backup_dir" ] || [ -z "$(ls -A "$backup_dir" 2>/dev/null)" ]; then
    echo -e "  ${YELLOW}No backups found in ${backup_dir}${NC}"
    echo ""
    return
  fi

  local count=0
  while IFS= read -r file; do
    count=$((count + 1))
    local filename size modified
    filename="$(basename "$file")"
    size="$(du -h "$file" | cut -f1)"
    modified="$(stat -c '%y' "$file" 2>/dev/null | cut -d'.' -f1 || stat -f '%Sm' "$file" 2>/dev/null || echo "unknown")"
    echo -e "  ${GREEN}${count})${NC} ${filename}  (${size}, ${modified})"
  done < <(find "$backup_dir" -name "*.tar.gz" -o -name "*.sql" 2>/dev/null | sort -r)

  echo ""
  echo -e "  Total: ${count} backup(s)"
  echo ""
}

backup_restore() {
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║                    RESTORE FROM BACKUP                       ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}[!]${NC} This will REPLACE your current database with the backup."
  echo -e "${YELLOW}[!]${NC} Current data will be LOST."
  echo ""

  # List available backups
  backup_list

  local backup_file=""
  read -r -p "  Enter backup filename or full path (or 'cancel'): " backup_file

  if [ -z "$backup_file" ] || [ "$backup_file" = "cancel" ]; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  # Resolve file path
  local backup_dir
  backup_dir="$(grep -oP '^BACKUP_DIR=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "${BACKUP_DIR}")"

  if [ ! -f "$backup_file" ]; then
    # Try backup directory
    if [ -f "${backup_dir}/${backup_file}" ]; then
      backup_file="${backup_dir}/${backup_file}"
    else
      echo -e "${RED}[✗]${NC} Backup file not found: ${backup_file}"
      return
    fi
  fi

  if ! confirm "RESTORE from ${backup_file}? This will REPLACE current data!"; then
    return
  fi

  echo -e "${BLUE}[*]${NC} Restoring from: ${backup_file}"

  # Try using the restore script
  if [ -f "$ROOT_DIR/scripts/restore.sh" ]; then
    echo -e "${BLUE}[*]${NC} Using restore script..."
    chmod +x "$ROOT_DIR/scripts/restore.sh" 2>/dev/null || true
    "$ROOT_DIR/scripts/restore.sh" "$backup_file"
  else
    # Manual restore
    echo -e "${BLUE}[*]${NC} Performing manual restore..."

    local tmp_dir="/tmp/oneui-restore-$$"
    mkdir -p "$tmp_dir"

    echo -e "${BLUE}[*]${NC} Extracting backup..."
    tar -xzf "$backup_file" -C "$tmp_dir" 2>/dev/null

    # Find the SQL file
    local sql_file
    sql_file="$(find "$tmp_dir" -name "*.sql" -type f | head -1)"

    if [ -z "$sql_file" ]; then
      echo -e "${RED}[✗]${NC} No SQL file found in backup archive."
      rm -rf "$tmp_dir"
      return
    fi

    echo -e "${BLUE}[*]${NC} Restoring database..."
    docker exec -i one-ui-db psql -U postgres -d xray_panel < "$sql_file"

    # Restore env if present
    local env_backup
    env_backup="$(find "$tmp_dir" -name "*.env" -o -name "backend.env" | head -1)"
    if [ -n "$env_backup" ]; then
      echo -e "${YELLOW}[!]${NC} Backup contains .env file. Current .env was NOT replaced."
      echo -e "     Backup env saved to: ${ROOT_DIR}/backend/.env.from-backup"
      cp "$env_backup" "$ROOT_DIR/backend/.env.from-backup"
    fi

    # Restore certs if present
    local certs_dir
    certs_dir="$(find "$tmp_dir" -type d -name "certs" | head -1)"
    if [ -n "$certs_dir" ] && [ -d "$certs_dir" ]; then
      echo -e "${BLUE}[*]${NC} Restoring SSL certificates..."
      mkdir -p "${DATA_DIR}/certs"
      cp -r "$certs_dir/." "${DATA_DIR}/certs/"
    fi

    rm -rf "$tmp_dir"
  fi

  echo -e "${BLUE}[*]${NC} Restarting services..."
  cd "$ROOT_DIR"
  compose restart

  sleep 3
  echo ""
  echo -e "${GREEN}[✓]${NC} Restore complete!"
  echo -e "${YELLOW}[!]${NC} Verify your data by logging into the panel."
  echo ""
}

backup_toggle() {
  local state="$1"
  set_env_var "$ROOT_DIR/backend/.env" "BACKUP_ENABLED" "${state}"

  cd "$ROOT_DIR"
  compose restart backend
  sleep 2

  if [ "$state" = "true" ]; then
    echo -e "${GREEN}[✓]${NC} Auto-backup enabled."
  else
    echo -e "${GREEN}[✓]${NC} Auto-backup disabled."
  fi
}

backup_configure() {
  echo ""
  echo -e "${YELLOW}  Backup Configuration:${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo ""

  local env_file="$ROOT_DIR/backend/.env"

  echo -e "  ${GREEN}1)${NC} Change backup schedule"
  echo -e "  ${GREEN}2)${NC} Change retention days"
  echo -e "  ${GREEN}3)${NC} Change backup directory"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-3]: " conf_choice

  case "${conf_choice}" in
    1)
      local current_schedule new_schedule
      current_schedule="$(grep -oP '^BACKUP_SCHEDULE=\K.*' "$env_file" 2>/dev/null || echo "0 2 * * *")"
      echo -e "  Current: ${BLUE}${current_schedule}${NC}"
      echo -e "  Examples: ${CYAN}0 2 * * *${NC} (2 AM daily), ${CYAN}0 */6 * * *${NC} (every 6h)"
      read -r -p "  Enter new cron schedule: " new_schedule
      if [ -n "$new_schedule" ]; then
        set_env_var "$env_file" "BACKUP_SCHEDULE" "${new_schedule}"
        echo -e "${GREEN}[✓]${NC} Backup schedule updated."
      fi
      ;;
    2)
      local current_retention new_retention
      current_retention="$(grep -oP '^BACKUP_RETENTION_DAYS=\K.*' "$env_file" 2>/dev/null || echo "7")"
      read -r -p "  Retention days [${current_retention}]: " new_retention
      new_retention="${new_retention:-${current_retention}}"
      set_env_var "$env_file" "BACKUP_RETENTION_DAYS" "${new_retention}"
      echo -e "${GREEN}[✓]${NC} Retention set to ${new_retention} days."
      ;;
    3)
      local current_dir new_dir
      current_dir="$(grep -oP '^BACKUP_DIR=\K.*' "$env_file" 2>/dev/null || echo "${BACKUP_DIR}")"
      echo -e "  Current: ${BLUE}${current_dir}${NC}"
      read -r -p "  Enter new backup directory: " new_dir
      if [ -n "$new_dir" ]; then
        mkdir -p "$new_dir" 2>/dev/null
        set_env_var "$env_file" "BACKUP_DIR" "${new_dir}"
        echo -e "${GREEN}[✓]${NC} Backup directory changed to: ${new_dir}"
      fi
      ;;
    0|"") return ;;
  esac

  cd "$ROOT_DIR"
  compose restart backend
  sleep 2
  echo -e "${GREEN}[✓]${NC} Backend restarted with new backup config."
}

backup_download() {
  echo ""
  backup_list

  local backup_file=""
  read -r -p "  Enter backup filename to copy: " backup_file

  if [ -z "$backup_file" ]; then
    return
  fi

  local backup_dir
  backup_dir="$(grep -oP '^BACKUP_DIR=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "${BACKUP_DIR}")"
  local source_path="${backup_dir}/${backup_file}"

  if [ ! -f "$source_path" ]; then
    if [ -f "$backup_file" ]; then
      source_path="$backup_file"
    else
      echo -e "${RED}[✗]${NC} File not found."
      return
    fi
  fi

  local dest_dir="${HOME}"
  cp "$source_path" "${dest_dir}/"

  echo -e "${GREEN}[✓]${NC} Backup copied to: ${dest_dir}/${backup_file}"
  echo -e "${YELLOW}[!]${NC} Download via SCP: ${CYAN}scp root@$(get_server_ip):${dest_dir}/${backup_file} ./${NC}"
  echo ""
}

# ============================================
# 20. Two-Factor Authentication Setup
# ============================================

twofa_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Two-Factor Authentication (2FA)                  ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Show current 2FA config
  local require_2fa
  require_2fa="$(grep -oP '^AUTH_REQUIRE_2FA_SUPER_ADMIN=\K.*' "$ROOT_DIR/backend/.env" 2>/dev/null || echo "false")"

  echo -e "${YELLOW}  Current Configuration:${NC}"
  echo -e "  ─────────────────────────────────────────"
  if [ "$require_2fa" = "true" ]; then
    echo -e "  Require 2FA (Super Admin): ${GREEN}● Yes${NC}"
  else
    echo -e "  Require 2FA (Super Admin): ${YELLOW}○ No${NC}"
  fi
  echo ""

  echo -e "  ${GREEN}1)${NC} Setup 2FA for Admin (guided)"
  echo -e "  ${GREEN}2)${NC} Require 2FA for Super Admins"
  echo -e "  ${GREEN}3)${NC} Disable 2FA Requirement"
  echo -e "  ${GREEN}4)${NC} Reset Admin 2FA (disable for specific user)"
  echo -e "  ${GREEN}5)${NC} View 2FA Setup Guide"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-5]: " twofa_choice

  case "${twofa_choice}" in
    1) twofa_setup_guided ;;
    2) twofa_require "true" ;;
    3) twofa_require "false" ;;
    4) twofa_reset_user ;;
    5) twofa_show_guide ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

twofa_setup_guided() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              2FA Setup via API                                ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  # Authenticate
  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate. Make sure the backend is running."
    return
  fi

  echo -e "${BLUE}[*]${NC} Generating 2FA secret..."
  local setup_response
  setup_response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    "${api_base}/auth/2fa/setup" 2>/dev/null)"

  local secret otp_url
  secret="$(echo "$setup_response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret',''))" 2>/dev/null || echo "")"
  otp_url="$(echo "$setup_response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('otpAuthUrl',''))" 2>/dev/null || echo "")"

  if [ -z "$secret" ]; then
    echo -e "${RED}[✗]${NC} Failed to generate 2FA secret. Response:"
    echo "  $setup_response"
    return
  fi

  echo ""
  echo -e "${GREEN}[✓]${NC} 2FA secret generated!"
  echo ""
  echo -e "${YELLOW}  Step 1: Add to Your Authenticator App${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo ""
  echo -e "  Option A: Scan the QR code in the web panel"
  echo -e "  (Go to Settings → Security → Two-Factor Auth)"
  echo ""
  echo -e "  Option B: Manual entry in your authenticator app:"
  echo -e "  Secret Key: ${GREEN}${secret}${NC}"
  echo -e "  Type:       ${BLUE}TOTP${NC}"
  echo -e "  Algorithm:  ${BLUE}SHA1${NC}"
  echo -e "  Digits:     ${BLUE}6${NC}"
  echo -e "  Period:     ${BLUE}30 seconds${NC}"
  echo ""
  if [ -n "$otp_url" ]; then
    echo -e "  OTP Auth URL: ${CYAN}${otp_url}${NC}"
    echo ""
  fi

  echo -e "${YELLOW}  Step 2: Verify with a Code${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo ""

  local otp_code=""
  read -r -p "  Enter 6-digit code from your authenticator app: " otp_code

  if [ -z "$otp_code" ]; then
    echo -e "${YELLOW}[!]${NC} Skipped verification. 2FA is NOT enabled yet."
    echo -e "${YELLOW}[!]${NC} Complete setup in the web panel: Settings → Security"
    return
  fi

  echo -e "${BLUE}[*]${NC} Verifying and enabling 2FA..."
  local enable_response
  enable_response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"otp\":\"${otp_code}\"}" \
    "${api_base}/auth/2fa/enable" 2>/dev/null)"

  if echo "$enable_response" | grep -q '"enabled":true\|success'; then
    echo ""
    echo -e "${GREEN}[✓]${NC} Two-Factor Authentication is now ENABLED!"
    echo -e "${YELLOW}[!]${NC} You will need your authenticator code for all future logins."
    echo -e "${YELLOW}[!]${NC} SAVE your secret key in a safe place as a backup!"
    echo ""
  else
    echo -e "${RED}[✗]${NC} Failed to enable 2FA. Response:"
    echo "  $enable_response"
    echo ""
    echo -e "${YELLOW}[!]${NC} Make sure the code is correct and try again."
    echo -e "${YELLOW}[!]${NC} Codes refresh every 30 seconds."
  fi
}

twofa_require() {
  local state="$1"
  set_env_var "$ROOT_DIR/backend/.env" "AUTH_REQUIRE_2FA_SUPER_ADMIN" "${state}"

  cd "$ROOT_DIR"
  compose restart backend
  sleep 2

  if [ "$state" = "true" ]; then
    echo -e "${GREEN}[✓]${NC} 2FA is now REQUIRED for Super Admin accounts."
    echo -e "${YELLOW}[!]${NC} Super Admins will be redirected to 2FA setup on next login."
  else
    echo -e "${GREEN}[✓]${NC} 2FA requirement removed. Admins can still enable it voluntarily."
  fi
}

twofa_reset_user() {
  echo ""
  echo -e "${YELLOW}[!]${NC} This will disable 2FA for a specific admin account."
  echo -e "${YELLOW}[!]${NC} Use this if an admin has lost their authenticator device."
  echo ""

  local username=""
  read -r -p "  Enter admin username to reset 2FA for: " username

  if [ -z "$username" ]; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  if ! confirm "Reset 2FA for user '${username}'?"; then
    return
  fi

  echo -e "${BLUE}[*]${NC} Resetting 2FA for ${username}..."

  cd "$ROOT_DIR"

  local username_b64
  username_b64="$(printf '%s' "${username}" | base64 | tr -d '\n')"

  compose run --rm -T \
    -e "TARGET_USER_B64=${username_b64}" \
    backend node -e "
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  const username = Buffer.from(process.env.TARGET_USER_B64, 'base64').toString('utf8');

  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin) {
    console.log('Admin not found: ' + username);
    process.exit(1);
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null
    }
  });

  console.log('2FA disabled for: ' + username);
  await prisma.\$disconnect();
})();
"

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}[✓]${NC} 2FA has been disabled for '${username}'."
    echo -e "${YELLOW}[!]${NC} The user can re-enable 2FA from Settings → Security."
  else
    echo -e "${RED}[✗]${NC} Failed to reset 2FA. Is the database running?"
  fi
}

twofa_show_guide() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Two-Factor Authentication Guide                  ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}  What is 2FA?${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo "  Two-Factor Authentication adds an extra security layer."
  echo "  In addition to your password, you need a time-based code"
  echo "  from an authenticator app on your phone."
  echo ""
  echo -e "${YELLOW}  Recommended Authenticator Apps:${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo -e "  • ${GREEN}Google Authenticator${NC}  (iOS / Android)"
  echo -e "  • ${GREEN}Microsoft Authenticator${NC} (iOS / Android)"
  echo -e "  • ${GREEN}Authy${NC}                (iOS / Android / Desktop)"
  echo -e "  • ${GREEN}1Password${NC}            (with TOTP support)"
  echo ""
  echo -e "${YELLOW}  How to Enable 2FA:${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo ""
  echo -e "  ${CYAN}Method 1: Web Panel (Recommended)${NC}"
  echo "  1. Log into the One-UI panel"
  echo "  2. Go to Settings → Security"
  echo "  3. Click 'Enable Two-Factor Authentication'"
  echo "  4. Scan the QR code with your authenticator app"
  echo "  5. Enter the 6-digit code to verify"
  echo ""
  echo -e "  ${CYAN}Method 2: CLI (This Menu)${NC}"
  echo "  1. Select 'Setup 2FA for Admin' from this menu"
  echo "  2. Enter your admin credentials when prompted"
  echo "  3. Manually add the secret key to your authenticator app"
  echo "  4. Enter the 6-digit verification code"
  echo ""
  echo -e "${YELLOW}  Recovery:${NC}"
  echo -e "  ─────────────────────────────────────────"
  echo "  If you lose your authenticator device:"
  echo "  1. Run: one-ui setup-2fa"
  echo "  2. Select 'Reset Admin 2FA'"
  echo "  3. Enter the admin username"
  echo "  4. 2FA will be disabled, allowing password-only login"
  echo "  5. Re-enable 2FA from Settings after logging in"
  echo ""
}

# ============================================
# Xray Operations
# ============================================

update_xray() {
  local channel="$1"
  echo ""
  echo -e "${BLUE}[*]${NC} Running Xray update channel: $channel (with canary preflight)"
  if [[ ! -x "$UPDATE_SCRIPT" ]]; then
    chmod +x "$UPDATE_SCRIPT"
  fi
  "$UPDATE_SCRIPT" "--$channel" --canary
}

show_xray_status() {
  if ! docker ps --format '{{.Names}}' | grep -Fx "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo -e "${YELLOW}[!]${NC} Xray container '$CONTAINER_NAME' is not running."
    return
  fi
  echo "Container: $CONTAINER_NAME"
  docker exec "$CONTAINER_NAME" xray version 2>/dev/null | head -n 1 || echo "Unable to read Xray version"
}

run_smoke_suite() {
  echo ""
  echo -e "${BLUE}[*]${NC} Running One-UI smoke suite (core + Myanmar hardening)..."
  if [[ -x "$SMOKE_CORE_SCRIPT" || -f "$SMOKE_CORE_SCRIPT" ]]; then
    chmod +x "$SMOKE_CORE_SCRIPT" 2>/dev/null || true
    "$SMOKE_CORE_SCRIPT"
  else
    echo -e "${YELLOW}[!]${NC} Core smoke script not found"
  fi
  if [[ -x "$SMOKE_MYANMAR_SCRIPT" || -f "$SMOKE_MYANMAR_SCRIPT" ]]; then
    chmod +x "$SMOKE_MYANMAR_SCRIPT" 2>/dev/null || true
    "$SMOKE_MYANMAR_SCRIPT"
  else
    echo -e "${YELLOW}[!]${NC} Myanmar smoke script not found"
  fi
  echo -e "${GREEN}[✓]${NC} Smoke suite complete."
}

# ============================================
# 30. User Management via CLI
# ============================================

user_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              User Management                                 ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate. Make sure the backend is running."
    return
  fi

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  echo -e "  ${GREEN}1)${NC} List Users"
  echo -e "  ${GREEN}2)${NC} Add User"
  echo -e "  ${GREEN}3)${NC} Search User"
  echo -e "  ${GREEN}4)${NC} Disable User"
  echo -e "  ${GREEN}5)${NC} Enable User"
  echo -e "  ${GREEN}6)${NC} Delete User"
  echo -e "  ${GREEN}7)${NC} Reset User Traffic"
  echo -e "  ${GREEN}8)${NC} Extend User Expiry"
  echo -e "  ${GREEN}9)${NC} User Statistics"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-9]: " user_choice

  case "${user_choice}" in
    1) user_list "$token" "$api_base" ;;
    2) user_add "$token" "$api_base" ;;
    3) user_search "$token" "$api_base" ;;
    4) user_toggle_status "$token" "$api_base" "DISABLED" ;;
    5) user_toggle_status "$token" "$api_base" "ACTIVE" ;;
    6) user_delete "$token" "$api_base" ;;
    7) user_reset_traffic "$token" "$api_base" ;;
    8) user_extend_expiry "$token" "$api_base" ;;
    9) user_stats "$token" "$api_base" ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

user_list() {
  local token="$1" api_base="$2"
  local page="${3:-1}" limit="${4:-20}"

  echo ""
  echo -e "${YELLOW}  Users (Page ${page}):${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/users?page=${page}&limit=${limit}" 2>/dev/null)"

  if [ -z "$response" ]; then
    echo -e "${RED}[✗]${NC} Failed to fetch users."
    return
  fi

  # Parse and display users
  local total
  total="$(echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    users = data.get('data', data.get('users', []))
    total = data.get('total', data.get('pagination', {}).get('total', len(users)))
    print(total)
except: print('0')
" 2>/dev/null || echo "0")"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    users = data.get('data', data.get('users', []))
    if not users:
        print('  No users found.')
        sys.exit()
    print(f'  {\"ID\":<6} {\"Email\":<30} {\"Status\":<10} {\"Data Used\":<15} {\"Data Limit\":<15} {\"Expiry\":<12}')
    print('  ' + '─' * 88)
    for u in users:
        uid = u.get('id', '?')
        email = u.get('email', 'N/A')[:28]
        status = u.get('status', 'N/A')
        used = u.get('usedTraffic', u.get('dataUsage', 0)) or 0
        limit = u.get('dataLimit', 0) or 0
        used_gb = used / (1024**3) if used > 1000 else used
        limit_gb = limit / (1024**3) if limit > 1000 else limit
        limit_str = f'{limit_gb:.1f} GB' if limit_gb > 0 else 'Unlimited'
        expiry = str(u.get('expiryDate', u.get('expiresAt', 'N/A')))[:10]
        status_icon = '●' if status == 'ACTIVE' else '○'
        print(f'  {uid:<6} {email:<30} {status_icon} {status:<8} {used_gb:.1f} GB{\"\":>7} {limit_str:<15} {expiry:<12}')
except Exception as e:
    print(f'  Error parsing: {e}')
" 2>/dev/null

  echo ""
  echo -e "  Total: ${BLUE}${total}${NC} users"
  echo ""
}

user_add() {
  local token="$1" api_base="$2"

  echo ""
  echo -e "${CYAN}  ── Add New User ──${NC}"
  echo ""

  local email data_limit expiry_days ip_limit

  read -r -p "  Email: " email
  if [ -z "$email" ]; then
    echo -e "${RED}[✗]${NC} Email is required."
    return
  fi

  read -r -p "  Data limit (GB, 0=unlimited) [0]: " data_limit
  data_limit="${data_limit:-0}"

  read -r -p "  Expiry (days) [30]: " expiry_days
  expiry_days="${expiry_days:-30}"

  read -r -p "  IP limit (0=unlimited) [0]: " ip_limit
  ip_limit="${ip_limit:-0}"

  # Fetch available inbounds
  echo ""
  echo -e "${BLUE}[*]${NC} Fetching available inbounds..."

  local inbounds_response
  inbounds_response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/inbounds?limit=100" 2>/dev/null)"

  local inbound_ids_available
  inbound_ids_available="$(echo "$inbounds_response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    inbounds = data.get('data', data.get('inbounds', []))
    for i in inbounds:
        iid = i.get('id', '?')
        tag = i.get('tag', 'N/A')
        proto = i.get('protocol', '?')
        port = i.get('port', '?')
        enabled = '●' if i.get('enabled', True) else '○'
        print(f'    {iid}: {enabled} {tag} ({proto} :{port})')
except: pass
" 2>/dev/null)"

  if [ -n "$inbound_ids_available" ]; then
    echo -e "${YELLOW}  Available Inbounds:${NC}"
    echo "$inbound_ids_available"
    echo ""
  fi

  local inbound_ids_input
  read -r -p "  Inbound IDs (comma-separated, e.g. 1,2,3): " inbound_ids_input

  if [ -z "$inbound_ids_input" ]; then
    echo -e "${RED}[✗]${NC} At least one inbound ID is required."
    return
  fi

  # Build JSON array of inbound IDs
  local inbound_json
  inbound_json="$(echo "$inbound_ids_input" | python3 -c "
import sys
ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]
print(str(ids))
" 2>/dev/null)"

  local create_response
  create_response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"dataLimit\":${data_limit},\"expiryDays\":${expiry_days},\"ipLimit\":${ip_limit},\"inboundIds\":${inbound_json}}" \
    "${api_base}/users" 2>/dev/null)"

  local new_id
  new_id="$(echo "$create_response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    user = d.get('data', d)
    print(user.get('id', ''))
except: print('')
" 2>/dev/null)"

  if [ -n "$new_id" ] && [ "$new_id" != "" ]; then
    echo ""
    echo -e "${GREEN}[✓]${NC} User created successfully! (ID: ${new_id})"

    # Show subscription info
    echo "$create_response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    user = d.get('data', d)
    print(f'  Email:  {user.get(\"email\", \"N/A\")}')
    print(f'  UUID:   {user.get(\"uuid\", \"N/A\")}')
    token = user.get('subscriptionToken', '')
    if token:
        print(f'  Sub Token: {token}')
except: pass
" 2>/dev/null
  else
    echo -e "${RED}[✗]${NC} Failed to create user."
    echo "$create_response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'  Error: {d.get(\"error\", d.get(\"message\", str(d)))}')
except: print(sys.stdin.read())
" 2>/dev/null
  fi
  echo ""
}

user_search() {
  local token="$1" api_base="$2"
  echo ""
  local search_term
  read -r -p "  Search (email or UUID): " search_term

  if [ -z "$search_term" ]; then
    return
  fi

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/users?search=${search_term}&limit=20" 2>/dev/null)"

  echo ""
  echo -e "${YELLOW}  Search Results for '${search_term}':${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────────────────────────────────"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    users = data.get('data', data.get('users', []))
    if not users:
        print('  No users found.')
        sys.exit()
    for u in users:
        uid = u.get('id', '?')
        email = u.get('email', 'N/A')
        status = u.get('status', 'N/A')
        uuid = u.get('uuid', 'N/A')
        used = u.get('usedTraffic', u.get('dataUsage', 0)) or 0
        limit_val = u.get('dataLimit', 0) or 0
        used_gb = used / (1024**3) if used > 1000 else used
        limit_gb = limit_val / (1024**3) if limit_val > 1000 else limit_val
        limit_str = f'{limit_gb:.1f} GB' if limit_gb > 0 else 'Unlimited'
        expiry = str(u.get('expiryDate', u.get('expiresAt', 'N/A')))[:10]
        status_icon = '●' if status == 'ACTIVE' else '○'
        print(f'  ID: {uid}')
        print(f'    Email:    {email}')
        print(f'    UUID:     {uuid}')
        print(f'    Status:   {status_icon} {status}')
        print(f'    Traffic:  {used_gb:.1f} GB / {limit_str}')
        print(f'    Expires:  {expiry}')
        sub = u.get('subscriptionToken', '')
        if sub:
            print(f'    Sub:      {sub}')
        print()
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null
}

user_toggle_status() {
  local token="$1" api_base="$2" new_status="$3"

  echo ""
  local user_id
  read -r -p "  Enter user ID to ${new_status,,}: " user_id

  if [ -z "$user_id" ]; then
    return
  fi

  local response
  response="$(curl -s -X PUT -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"${new_status}\"}" \
    "${api_base}/users/${user_id}" 2>/dev/null)"

  local updated_status
  updated_status="$(echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    user = d.get('data', d)
    print(user.get('status', ''))
except: print('')
" 2>/dev/null)"

  if [ "$updated_status" = "$new_status" ]; then
    echo -e "${GREEN}[✓]${NC} User ${user_id} set to ${new_status}."
  else
    echo -e "${RED}[✗]${NC} Failed to update user status."
    echo "$response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(f'  Error: {d.get(\"error\", d.get(\"message\", \"\"))}')
except: pass
" 2>/dev/null
  fi
  echo ""
}

user_delete() {
  local token="$1" api_base="$2"

  echo ""
  local user_id
  read -r -p "  Enter user ID to DELETE: " user_id

  if [ -z "$user_id" ]; then
    return
  fi

  if ! confirm "Are you sure you want to DELETE user ${user_id}? This cannot be undone."; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  local response http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
    -H "Authorization: Bearer ${token}" \
    "${api_base}/users/${user_id}" 2>/dev/null)"

  if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
    echo -e "${GREEN}[✓]${NC} User ${user_id} deleted successfully."
  else
    echo -e "${RED}[✗]${NC} Failed to delete user (HTTP ${http_code})."
  fi
  echo ""
}

user_reset_traffic() {
  local token="$1" api_base="$2"

  echo ""
  local user_id
  read -r -p "  Enter user ID to reset traffic: " user_id

  if [ -z "$user_id" ]; then
    return
  fi

  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${token}" \
    "${api_base}/users/${user_id}/reset-traffic" 2>/dev/null)"

  if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}[✓]${NC} Traffic reset for user ${user_id}."
  else
    echo -e "${RED}[✗]${NC} Failed to reset traffic (HTTP ${http_code})."
  fi
  echo ""
}

user_extend_expiry() {
  local token="$1" api_base="$2"

  echo ""
  local user_id days
  read -r -p "  Enter user ID: " user_id
  read -r -p "  Days to extend: " days

  if [ -z "$user_id" ] || [ -z "$days" ]; then
    return
  fi

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"days\":${days}}" \
    "${api_base}/users/${user_id}/extend-expiry" 2>/dev/null)"

  local new_expiry
  new_expiry="$(echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    user = d.get('data', d)
    print(user.get('expiryDate', user.get('expiresAt', '')))
except: print('')
" 2>/dev/null)"

  if [ -n "$new_expiry" ]; then
    echo -e "${GREEN}[✓]${NC} User ${user_id} extended by ${days} days. New expiry: ${new_expiry}"
  else
    echo -e "${RED}[✗]${NC} Failed to extend expiry."
  fi
  echo ""
}

user_stats() {
  local token="$1" api_base="$2"

  echo ""
  echo -e "${YELLOW}  User Statistics:${NC}"
  echo -e "  ─────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/users/stats" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    stats = d.get('data', d)
    total = stats.get('total', stats.get('totalUsers', 0))
    active = stats.get('active', stats.get('activeUsers', 0))
    expired = stats.get('expired', stats.get('expiredUsers', 0))
    disabled = stats.get('disabled', stats.get('disabledUsers', 0))
    limited = stats.get('limited', stats.get('limitedUsers', 0))
    online = stats.get('online', stats.get('onlineUsers', 0))
    print(f'  Total Users:    {total}')
    print(f'  ● Active:       {active}')
    print(f'  ○ Expired:      {expired}')
    print(f'  ○ Disabled:     {disabled}')
    print(f'  ○ Data Limited: {limited}')
    if online:
        print(f'  ◉ Online Now:   {online}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

# ============================================
# 31. Traffic Monitoring Dashboard
# ============================================

traffic_dashboard() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Traffic Monitoring Dashboard                     ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate. Make sure the backend is running."
    return
  fi

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  echo -e "  ${GREEN}1)${NC} System Overview (CPU, Memory, Disk)"
  echo -e "  ${GREEN}2)${NC} User Traffic Summary (top users)"
  echo -e "  ${GREEN}3)${NC} Online Users (current connections)"
  echo -e "  ${GREEN}4)${NC} Inbound Traffic Summary"
  echo -e "  ${GREEN}5)${NC} Live Session Monitor (streaming)"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-5]: " traffic_choice

  case "${traffic_choice}" in
    1) traffic_system_overview "$token" "$api_base" ;;
    2) traffic_user_summary "$token" "$api_base" ;;
    3) traffic_online_users "$token" "$api_base" ;;
    4) traffic_inbound_summary "$token" "$api_base" ;;
    5) traffic_live_monitor "$token" "$api_base" ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

traffic_system_overview() {
  local token="$1" api_base="$2"

  echo ""
  echo -e "${YELLOW}  System Overview:${NC}"
  echo -e "  ─────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/system/stats" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    stats = d.get('data', d)

    # CPU
    cpu = stats.get('cpu', stats.get('cpuUsage', {}))
    if isinstance(cpu, dict):
        cpu_pct = cpu.get('percent', cpu.get('usage', 0))
    else:
        cpu_pct = cpu
    bar_filled = int(cpu_pct / 5)
    bar_empty = 20 - bar_filled
    cpu_bar = '█' * bar_filled + '░' * bar_empty
    print(f'  CPU:     [{cpu_bar}] {cpu_pct:.1f}%')

    # Memory
    mem = stats.get('memory', stats.get('memoryUsage', {}))
    if isinstance(mem, dict):
        mem_total = mem.get('total', 0)
        mem_used = mem.get('used', 0)
        mem_pct = mem.get('percent', (mem_used/mem_total*100) if mem_total else 0)
        mem_total_gb = mem_total / (1024**3) if mem_total > 1e6 else mem_total
        mem_used_gb = mem_used / (1024**3) if mem_used > 1e6 else mem_used
    else:
        mem_pct = 0; mem_used_gb = 0; mem_total_gb = 0
    bar_filled = int(mem_pct / 5)
    bar_empty = 20 - bar_filled
    mem_bar = '█' * bar_filled + '░' * bar_empty
    print(f'  Memory:  [{mem_bar}] {mem_pct:.1f}% ({mem_used_gb:.1f}/{mem_total_gb:.1f} GB)')

    # Disk
    disk = stats.get('disk', stats.get('diskUsage', {}))
    if isinstance(disk, dict):
        dk_total = disk.get('total', 0)
        dk_used = disk.get('used', 0)
        dk_pct = disk.get('percent', (dk_used/dk_total*100) if dk_total else 0)
        dk_total_gb = dk_total / (1024**3) if dk_total > 1e6 else dk_total
        dk_used_gb = dk_used / (1024**3) if dk_used > 1e6 else dk_used
    else:
        dk_pct = 0; dk_used_gb = 0; dk_total_gb = 0
    bar_filled = int(dk_pct / 5)
    bar_empty = 20 - bar_filled
    dk_bar = '█' * bar_filled + '░' * bar_empty
    print(f'  Disk:    [{dk_bar}] {dk_pct:.1f}% ({dk_used_gb:.1f}/{dk_total_gb:.1f} GB)')

    # Uptime
    uptime = stats.get('uptime', stats.get('systemUptime', ''))
    if uptime:
        if isinstance(uptime, (int, float)):
            hours = int(uptime // 3600)
            mins = int((uptime % 3600) // 60)
            print(f'  Uptime:  {hours}h {mins}m')
        else:
            print(f'  Uptime:  {uptime}')

    # Network
    net = stats.get('network', stats.get('networkTraffic', {}))
    if isinstance(net, dict):
        rx = net.get('rx', net.get('received', 0)) or 0
        tx = net.get('tx', net.get('sent', 0)) or 0
        rx_gb = rx / (1024**3) if rx > 1e6 else rx
        tx_gb = tx / (1024**3) if tx > 1e6 else tx
        print(f'  Network: ↓ {rx_gb:.2f} GB  ↑ {tx_gb:.2f} GB')

    # Users
    users = stats.get('users', stats.get('userStats', {}))
    if isinstance(users, dict):
        print(f'  Users:   {users.get(\"total\", 0)} total, {users.get(\"active\", 0)} active, {users.get(\"online\", 0)} online')

except Exception as e:
    print(f'  Error parsing system stats: {e}')
" 2>/dev/null

  echo ""
}

traffic_user_summary() {
  local token="$1" api_base="$2"

  echo ""
  echo -e "${YELLOW}  Top Users by Traffic:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/users?limit=20&page=1" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    users = data.get('data', data.get('users', []))
    if not users:
        print('  No users found.')
        sys.exit()

    # Sort by traffic usage descending
    def get_traffic(u):
        v = u.get('usedTraffic', u.get('dataUsage', 0))
        return v if v else 0
    users.sort(key=get_traffic, reverse=True)

    print(f'  {\"#\":<4} {\"Email\":<30} {\"Status\":<10} {\"Used\":<12} {\"Limit\":<12} {\"Usage %\":<10}')
    print('  ' + '─' * 78)
    for i, u in enumerate(users[:20], 1):
        email = u.get('email', 'N/A')[:28]
        status = u.get('status', 'N/A')
        used = get_traffic(u)
        limit_val = u.get('dataLimit', 0) or 0
        used_gb = used / (1024**3) if used > 1000 else used
        limit_gb = limit_val / (1024**3) if limit_val > 1000 else limit_val
        limit_str = f'{limit_gb:.1f} GB' if limit_gb > 0 else '∞'
        if limit_gb > 0:
            pct = (used_gb / limit_gb * 100) if limit_gb > 0 else 0
            bar_filled = min(int(pct / 10), 10)
            bar_empty = 10 - bar_filled
            pct_bar = '█' * bar_filled + '░' * bar_empty
            pct_str = f'{pct_bar} {pct:.0f}%'
        else:
            pct_str = '          N/A'
        status_icon = '●' if status == 'ACTIVE' else '○'
        print(f'  {i:<4} {email:<30} {status_icon} {status:<8} {used_gb:>7.1f} GB  {limit_str:>8}     {pct_str}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

traffic_online_users() {
  local token="$1" api_base="$2"

  echo ""
  echo -e "${YELLOW}  Currently Online Users:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/xray/online" 2>/dev/null)"

  if [ -z "$response" ] || [ "$response" = "null" ]; then
    echo "  No online data available."
    echo ""
    return
  fi

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    online = data.get('data', data.get('online', data))
    if isinstance(online, list):
        if not online:
            print('  No users currently online.')
            sys.exit()
        print(f'  {\"Email\":<30} {\"Inbound\":<20} {\"IP Address\":<18}')
        print('  ' + '─' * 68)
        for o in online:
            email = str(o.get('email', o.get('user', 'N/A')))[:28]
            inbound = str(o.get('inbound', o.get('tag', 'N/A')))[:18]
            ip = str(o.get('ip', o.get('ipAddress', 'N/A')))[:16]
            print(f'  {email:<30} {inbound:<20} {ip:<18}')
        print(f'\n  Total online: {len(online)}')
    elif isinstance(online, dict):
        count = online.get('count', online.get('total', len(online)))
        print(f'  Online users: {count}')
        users_list = online.get('users', [])
        if users_list:
            for o in users_list:
                email = str(o.get('email', 'N/A'))[:28]
                print(f'    ● {email}')
    else:
        print(f'  Online: {online}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

traffic_inbound_summary() {
  local token="$1" api_base="$2"

  echo ""
  echo -e "${YELLOW}  Inbound Summary:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/inbounds?limit=100" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    inbounds = data.get('data', data.get('inbounds', []))
    if not inbounds:
        print('  No inbounds found.')
        sys.exit()

    print(f'  {\"ID\":<5} {\"Tag\":<25} {\"Protocol\":<12} {\"Port\":<7} {\"Network\":<10} {\"Security\":<10} {\"Status\":<8} {\"Users\":<6}')
    print('  ' + '─' * 88)
    for i in inbounds:
        iid = i.get('id', '?')
        tag = str(i.get('tag', 'N/A'))[:23]
        proto = i.get('protocol', '?')
        port = i.get('port', '?')
        net = i.get('network', 'TCP')
        sec = i.get('security', 'NONE')
        enabled = i.get('enabled', True)
        status = '● ON' if enabled else '○ OFF'
        user_count = len(i.get('users', i.get('userInbounds', [])))
        print(f'  {iid:<5} {tag:<25} {proto:<12} {port:<7} {net:<10} {sec:<10} {status:<8} {user_count:<6}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

traffic_live_monitor() {
  local token="$1" api_base="$2"

  echo ""
  echo -e "${CYAN}  Live Session Monitor${NC}"
  echo -e "${YELLOW}  Refreshing every 5 seconds. Press Ctrl+C to stop.${NC}"
  echo ""

  local _monitor_running=true
  trap '_monitor_running=false' INT

  while [ "$_monitor_running" = "true" ]; do
    local snapshot
    snapshot="$(curl -s --max-time 4 -H "Authorization: Bearer ${token}" \
      "${api_base}/users/sessions?limit=50" 2>/dev/null)" || true

    clear 2>/dev/null || true
    echo -e "${CYAN}  ═══ Live Session Monitor ═══${NC}  $(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "  ─────────────────────────────────────────────────────────────────────────"

    echo "$snapshot" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    sessions = data.get('data', data.get('sessions', []))
    active = [s for s in sessions if s.get('status') == 'ONLINE' or s.get('online', False)]
    if not active:
        print('  No active sessions.')
        sys.exit()

    print(f'  {\"Email\":<28} {\"Inbound\":<18} {\"IP\":<16} {\"Duration\":<12}')
    print('  ' + '─' * 74)
    for s in active[:30]:
        email = str(s.get('email', s.get('user', {}).get('email', 'N/A')))[:26]
        inbound = str(s.get('inboundTag', s.get('inbound', 'N/A')))[:16]
        ip = str(s.get('ip', s.get('clientIp', 'N/A')))[:14]
        duration = str(s.get('duration', s.get('connectedTime', '')))[:10]
        print(f'  ● {email:<26} {inbound:<18} {ip:<16} {duration:<12}')

    print(f'\n  Active sessions: {len(active)}')
except Exception as e:
    print(f'  Waiting for data... ({e})')
" 2>/dev/null

    echo ""
    echo -e "  ${YELLOW}Press Ctrl+C to stop${NC}"
    sleep 5 || true
  done

  trap - INT
  echo ""
  echo -e "${GREEN}[✓]${NC} Monitor stopped."
}

# ============================================
# 32. Inbound Quick-Add
# ============================================

inbound_quickadd() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Inbound Quick-Add                               ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate. Make sure the backend is running."
    return
  fi

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  echo -e "  ${GREEN}1)${NC} VLESS + REALITY (recommended)"
  echo -e "  ${GREEN}2)${NC} VLESS + WS + TLS"
  echo -e "  ${GREEN}3)${NC} VLESS + gRPC + TLS"
  echo -e "  ${GREEN}4)${NC} VMess + WS"
  echo -e "  ${GREEN}5)${NC} Trojan + TLS"
  echo -e "  ${GREEN}6)${NC} Shadowsocks"
  echo -e "  ${GREEN}7)${NC} Custom (specify all params)"
  echo -e "  ${GREEN}8)${NC} Myanmar Preset (all protocols)"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-8]: " inbound_choice

  case "${inbound_choice}" in
    1) inbound_add_preset "$token" "$api_base" "VLESS" "TCP" "REALITY" ;;
    2) inbound_add_preset "$token" "$api_base" "VLESS" "WS" "TLS" ;;
    3) inbound_add_preset "$token" "$api_base" "VLESS" "GRPC" "TLS" ;;
    4) inbound_add_preset "$token" "$api_base" "VMESS" "WS" "NONE" ;;
    5) inbound_add_preset "$token" "$api_base" "TROJAN" "TCP" "TLS" ;;
    6) inbound_add_preset "$token" "$api_base" "SHADOWSOCKS" "TCP" "NONE" ;;
    7) inbound_add_custom "$token" "$api_base" ;;
    8) inbound_myanmar_preset "$token" "$api_base" ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

inbound_add_preset() {
  local token="$1" api_base="$2" protocol="$3" network="$4" security="$5"
  echo ""
  echo -e "${CYAN}  ── ${protocol} + ${network} + ${security} ──${NC}"
  echo ""

  local server_address tag inbound_port server_name

  # Server address
  local default_addr
  default_addr="$(get_server_ip)"
  read -r -p "  Server address [${default_addr}]: " server_address
  server_address="${server_address:-${default_addr}}"

  # Tag
  local default_tag="${protocol,,}-${network,,}-${security,,}"
  read -r -p "  Tag [${default_tag}]: " tag
  tag="${tag:-${default_tag}}"

  # Port (get random available port)
  local random_port
  random_port="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/inbounds/random-port" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    port = data.get('data', {}).get('port') or data.get('port', '')
    print(port)
except Exception:
    print('')
" 2>/dev/null)"
  random_port="${random_port:-$(find_available_port)}"

  read -r -p "  Port [${random_port}]: " inbound_port
  inbound_port="${inbound_port:-${random_port}}"

  # Build payload
  local payload="{\"protocol\":\"${protocol}\",\"network\":\"${network}\",\"security\":\"${security}\",\"port\":${inbound_port},\"tag\":\"${tag}\",\"serverAddress\":\"${server_address}\""

  # Protocol-specific options
  if [ "$security" = "TLS" ] || [ "$security" = "REALITY" ]; then
    read -r -p "  Server Name (SNI) [${server_address}]: " server_name
    server_name="${server_name:-${server_address}}"
    payload="${payload},\"serverName\":\"${server_name}\""
  fi

  if [ "$security" = "REALITY" ]; then
    echo -e "${BLUE}[*]${NC} Generating REALITY keys..."
    local keys_response
    keys_response="$(curl -s -H "Authorization: Bearer ${token}" \
      "${api_base}/inbounds/reality/keys" 2>/dev/null)"

    local pub_key priv_key
    pub_key="$(echo "$keys_response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(d.get('data', d).get('publicKey', ''))
except: print('')
" 2>/dev/null)"
    priv_key="$(echo "$keys_response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(d.get('data', d).get('privateKey', ''))
except: print('')
" 2>/dev/null)"

    if [ -n "$pub_key" ] && [ -n "$priv_key" ]; then
      echo -e "${GREEN}[✓]${NC} REALITY keys generated."

      local reality_dest short_id reality_sni
      read -r -p "  REALITY dest [www.microsoft.com:443]: " reality_dest
      reality_dest="${reality_dest:-www.microsoft.com:443}"

      read -r -p "  REALITY SNI [www.microsoft.com]: " reality_sni
      reality_sni="${reality_sni:-www.microsoft.com}"

      short_id="$(openssl rand -hex 4 2>/dev/null || head -c 8 /dev/urandom | xxd -p)"

      payload="${payload},\"realityPublicKey\":\"${pub_key}\",\"realityPrivateKey\":\"${priv_key}\""
      payload="${payload},\"realityDest\":\"${reality_dest}\",\"realityShortIds\":[\"${short_id}\"]"
      payload="${payload},\"realityServerNames\":[\"${reality_sni}\"],\"realityFingerprint\":\"chrome\""
      payload="${payload},\"serverName\":\"${reality_sni}\""
    else
      echo -e "${YELLOW}[!]${NC} Could not generate REALITY keys. Continuing without."
    fi
  fi

  if [ "$network" = "WS" ]; then
    local ws_path
    read -r -p "  WebSocket path [/ws]: " ws_path
    ws_path="${ws_path:-/ws}"
    payload="${payload},\"wsPath\":\"${ws_path}\""
  fi

  if [ "$network" = "GRPC" ]; then
    local grpc_service
    read -r -p "  gRPC service name [grpc-service]: " grpc_service
    grpc_service="${grpc_service:-grpc-service}"
    payload="${payload},\"grpcServiceName\":\"${grpc_service}\""
  fi

  if [ "$protocol" = "SHADOWSOCKS" ]; then
    echo -e "  Cipher options: chacha20-ietf-poly1305, aes-256-gcm, aes-128-gcm"
    local cipher
    read -r -p "  Cipher [chacha20-ietf-poly1305]: " cipher
    cipher="${cipher:-chacha20-ietf-poly1305}"
    payload="${payload},\"cipher\":\"${cipher}\""
  fi

  payload="${payload}}"

  echo ""
  echo -e "${BLUE}[*]${NC} Creating inbound..."

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${api_base}/inbounds" 2>/dev/null)"

  local new_id
  new_id="$(echo "$response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(d.get('data', d).get('id', ''))
except: print('')
" 2>/dev/null)"

  if [ -n "$new_id" ] && [ "$new_id" != "" ]; then
    echo -e "${GREEN}[✓]${NC} Inbound created! (ID: ${new_id})"
    echo ""
    echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    i = d.get('data', d)
    print(f'  Tag:      {i.get(\"tag\", \"N/A\")}')
    print(f'  Protocol: {i.get(\"protocol\", \"N/A\")}')
    print(f'  Port:     {i.get(\"port\", \"N/A\")}')
    print(f'  Network:  {i.get(\"network\", \"N/A\")}')
    print(f'  Security: {i.get(\"security\", \"N/A\")}')
    if i.get('realityPublicKey'):
        print(f'  REALITY PubKey: {i.get(\"realityPublicKey\", \"\")[:30]}...')
except: pass
" 2>/dev/null
  else
    echo -e "${RED}[✗]${NC} Failed to create inbound."
    echo "$response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(f'  Error: {d.get(\"error\", d.get(\"message\", str(d)))}')
except: print(sys.stdin.read()[:200])
" 2>/dev/null
  fi
  echo ""
}

inbound_add_custom() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Custom Inbound ──${NC}"
  echo ""

  local protocol network security server_address tag inbound_port

  echo -e "  Protocols: VLESS, VMESS, TROJAN, SHADOWSOCKS, SOCKS, HTTP, DOKODEMO_DOOR, WIREGUARD, MTPROTO"
  read -r -p "  Protocol: " protocol
  protocol="${protocol^^}"

  echo -e "  Networks:  TCP, WS, GRPC, HTTP, HTTPUPGRADE, XHTTP"
  read -r -p "  Network [TCP]: " network
  network="${network:-TCP}"
  network="${network^^}"

  echo -e "  Security:  NONE, TLS, REALITY"
  read -r -p "  Security [NONE]: " security
  security="${security:-NONE}"
  security="${security^^}"

  local default_addr
  default_addr="$(get_server_ip)"
  read -r -p "  Server address [${default_addr}]: " server_address
  server_address="${server_address:-${default_addr}}"

  read -r -p "  Tag: " tag
  if [ -z "$tag" ]; then
    tag="${protocol,,}-${network,,}-custom"
  fi

  local random_port
  random_port="$(find_available_port)"
  read -r -p "  Port [${random_port}]: " inbound_port
  inbound_port="${inbound_port:-${random_port}}"

  local remark
  read -r -p "  Remark (optional): " remark

  local payload="{\"protocol\":\"${protocol}\",\"network\":\"${network}\",\"security\":\"${security}\",\"port\":${inbound_port},\"tag\":\"${tag}\",\"serverAddress\":\"${server_address}\""
  if [ -n "$remark" ]; then
    payload="${payload},\"remark\":\"${remark}\""
  fi
  payload="${payload}}"

  echo ""
  echo -e "${BLUE}[*]${NC} Creating custom inbound..."

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${api_base}/inbounds" 2>/dev/null)"

  local new_id
  new_id="$(echo "$response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(d.get('data', d).get('id', ''))
except: print('')
" 2>/dev/null)"

  if [ -n "$new_id" ] && [ "$new_id" != "" ]; then
    echo -e "${GREEN}[✓]${NC} Custom inbound created! (ID: ${new_id})"
  else
    echo -e "${RED}[✗]${NC} Failed to create inbound."
    echo "$response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(f'  Error: {d.get(\"error\", d.get(\"message\", str(d)))}')
except: print(sys.stdin.read()[:200])
" 2>/dev/null
  fi
  echo ""
}

inbound_myanmar_preset() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Myanmar Preset ──${NC}"
  echo -e "  This creates a full suite of inbounds optimized for Myanmar."
  echo ""

  local server_address server_name cdn_host

  local default_addr
  default_addr="$(get_server_ip)"
  read -r -p "  Server address [${default_addr}]: " server_address
  server_address="${server_address:-${default_addr}}"

  read -r -p "  Server Name (SNI, optional): " server_name
  read -r -p "  CDN Host (optional): " cdn_host

  local payload="{\"serverAddress\":\"${server_address}\""
  [ -n "$server_name" ] && payload="${payload},\"serverName\":\"${server_name}\""
  [ -n "$cdn_host" ] && payload="${payload},\"cdnHost\":\"${cdn_host}\""
  payload="${payload}}"

  if ! confirm "Create Myanmar preset inbounds?"; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  echo -e "${BLUE}[*]${NC} Creating Myanmar preset..."

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${api_base}/inbounds/presets/myanmar" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    created = d.get('data', d).get('created', d.get('inbounds', []))
    if isinstance(created, list):
        print(f'  Created {len(created)} inbounds:')
        for i in created:
            name = i.get('tag', i.get('name', 'N/A'))
            proto = i.get('protocol', '?')
            port = i.get('port', '?')
            print(f'    ● {name} ({proto} :{port})')
    else:
        print(f'  Result: {d}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

# ============================================
# 33. Domain / Subscription URL Management
# ============================================

subscription_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Domain / Subscription URL                       ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local env_file="$ROOT_DIR/backend/.env"
  local current_sub_url current_domain

  current_sub_url="$(grep -oP '^SUBSCRIPTION_URL=\K.*' "$env_file" 2>/dev/null || echo "")"
  current_domain="$(grep -oP '^PANEL_DOMAIN=\K.*' "$env_file" 2>/dev/null || echo "")"

  echo -e "${YELLOW}  Current Configuration:${NC}"
  echo -e "  ─────────────────────────────────────────"
  if [ -n "$current_sub_url" ]; then
    echo -e "  Subscription URL: ${GREEN}${current_sub_url}${NC}"
  else
    echo -e "  Subscription URL: ${YELLOW}○ Not configured${NC}"
  fi
  if [ -n "$current_domain" ]; then
    echo -e "  Panel Domain:     ${GREEN}${current_domain}${NC}"
  else
    echo -e "  Panel Domain:     ${YELLOW}○ Not configured${NC}"
  fi
  echo ""

  echo -e "  ${GREEN}1)${NC} Set Subscription URL"
  echo -e "  ${GREEN}2)${NC} Set Panel Domain"
  echo -e "  ${GREEN}3)${NC} Auto-detect & Configure"
  echo -e "  ${GREEN}4)${NC} Test Subscription URL"
  echo -e "  ${GREEN}5)${NC} View User Subscription Links"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-5]: " sub_choice

  case "${sub_choice}" in
    1) subscription_set_url "$env_file" ;;
    2) subscription_set_domain "$env_file" ;;
    3) subscription_auto_detect "$env_file" ;;
    4) subscription_test ;;
    5) subscription_view_links ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

subscription_set_url() {
  local env_file="$1"
  echo ""

  local current
  current="$(grep -oP '^SUBSCRIPTION_URL=\K.*' "$env_file" 2>/dev/null || echo "")"

  echo -e "  The Subscription URL is the public base URL where users access"
  echo -e "  their subscription links (e.g., https://panel.example.com)"
  echo ""

  if [ -n "$current" ]; then
    echo -e "  Current: ${BLUE}${current}${NC}"
  fi

  local new_url
  read -r -p "  Enter subscription URL (e.g. https://panel.example.com): " new_url

  if [ -z "$new_url" ]; then
    return
  fi

  # Remove trailing slash
  new_url="${new_url%/}"

  if grep -q "^SUBSCRIPTION_URL=" "$env_file" 2>/dev/null; then
    sed -i "s|^SUBSCRIPTION_URL=.*|SUBSCRIPTION_URL=${new_url}|" "$env_file"
  else
    echo "SUBSCRIPTION_URL=${new_url}" >> "$env_file"
  fi

  echo -e "${GREEN}[✓]${NC} Subscription URL set to: ${new_url}"

  echo -e "${BLUE}[*]${NC} Restarting backend..."
  cd "$ROOT_DIR"
  compose restart backend
  sleep 2
  echo -e "${GREEN}[✓]${NC} Done."
  echo ""
}

subscription_set_domain() {
  local env_file="$1"
  echo ""

  local current
  current="$(grep -oP '^PANEL_DOMAIN=\K.*' "$env_file" 2>/dev/null || echo "")"

  if [ -n "$current" ]; then
    echo -e "  Current domain: ${BLUE}${current}${NC}"
  fi

  local new_domain
  read -r -p "  Enter panel domain (e.g. panel.example.com): " new_domain

  if [ -z "$new_domain" ]; then
    return
  fi

  if grep -q "^PANEL_DOMAIN=" "$env_file" 2>/dev/null; then
    sed -i "s|^PANEL_DOMAIN=.*|PANEL_DOMAIN=${new_domain}|" "$env_file"
  else
    echo "PANEL_DOMAIN=${new_domain}" >> "$env_file"
  fi

  echo -e "${GREEN}[✓]${NC} Panel domain set to: ${new_domain}"

  # Auto-set subscription URL if not set
  local existing_sub
  existing_sub="$(grep -oP '^SUBSCRIPTION_URL=\K.*' "$env_file" 2>/dev/null || echo "")"
  if [ -z "$existing_sub" ]; then
    local panel_path panel_port scheme
    panel_path="$(get_panel_path)"
    panel_port="$(get_panel_port)"

    # Check if SSL is configured
    if [ -f "${DATA_DIR}/certs/fullchain.pem" ]; then
      scheme="https"
    else
      scheme="http"
    fi

    local auto_url="${scheme}://${new_domain}"
    if [ "$panel_port" != "443" ] && [ "$panel_port" != "80" ]; then
      auto_url="${auto_url}:${panel_port}"
    fi

    if grep -q "^SUBSCRIPTION_URL=" "$env_file" 2>/dev/null; then
      sed -i "s|^SUBSCRIPTION_URL=.*|SUBSCRIPTION_URL=${auto_url}|" "$env_file"
    else
      echo "SUBSCRIPTION_URL=${auto_url}" >> "$env_file"
    fi
    echo -e "${GREEN}[✓]${NC} Subscription URL auto-set to: ${auto_url}"
  fi

  echo -e "${BLUE}[*]${NC} Restarting backend..."
  cd "$ROOT_DIR"
  compose restart backend
  sleep 2
  echo -e "${GREEN}[✓]${NC} Done."
  echo ""
}

subscription_auto_detect() {
  local env_file="$1"
  echo ""
  echo -e "${BLUE}[*]${NC} Auto-detecting configuration..."

  local server_ip panel_port panel_path scheme domain
  server_ip="$(get_server_ip)"
  panel_port="$(get_panel_port)"
  panel_path="$(get_panel_path)"

  # Check SSL
  if [ -f "${DATA_DIR}/certs/fullchain.pem" ]; then
    scheme="https"
    domain="$(openssl x509 -in "${DATA_DIR}/certs/fullchain.pem" -noout -subject 2>/dev/null | sed 's/.*CN = //' || echo "")"
    echo -e "  SSL detected: ${GREEN}${domain}${NC}"
  else
    scheme="http"
    domain=""
    echo -e "  SSL: ${YELLOW}Not configured${NC}"
  fi

  local base_url
  if [ -n "$domain" ]; then
    base_url="${scheme}://${domain}"
    if [ "$panel_port" != "443" ] && [ "$panel_port" != "80" ]; then
      base_url="${base_url}:${panel_port}"
    fi
  else
    base_url="${scheme}://${server_ip}:${panel_port}"
  fi

  echo -e "  Detected URL: ${BLUE}${base_url}${NC}"
  echo ""

  if confirm "Set subscription URL to ${base_url}?"; then
    if grep -q "^SUBSCRIPTION_URL=" "$env_file" 2>/dev/null; then
      sed -i "s|^SUBSCRIPTION_URL=.*|SUBSCRIPTION_URL=${base_url}|" "$env_file"
    else
      echo "SUBSCRIPTION_URL=${base_url}" >> "$env_file"
    fi

    if [ -n "$domain" ]; then
      if grep -q "^PANEL_DOMAIN=" "$env_file" 2>/dev/null; then
        sed -i "s|^PANEL_DOMAIN=.*|PANEL_DOMAIN=${domain}|" "$env_file"
      else
        echo "PANEL_DOMAIN=${domain}" >> "$env_file"
      fi
    fi

    echo -e "${BLUE}[*]${NC} Restarting backend..."
    cd "$ROOT_DIR"
    compose restart backend
    sleep 2
    echo -e "${GREEN}[✓]${NC} Configuration updated!"
  fi
  echo ""
}

subscription_test() {
  echo ""
  local port panel_path
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"

  echo -e "${BLUE}[*]${NC} Testing subscription endpoint..."

  local health_status
  health_status="$(curl -s -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:${port}${panel_path}/sub/test-token" 2>/dev/null || echo "000")"

  if [ "$health_status" = "404" ] || [ "$health_status" = "200" ]; then
    echo -e "${GREEN}[✓]${NC} Subscription endpoint is responding (HTTP ${health_status})"
  elif [ "$health_status" = "000" ]; then
    echo -e "${RED}[✗]${NC} Backend is not reachable."
  else
    echo -e "${YELLOW}[!]${NC} Subscription endpoint returned HTTP ${health_status}"
  fi

  local env_file="$ROOT_DIR/backend/.env"
  local sub_url
  sub_url="$(grep -oP '^SUBSCRIPTION_URL=\K.*' "$env_file" 2>/dev/null || echo "")"

  if [ -n "$sub_url" ]; then
    echo -e "  Subscription base: ${BLUE}${sub_url}${NC}"
    echo -e "  User link format:  ${CYAN}${sub_url}${panel_path}/sub/<TOKEN>${NC}"
  else
    echo -e "${YELLOW}[!]${NC} SUBSCRIPTION_URL is not set. User links may not work correctly."
    echo -e "  Set it with: ${CYAN}one-ui subscription${NC} → Set Subscription URL"
  fi
  echo ""
}

subscription_view_links() {
  echo ""
  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate."
    return
  fi

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  local env_file="$ROOT_DIR/backend/.env"
  local sub_url
  sub_url="$(grep -oP '^SUBSCRIPTION_URL=\K.*' "$env_file" 2>/dev/null || echo "http://$(get_server_ip):${port}")"

  echo -e "${YELLOW}  User Subscription Links:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/users?limit=50" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json, os
sub_url = '${sub_url}'
panel_path = '${panel_path}'
try:
    data = json.load(sys.stdin)
    users = data.get('data', data.get('users', []))
    if not users:
        print('  No users found.')
        sys.exit()

    for u in users:
        email = u.get('email', 'N/A')
        status = u.get('status', 'N/A')
        token = u.get('subscriptionToken', '')
        status_icon = '●' if status == 'ACTIVE' else '○'
        print(f'  {status_icon} {email} ({status})')
        if token:
            print(f'    Sub:   {sub_url}{panel_path}/sub/{token}')
            print(f'    Clash: {sub_url}{panel_path}/sub/{token}/clash')
        else:
            print(f'    (no subscription token)')
        print()
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

# ============================================
# 34. Health Check
# ============================================

health_check() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Health Check                                    ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  local all_ok=true

  # 1. Backend API Health
  echo -e "  ${YELLOW}Checking services...${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────"
  echo ""

  local api_status api_time
  api_time="$(date +%s%N)"
  api_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    "${api_base}/system/health" 2>/dev/null || echo "000")"
  local api_elapsed=$(( ( $(date +%s%N) - api_time ) / 1000000 ))

  if [ "$api_status" = "200" ]; then
    echo -e "  Backend API:      ${GREEN}● Healthy${NC} (${api_elapsed}ms)"
  elif [ "$api_status" = "000" ]; then
    echo -e "  Backend API:      ${RED}✗ Unreachable${NC}"
    all_ok=false
  else
    echo -e "  Backend API:      ${RED}✗ HTTP ${api_status}${NC} (${api_elapsed}ms)"
    all_ok=false
  fi

  # 2. Database Connectivity
  local db_status
  db_status="$(docker exec one-ui-db pg_isready -U postgres 2>/dev/null)"
  if echo "$db_status" | grep -q "accepting connections"; then
    echo -e "  Database:         ${GREEN}● Connected${NC}"
  else
    echo -e "  Database:         ${RED}✗ Not responding${NC}"
    all_ok=false
  fi

  # 3. Docker containers
  local backend_running db_running xray_running
  backend_running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -Fx "one-ui-backend" || echo "")"
  db_running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -Fx "one-ui-db" || echo "")"
  xray_running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -Fx "$CONTAINER_NAME" || echo "")"

  if [ -n "$backend_running" ]; then
    echo -e "  Backend Docker:   ${GREEN}● Running${NC}"
  else
    echo -e "  Backend Docker:   ${RED}✗ Stopped${NC}"
    all_ok=false
  fi

  if [ -n "$db_running" ]; then
    echo -e "  Database Docker:  ${GREEN}● Running${NC}"
  else
    echo -e "  Database Docker:  ${RED}✗ Stopped${NC}"
    all_ok=false
  fi

  if [ -n "$xray_running" ]; then
    echo -e "  Xray Docker:      ${GREEN}● Running${NC}"
  else
    echo -e "  Xray Docker:      ${RED}✗ Stopped${NC}"
    all_ok=false
  fi

  # 4. Xray API Responsiveness
  if [ -n "$xray_running" ]; then
    local xray_ver
    xray_ver="$(docker exec "$CONTAINER_NAME" xray version 2>/dev/null | head -n 1 || echo "")"
    if [ -n "$xray_ver" ]; then
      echo -e "  Xray Core:        ${GREEN}● Responsive${NC} (${xray_ver})"
    else
      echo -e "  Xray Core:        ${YELLOW}! Cannot read version${NC}"
    fi
  fi

  echo ""

  # 5. Disk Space
  echo -e "  ${YELLOW}Resource Usage:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────"
  echo ""

  local disk_usage disk_pct
  disk_usage="$(df -h / 2>/dev/null | tail -1)"
  disk_pct="$(echo "$disk_usage" | awk '{print $5}' | tr -d '%')"

  if [ -n "$disk_pct" ]; then
    local disk_total disk_used disk_avail
    disk_total="$(echo "$disk_usage" | awk '{print $2}')"
    disk_used="$(echo "$disk_usage" | awk '{print $3}')"
    disk_avail="$(echo "$disk_usage" | awk '{print $4}')"

    if [ "$disk_pct" -lt 80 ]; then
      echo -e "  Disk Space:       ${GREEN}● ${disk_pct}% used${NC} (${disk_used}/${disk_total}, ${disk_avail} free)"
    elif [ "$disk_pct" -lt 90 ]; then
      echo -e "  Disk Space:       ${YELLOW}! ${disk_pct}% used${NC} (${disk_used}/${disk_total}, ${disk_avail} free)"
    else
      echo -e "  Disk Space:       ${RED}✗ ${disk_pct}% used${NC} (${disk_used}/${disk_total}, ${disk_avail} free) ${RED}CRITICAL${NC}"
      all_ok=false
    fi
  fi

  # Memory
  local mem_info
  mem_info="$(free -h 2>/dev/null | grep Mem)"
  if [ -n "$mem_info" ]; then
    local mem_total mem_used mem_avail
    mem_total="$(echo "$mem_info" | awk '{print $2}')"
    mem_used="$(echo "$mem_info" | awk '{print $3}')"
    mem_avail="$(echo "$mem_info" | awk '{print $7}')"
    echo -e "  Memory:           ${GREEN}●${NC} ${mem_used}/${mem_total} used (${mem_avail} available)"
  fi

  # Docker disk usage
  local docker_size
  docker_size="$(docker system df --format '{{.Type}}\t{{.Size}}' 2>/dev/null)"
  if [ -n "$docker_size" ]; then
    echo ""
    echo -e "  ${YELLOW}Docker Storage:${NC}"
    while IFS=$'\t' read -r dtype dsize; do
      echo -e "    ${dtype}: ${BLUE}${dsize}${NC}"
    done <<< "$docker_size"
  fi

  echo ""

  # 6. SSL Certificate Expiry
  echo -e "  ${YELLOW}SSL Certificate:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────"
  echo ""

  if [ -f "${DATA_DIR}/certs/fullchain.pem" ]; then
    local ssl_domain ssl_expiry_date ssl_expiry_epoch now_epoch days_left
    ssl_domain="$(openssl x509 -in "${DATA_DIR}/certs/fullchain.pem" -noout -subject 2>/dev/null | sed 's/.*CN = //' || echo "unknown")"
    ssl_expiry_date="$(openssl x509 -in "${DATA_DIR}/certs/fullchain.pem" -noout -enddate 2>/dev/null | sed 's/.*=//' || echo "")"
    ssl_expiry_epoch="$(date -d "$ssl_expiry_date" +%s 2>/dev/null || echo "0")"
    now_epoch="$(date +%s)"

    if [ "$ssl_expiry_epoch" -gt 0 ]; then
      days_left=$(( (ssl_expiry_epoch - now_epoch) / 86400 ))

      if [ "$days_left" -gt 30 ]; then
        echo -e "  Certificate:      ${GREEN}● Valid${NC} (${ssl_domain})"
        echo -e "  Expires:          ${BLUE}${ssl_expiry_date}${NC} (${days_left} days)"
      elif [ "$days_left" -gt 7 ]; then
        echo -e "  Certificate:      ${YELLOW}! Expiring soon${NC} (${ssl_domain})"
        echo -e "  Expires:          ${YELLOW}${ssl_expiry_date}${NC} (${days_left} days)"
      elif [ "$days_left" -gt 0 ]; then
        echo -e "  Certificate:      ${RED}✗ Expiring very soon!${NC} (${ssl_domain})"
        echo -e "  Expires:          ${RED}${ssl_expiry_date}${NC} (${days_left} days)"
        all_ok=false
      else
        echo -e "  Certificate:      ${RED}✗ EXPIRED!${NC} (${ssl_domain})"
        echo -e "  Expired:          ${RED}${ssl_expiry_date}${NC}"
        all_ok=false
      fi
    else
      echo -e "  Certificate:      ${YELLOW}! Cannot determine expiry${NC}"
    fi
  else
    echo -e "  Certificate:      ${YELLOW}○ Not configured${NC}"
  fi

  echo ""

  # 7. Port accessibility
  echo -e "  ${YELLOW}Port Accessibility:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────"
  echo ""

  local panel_port_val
  panel_port_val="$(get_panel_port)"
  if is_port_in_use "$panel_port_val"; then
    echo -e "  Panel (${panel_port_val}):      ${GREEN}● Listening${NC}"
  else
    echo -e "  Panel (${panel_port_val}):      ${RED}✗ Not listening${NC}"
    all_ok=false
  fi

  # Check common Xray ports
  local xray_ports
  xray_ports="$(docker exec "$CONTAINER_NAME" sh -c 'ss -ltn 2>/dev/null || netstat -tln 2>/dev/null' 2>/dev/null | grep -oP ':\K[0-9]+' | sort -un | head -10)"
  if [ -n "$xray_ports" ]; then
    for xport in $xray_ports; do
      if [ "$xport" != "$panel_port_val" ] && [ "$xport" -gt 1024 ]; then
        echo -e "  Xray (${xport}):       ${GREEN}● Listening${NC}"
      fi
    done
  fi

  echo ""

  # Summary
  echo -e "  ─────────────────────────────────────────────────────────────"
  if [ "$all_ok" = "true" ]; then
    echo -e "  ${GREEN}  ✓ All health checks passed!${NC}"
  else
    echo -e "  ${RED}  ✗ Some health checks failed. Review above.${NC}"
  fi
  echo ""
}

# ============================================
# 35. Security Rules Manager
# ============================================

security_rules_management() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Security Rules Manager                          ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate. Make sure the backend is running."
    return
  fi

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  echo -e "  ${GREEN}1)${NC} List Rules"
  echo -e "  ${GREEN}2)${NC} Add Block Rule (IP/CIDR/Country)"
  echo -e "  ${GREEN}3)${NC} Add Allow Rule (whitelist)"
  echo -e "  ${GREEN}4)${NC} Toggle Rule (enable/disable)"
  echo -e "  ${GREEN}5)${NC} Delete Rule"
  echo -e "  ${GREEN}6)${NC} Test IP Against Rules"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-6]: " sec_choice

  case "${sec_choice}" in
    1) security_rules_list "$token" "$api_base" ;;
    2) security_rules_add "$token" "$api_base" "BLOCK" ;;
    3) security_rules_add "$token" "$api_base" "ALLOW" ;;
    4) security_rules_toggle "$token" "$api_base" ;;
    5) security_rules_delete "$token" "$api_base" ;;
    6) security_rules_test "$token" "$api_base" ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

security_rules_list() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${YELLOW}  Security Rules:${NC}"
  echo -e "  ─────────────────────────────────────────────────────────────────────────────────────────"

  local response
  response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/settings/security/rules" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    rules = data.get('data', data.get('rules', data if isinstance(data, list) else []))
    if isinstance(rules, dict):
        rules = rules.get('rules', [])
    if not rules:
        print('  No rules configured.')
        sys.exit()

    print(f'  {\"ID\":<5} {\"Name\":<20} {\"Action\":<8} {\"Type\":<8} {\"Target\":<22} {\"Pri\":<5} {\"Status\":<8} {\"Note\":<15}')
    print('  ' + '─' * 91)
    for r in rules:
        rid = r.get('id', '?')
        name = str(r.get('name', 'N/A'))[:18]
        action = r.get('action', '?')
        ttype = r.get('targetType', '?')
        tval = str(r.get('targetValue', 'N/A'))[:20]
        pri = r.get('priority', 100)
        enabled = r.get('enabled', True)
        note = str(r.get('note', '') or '')[:13]
        status = '● ON' if enabled else '○ OFF'
        action_icon = '🛡' if action == 'ALLOW' else '⛔'
        print(f'  {rid:<5} {name:<20} {action_icon} {action:<6} {ttype:<8} {tval:<22} {pri:<5} {status:<8} {note:<15}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

security_rules_add() {
  local token="$1" api_base="$2" action="$3"
  echo ""

  if [ "$action" = "BLOCK" ]; then
    echo -e "${CYAN}  ── Add Block Rule ──${NC}"
  else
    echo -e "${CYAN}  ── Add Allow Rule (Whitelist) ──${NC}"
  fi
  echo ""

  local name target_type target_value priority note

  read -r -p "  Rule name: " name
  if [ -z "$name" ]; then
    echo -e "${RED}[✗]${NC} Name is required."
    return
  fi

  echo -e "  Target types: ${CYAN}IP${NC} | ${CYAN}CIDR${NC} | ${CYAN}COUNTRY${NC}"
  read -r -p "  Target type: " target_type
  target_type="${target_type^^}"

  if [ "$target_type" != "IP" ] && [ "$target_type" != "CIDR" ] && [ "$target_type" != "COUNTRY" ]; then
    echo -e "${RED}[✗]${NC} Invalid target type. Must be IP, CIDR, or COUNTRY."
    return
  fi

  case "$target_type" in
    IP)      read -r -p "  IP address (e.g. 192.168.1.1): " target_value ;;
    CIDR)    read -r -p "  CIDR block (e.g. 10.0.0.0/8): " target_value ;;
    COUNTRY) read -r -p "  Country code (e.g. US, CN, IR): " target_value ;;
  esac

  if [ -z "$target_value" ]; then
    echo -e "${RED}[✗]${NC} Target value is required."
    return
  fi

  read -r -p "  Priority [100] (1=highest, 10000=lowest): " priority
  priority="${priority:-100}"

  read -r -p "  Note (optional): " note

  local payload="{\"name\":\"${name}\",\"action\":\"${action}\",\"targetType\":\"${target_type}\",\"targetValue\":\"${target_value}\",\"priority\":${priority},\"enabled\":true"
  if [ -n "$note" ]; then
    payload="${payload},\"note\":\"${note}\""
  fi
  payload="${payload}}"

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${api_base}/settings/security/rules" 2>/dev/null)"

  local new_id
  new_id="$(echo "$response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(d.get('data', d).get('id', ''))
except: print('')
" 2>/dev/null)"

  if [ -n "$new_id" ] && [ "$new_id" != "" ]; then
    echo -e "${GREEN}[✓]${NC} Rule created! (ID: ${new_id})"
    echo -e "  ${action} ${target_type}:${target_value} (priority ${priority})"
  else
    echo -e "${RED}[✗]${NC} Failed to create rule."
    echo "$response" | python3 -c "
import sys, json
try: d = json.load(sys.stdin); print(f'  Error: {d.get(\"error\", d.get(\"message\", str(d)))}')
except: pass
" 2>/dev/null
  fi
  echo ""
}

security_rules_toggle() {
  local token="$1" api_base="$2"
  echo ""

  security_rules_list "$token" "$api_base"

  local rule_id new_state
  read -r -p "  Enter rule ID to toggle: " rule_id
  if [ -z "$rule_id" ]; then return; fi

  echo -e "  ${GREEN}1)${NC} Enable"
  echo -e "  ${GREEN}2)${NC} Disable"
  read -r -p "  Select [1-2]: " toggle_choice

  case "${toggle_choice}" in
    1) new_state="true" ;;
    2) new_state="false" ;;
    *) echo -e "${RED}Invalid option.${NC}"; return ;;
  esac

  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"enabled\":${new_state}}" \
    "${api_base}/settings/security/rules/${rule_id}/enabled" 2>/dev/null)"

  if [ "$http_code" = "200" ]; then
    if [ "$new_state" = "true" ]; then
      echo -e "${GREEN}[✓]${NC} Rule ${rule_id} enabled."
    else
      echo -e "${GREEN}[✓]${NC} Rule ${rule_id} disabled."
    fi
  else
    echo -e "${RED}[✗]${NC} Failed to toggle rule (HTTP ${http_code})."
  fi
  echo ""
}

security_rules_delete() {
  local token="$1" api_base="$2"
  echo ""

  security_rules_list "$token" "$api_base"

  local rule_id
  read -r -p "  Enter rule ID to DELETE: " rule_id
  if [ -z "$rule_id" ]; then return; fi

  if ! confirm "Are you sure you want to delete rule ${rule_id}?"; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
    -H "Authorization: Bearer ${token}" \
    "${api_base}/settings/security/rules/${rule_id}" 2>/dev/null)"

  if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}[✓]${NC} Rule ${rule_id} deleted."
  else
    echo -e "${RED}[✗]${NC} Failed to delete rule (HTTP ${http_code})."
  fi
  echo ""
}

security_rules_test() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Test IP Against Rules ──${NC}"
  echo ""

  local test_ip test_country
  read -r -p "  IP address to test (leave empty for your IP): " test_ip
  read -r -p "  Country code (optional, e.g. US): " test_country

  local payload="{"
  local first=true
  if [ -n "$test_ip" ]; then
    payload="${payload}\"ip\":\"${test_ip}\""
    first=false
  fi
  if [ -n "$test_country" ]; then
    if [ "$first" = "false" ]; then payload="${payload},"; fi
    payload="${payload}\"country\":\"${test_country}\""
  fi
  payload="${payload}}"

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${api_base}/settings/security/rules/evaluate" 2>/dev/null)"

  echo ""
  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    allowed = result.get('allowed', None)
    reason = result.get('reason', 'N/A')
    ctx = result.get('context', {})
    matched = result.get('matchedRule', None)

    if allowed is True:
        print('  Result: ✅ ALLOWED')
    elif allowed is False:
        print('  Result: ⛔ BLOCKED')
    else:
        print(f'  Result: {result}')

    print(f'  Reason: {reason}')
    if ctx:
        print(f'  Tested IP:      {ctx.get(\"ip\", \"N/A\")}')
        print(f'  Tested Country: {ctx.get(\"country\", \"N/A\")}')
    if matched:
        print(f'  Matched Rule:   #{matched.get(\"id\", \"?\")} \"{matched.get(\"name\", \"N/A\")}\" ({matched.get(\"action\", \"?\")} {matched.get(\"targetType\", \"?\")}: {matched.get(\"targetValue\", \"?\")})')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

# ============================================
# 36. Bulk User Operations
# ============================================

bulk_operations() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║              Bulk User Operations                            ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  local token
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate. Make sure the backend is running."
    return
  fi

  local port panel_path api_base
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"

  echo -e "  ${GREEN}1)${NC} Bulk Create Users"
  echo -e "  ${GREEN}2)${NC} Bulk Update Status"
  echo -e "  ${GREEN}3)${NC} Bulk Extend Expiry"
  echo -e "  ${GREEN}4)${NC} Bulk Reset Traffic"
  echo -e "  ${GREEN}5)${NC} Bulk Assign Inbounds"
  echo -e "  ${GREEN}6)${NC} Bulk Rotate Keys"
  echo -e "  ${GREEN}7)${NC} Bulk Delete Users"
  echo -e "  ${GREEN}0)${NC} Back"
  echo ""

  read -r -p "  Select [0-7]: " bulk_choice

  case "${bulk_choice}" in
    1) bulk_create "$token" "$api_base" ;;
    2) bulk_update_status "$token" "$api_base" ;;
    3) bulk_extend_expiry "$token" "$api_base" ;;
    4) bulk_reset_traffic "$token" "$api_base" ;;
    5) bulk_assign_inbounds "$token" "$api_base" ;;
    6) bulk_rotate_keys "$token" "$api_base" ;;
    7) bulk_delete "$token" "$api_base" ;;
    0|"") return ;;
    *) echo -e "${RED}Invalid option.${NC}" ;;
  esac
}

bulk_create() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Bulk Create Users ──${NC}"
  echo ""

  local prefix domain count data_limit expiry_days padding

  read -r -p "  Email prefix (e.g. user, vpn): " prefix
  if [ -z "$prefix" ]; then
    echo -e "${RED}[✗]${NC} Prefix is required."
    return
  fi

  read -r -p "  Email domain (e.g. panel.com): " domain
  if [ -z "$domain" ]; then
    echo -e "${RED}[✗]${NC} Domain is required."
    return
  fi

  read -r -p "  Number of users to create (1-200) [10]: " count
  count="${count:-10}"

  read -r -p "  Data limit per user (GB, 0=unlimited) [0]: " data_limit
  data_limit="${data_limit:-0}"

  read -r -p "  Expiry days [30]: " expiry_days
  expiry_days="${expiry_days:-30}"

  read -r -p "  Zero-padding digits (0-8) [3]: " padding
  padding="${padding:-3}"

  echo ""
  echo -e "  Preview: ${CYAN}${prefix}001@${domain}${NC} ... ${CYAN}${prefix}$(printf "%0${padding}d" "$count")@${domain}${NC}"
  echo ""

  # Fetch and show available inbounds
  echo -e "${BLUE}[*]${NC} Fetching available inbounds..."
  local inbounds_response
  inbounds_response="$(curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/inbounds?limit=100" 2>/dev/null)"

  echo "$inbounds_response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    inbounds = data.get('data', data.get('inbounds', []))
    for i in inbounds:
        iid = i.get('id', '?')
        tag = i.get('tag', 'N/A')
        proto = i.get('protocol', '?')
        port = i.get('port', '?')
        enabled = '●' if i.get('enabled', True) else '○'
        print(f'    {iid}: {enabled} {tag} ({proto} :{port})')
except: pass
" 2>/dev/null
  echo ""

  local inbound_ids_input
  read -r -p "  Inbound IDs (comma-separated): " inbound_ids_input
  if [ -z "$inbound_ids_input" ]; then
    echo -e "${RED}[✗]${NC} At least one inbound ID is required."
    return
  fi

  local inbound_json
  inbound_json="$(echo "$inbound_ids_input" | python3 -c "
import sys
ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]
print(str(ids))
" 2>/dev/null)"

  if ! confirm "Create ${count} users (${prefix}*@${domain})?"; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  echo -e "${BLUE}[*]${NC} Creating ${count} users..."

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"prefix\":\"${prefix}\",\"domain\":\"${domain}\",\"count\":${count},\"dataLimit\":${data_limit},\"expiryDays\":${expiry_days},\"padding\":${padding},\"inboundIds\":${inbound_json}}" \
    "${api_base}/users/bulk/create" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    created_count = result.get('createdCount', len(result.get('created', [])))
    failed = result.get('failed', [])
    print(f'  Created: {created_count} users')
    if failed:
        print(f'  Failed:  {len(failed)} users')
        for f in failed[:5]:
            print(f'    ✗ {f.get(\"email\", \"?\")} — {f.get(\"reason\", \"unknown\")}')
        if len(failed) > 5:
            print(f'    ... and {len(failed)-5} more')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  echo ""
}

bulk_update_status() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Bulk Update Status ──${NC}"
  echo ""

  echo -e "  Status options: ${CYAN}ACTIVE${NC} | ${CYAN}DISABLED${NC} | ${CYAN}EXPIRED${NC} | ${CYAN}LIMITED${NC}"
  local new_status
  read -r -p "  New status: " new_status
  new_status="${new_status^^}"

  if [ "$new_status" != "ACTIVE" ] && [ "$new_status" != "DISABLED" ] && [ "$new_status" != "EXPIRED" ] && [ "$new_status" != "LIMITED" ]; then
    echo -e "${RED}[✗]${NC} Invalid status."
    return
  fi

  local user_ids_input
  read -r -p "  User IDs (comma-separated): " user_ids_input
  if [ -z "$user_ids_input" ]; then return; fi

  local user_ids_json
  user_ids_json="$(echo "$user_ids_input" | python3 -c "
import sys; ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]; print(str(ids))
" 2>/dev/null)"

  local count
  count="$(echo "$user_ids_json" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)"

  if ! confirm "Set ${count} users to ${new_status}?"; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\":${user_ids_json},\"status\":\"${new_status}\"}" \
    "${api_base}/users/bulk/update-status" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    print(f'  Updated: {result.get(\"updatedCount\", \"?\")} users set to ${new_status}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null
  echo ""
}

bulk_extend_expiry() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Bulk Extend Expiry ──${NC}"
  echo ""

  local user_ids_input days
  read -r -p "  User IDs (comma-separated): " user_ids_input
  if [ -z "$user_ids_input" ]; then return; fi

  read -r -p "  Days to extend: " days
  if [ -z "$days" ]; then return; fi

  local user_ids_json
  user_ids_json="$(echo "$user_ids_input" | python3 -c "
import sys; ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]; print(str(ids))
" 2>/dev/null)"

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\":${user_ids_json},\"days\":${days}}" \
    "${api_base}/users/bulk/extend-expiry" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    print(f'  Extended: {result.get(\"updatedCount\", \"?\")} users by ${days} days')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null
  echo ""
}

bulk_reset_traffic() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Bulk Reset Traffic ──${NC}"
  echo ""

  local user_ids_input
  read -r -p "  User IDs (comma-separated): " user_ids_input
  if [ -z "$user_ids_input" ]; then return; fi

  local user_ids_json
  user_ids_json="$(echo "$user_ids_input" | python3 -c "
import sys; ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]; print(str(ids))
" 2>/dev/null)"

  if ! confirm "Reset traffic for all specified users?"; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\":${user_ids_json}}" \
    "${api_base}/users/bulk/reset-traffic" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    print(f'  Reset: {result.get(\"updatedCount\", \"?\")} users traffic counters')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null
  echo ""
}

bulk_assign_inbounds() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Bulk Assign Inbounds ──${NC}"
  echo ""

  local user_ids_input
  read -r -p "  User IDs (comma-separated): " user_ids_input
  if [ -z "$user_ids_input" ]; then return; fi

  # Show available inbounds
  echo ""
  echo -e "${BLUE}[*]${NC} Available inbounds:"
  curl -s -H "Authorization: Bearer ${token}" \
    "${api_base}/inbounds?limit=100" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    inbounds = data.get('data', data.get('inbounds', []))
    for i in inbounds:
        iid = i.get('id', '?')
        tag = i.get('tag', 'N/A')
        proto = i.get('protocol', '?')
        port = i.get('port', '?')
        enabled = '●' if i.get('enabled', True) else '○'
        print(f'    {iid}: {enabled} {tag} ({proto} :{port})')
except: pass
" 2>/dev/null
  echo ""

  local inbound_ids_input mode
  read -r -p "  Inbound IDs to assign (comma-separated): " inbound_ids_input
  if [ -z "$inbound_ids_input" ]; then return; fi

  echo -e "  Mode: ${CYAN}merge${NC} (add to existing) | ${CYAN}replace${NC} (overwrite all)"
  read -r -p "  Mode [merge]: " mode
  mode="${mode:-merge}"

  local user_ids_json inbound_ids_json
  user_ids_json="$(echo "$user_ids_input" | python3 -c "
import sys; ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]; print(str(ids))
" 2>/dev/null)"
  inbound_ids_json="$(echo "$inbound_ids_input" | python3 -c "
import sys; ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]; print(str(ids))
" 2>/dev/null)"

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\":${user_ids_json},\"inboundIds\":${inbound_ids_json},\"mode\":\"${mode}\"}" \
    "${api_base}/users/bulk/assign-inbounds" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    print(f'  Updated: {result.get(\"updatedCount\", \"?\")} users (mode: ${mode})')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null
  echo ""
}

bulk_rotate_keys() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${CYAN}  ── Bulk Rotate Keys ──${NC}"
  echo ""

  local user_ids_input
  read -r -p "  User IDs (comma-separated): " user_ids_input
  if [ -z "$user_ids_input" ]; then return; fi

  echo ""
  echo -e "  What to rotate:"
  echo -e "  ${GREEN}1)${NC} UUID + Password + Subscription Token (all)"
  echo -e "  ${GREEN}2)${NC} UUID + Password only"
  echo -e "  ${GREEN}3)${NC} Subscription Token only"
  echo ""
  read -r -p "  Select [1-3]: " rotate_choice

  local rotate_uuid="true" rotate_pass="true" rotate_sub="true"
  case "${rotate_choice}" in
    1) rotate_uuid="true"; rotate_pass="true"; rotate_sub="true" ;;
    2) rotate_uuid="true"; rotate_pass="true"; rotate_sub="false" ;;
    3) rotate_uuid="false"; rotate_pass="false"; rotate_sub="true" ;;
    *) echo -e "${RED}Invalid option.${NC}"; return ;;
  esac

  local user_ids_json
  user_ids_json="$(echo "$user_ids_input" | python3 -c "
import sys; ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]; print(str(ids))
" 2>/dev/null)"

  if ! confirm "Rotate keys for all specified users? Active connections will be disrupted."; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\":${user_ids_json},\"rotateUuid\":${rotate_uuid},\"rotatePassword\":${rotate_pass},\"rotateSubscriptionToken\":${rotate_sub}}" \
    "${api_base}/users/bulk/keys/rotate" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    updated = result.get('updatedCount', '?')
    users = result.get('users', [])
    print(f'  Rotated: {updated} users')
    if users:
        print(f'  {\"ID\":<5} {\"New UUID\":<38} {\"New Sub Token\":<40}')
        print('  ' + '─' * 83)
        for u in users[:10]:
            uid = u.get('id', '?')
            uuid = str(u.get('uuid', 'N/A'))[:36]
            sub = str(u.get('subscriptionToken', 'N/A'))[:38]
            print(f'  {uid:<5} {uuid:<38} {sub:<40}')
        if len(users) > 10:
            print(f'  ... and {len(users)-10} more')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null
  echo ""
}

bulk_delete() {
  local token="$1" api_base="$2"
  echo ""
  echo -e "${RED}  ── Bulk Delete Users ──${NC}"
  echo ""

  local user_ids_input
  read -r -p "  User IDs to DELETE (comma-separated): " user_ids_input
  if [ -z "$user_ids_input" ]; then return; fi

  local user_ids_json
  user_ids_json="$(echo "$user_ids_input" | python3 -c "
import sys; ids = [int(x.strip()) for x in sys.stdin.read().strip().split(',') if x.strip().isdigit()]; print(str(ids))
" 2>/dev/null)"

  local count
  count="$(echo "$user_ids_json" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)"

  echo -e "${RED}  ⚠ WARNING: This will permanently delete ${count} users and all their data!${NC}"
  if ! confirm "Are you absolutely sure?"; then
    echo -e "${YELLOW}[!]${NC} Cancelled."
    return
  fi

  local response
  response="$(curl -s -X POST -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\":${user_ids_json}}" \
    "${api_base}/users/bulk/delete" 2>/dev/null)"

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('data', data)
    print(f'  Deleted: {result.get(\"deletedCount\", \"?\")} users')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null
  echo ""
}

# ============================================
# CLI Helper — Authenticated user actions
# ============================================

_cli_user_action() {
  local action="$1"
  shift
  local token port panel_path api_base
  token="$(get_admin_token)"
  if [ -z "$token" ]; then
    echo -e "${RED}[✗]${NC} Could not authenticate."
    return 1
  fi
  port="$(get_panel_port)"
  panel_path="$(get_panel_path)"
  api_base="http://127.0.0.1:${port}${panel_path}/api"
  "$action" "$token" "$api_base" "$@"
}

# ============================================
# Interactive Menu
# ============================================

show_menu() {
  clear 2>/dev/null || true
  print_banner
  show_status

  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Panel Management${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN} 1)${NC}  Install (Re-install One-UI)"
  echo -e "  ${GREEN} 2)${NC}  Update One-UI"
  echo -e "  ${GREEN} 3)${NC}  Legacy Version"
  echo -e "  ${GREEN} 4)${NC}  Uninstall"
  echo ""
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Configuration${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN} 5)${NC}  Reset Username & Password"
  echo -e "  ${GREEN} 6)${NC}  Reset Web Base Path"
  echo -e "  ${GREEN} 7)${NC}  Reset Settings"
  echo -e "  ${GREEN} 8)${NC}  Change Port"
  echo ""
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Service Management${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN} 9)${NC}  View Current Settings"
  echo -e "  ${GREEN}10)${NC}  Check Status"
  echo -e "  ${GREEN}11)${NC}  Start One-UI"
  echo -e "  ${GREEN}12)${NC}  Stop One-UI"
  echo -e "  ${GREEN}13)${NC}  Restart One-UI"
  echo -e "  ${GREEN}14)${NC}  Logs Management"
  echo -e "  ${GREEN}15)${NC}  Enable Autostart"
  echo -e "  ${GREEN}16)${NC}  Disable Autostart"
  echo ""
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Xray Core${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN}17)${NC}  Update Xray (stable)"
  echo -e "  ${GREEN}18)${NC}  Update Xray (latest)"
  echo -e "  ${GREEN}19)${NC}  Rollback Xray"
  echo -e "  ${GREEN}20)${NC}  Show Xray Version"
  echo ""
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Security & Network${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN}21)${NC}  SSL Certificate Management"
  echo -e "  ${GREEN}22)${NC}  Cloudflare SSL Certificate"
  echo -e "  ${GREEN}23)${NC}  IP Limit Management"
  echo -e "  ${GREEN}24)${NC}  Firewall Management"
  echo -e "  ${GREEN}25)${NC}  SSH Port Forwarding Management"
  echo ""
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Notifications & Data${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN}26)${NC}  Telegram Bot Configuration"
  echo -e "  ${GREEN}27)${NC}  Backup & Restore"
  echo -e "  ${GREEN}28)${NC}  Two-Factor Authentication (2FA)"
  echo ""
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Users & Traffic${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN}29)${NC}  User Management"
  echo -e "  ${GREEN}30)${NC}  Traffic Monitoring Dashboard"
  echo -e "  ${GREEN}31)${NC}  Inbound Quick-Add"
  echo -e "  ${GREEN}32)${NC}  Domain / Subscription URL"
  echo -e "  ${GREEN}33)${NC}  Security Rules Manager"
  echo -e "  ${GREEN}34)${NC}  Bulk User Operations"
  echo ""
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}  Maintenance${NC}"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
  echo ""
  echo -e "  ${GREEN}35)${NC}  Health Check"
  echo -e "  ${GREEN}36)${NC}  Run Smoke Tests"
  echo ""
  echo -e "  ${GREEN} 0)${NC}  Exit"
  echo ""

  read -r -p "  Please enter your choice [0-36]: " choice

  case "$choice" in
    1)  do_install ;;
    2)  update_oneui ;;
    3)  install_legacy_version ;;
    4)  do_uninstall ;;
    5)  reset_credentials ;;
    6)  reset_web_base_path ;;
    7)  reset_settings ;;
    8)  change_port ;;
    9)  view_settings ;;
    10) show_status ;;
    11) start_services ;;
    12) stop_services ;;
    13) restart_services ;;
    14) show_logs_menu ;;
    15) enable_autostart ;;
    16) disable_autostart ;;
    17) update_xray "stable" ;;
    18) update_xray "latest" ;;
    19) [ -x "$UPDATE_SCRIPT" ] && "$UPDATE_SCRIPT" --rollback || echo "Update script not found" ;;
    20) show_xray_status ;;
    21) ssl_management ;;
    22) cloudflare_ssl ;;
    23) ip_limit_management ;;
    24) firewall_management ;;
    25) ssh_forwarding_management ;;
    26) telegram_management ;;
    27) backup_management ;;
    28) twofa_management ;;
    29) user_management ;;
    30) traffic_dashboard ;;
    31) inbound_quickadd ;;
    32) subscription_management ;;
    33) security_rules_management ;;
    34) bulk_operations ;;
    35) health_check ;;
    36) run_smoke_suite ;;
    0)
      echo -e "${GREEN}Bye.${NC}"
      exit 0
      ;;
    *)
      echo -e "${RED}Invalid option.${NC}"
      ;;
  esac
}

# ============================================
# Main — CLI and Interactive
# ============================================

case "${1:-}" in
  --help|-h|help)
    echo "One-UI Management Console v${SCRIPT_VERSION}"
    echo ""
    echo "Usage: one-ui [command]"
    echo ""
    echo "Commands:"
    echo "  menu                Open interactive menu"
    echo "  status              Show service status"
    echo "  info                Show panel info"
    echo "  start               Start services"
    echo "  stop                Stop services"
    echo "  restart             Restart services"
    echo "  logs [service]      View logs (backend|db|xray)"
    echo "  update              Update One-UI to latest"
    echo "  install             Re-install One-UI"
    echo "  uninstall           Uninstall One-UI"
    echo ""
    echo "  reset-password      Reset admin credentials"
    echo "  reset-path          Reset web base path"
    echo "  reset-settings      Reset to default settings"
    echo "  port                Change panel port"
    echo "  settings            View current settings"
    echo ""
    echo "  enable              Enable autostart"
    echo "  disable             Disable autostart"
    echo ""
    echo "  ssl                 SSL certificate management"
    echo "  cf-ssl              Cloudflare SSL certificate"
    echo "  ip-limit            IP limit management"
    echo "  firewall            Firewall management"
    echo "  ssh-forward         SSH port forwarding"
    echo ""
    echo "  telegram            Telegram bot configuration"
    echo "  backup              Backup & restore management"
    echo "  setup-2fa           Two-factor authentication"
    echo ""
    echo "  users               User management"
    echo "  list-users          List all users"
    echo "  add-user            Add a new user"
    echo "  traffic             Traffic monitoring dashboard"
    echo "  add-inbound         Inbound quick-add"
    echo "  subscription        Domain / subscription URL management"
    echo "  security-rules      Security rules manager"
    echo "  bulk                Bulk user operations"
    echo "  health              Health check (all services)"
    echo ""
    echo "  xray-update         Update Xray (stable)"
    echo "  xray-latest         Update Xray (latest)"
    echo "  xray-rollback       Rollback Xray"
    echo "  xray-version        Show Xray version"
    echo "  smoke               Run smoke tests"
    echo ""
    exit 0
    ;;
  status)
    show_status
    ;;
  info)
    show_status
    ;;
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    restart_services
    ;;
  logs)
    shift
    _log_service="${1:-}"
    echo -e "${CYAN}Showing One-UI logs (Ctrl+C to exit)${NC}"
    cd "$ROOT_DIR"
    if [ -n "$_log_service" ]; then
      compose logs -f --tail=100 "$_log_service"
    else
      compose logs -f --tail=100
    fi
    ;;
  update)
    update_oneui
    ;;
  install|reinstall)
    do_install
    ;;
  uninstall)
    do_uninstall
    ;;
  reset-password|reset-credentials)
    reset_credentials
    ;;
  reset-path)
    reset_web_base_path
    ;;
  reset-settings)
    reset_settings
    ;;
  port|change-port)
    change_port
    ;;
  settings|view-settings)
    view_settings
    ;;
  enable)
    enable_autostart
    ;;
  disable)
    disable_autostart
    ;;
  ssl)
    ssl_management
    ;;
  cf-ssl|cloudflare-ssl)
    cloudflare_ssl
    ;;
  ip-limit)
    ip_limit_management
    ;;
  firewall)
    firewall_management
    ;;
  ssh-forward|ssh-forwarding)
    ssh_forwarding_management
    ;;
  telegram|telegram-bot)
    telegram_management
    ;;
  backup|backups)
    backup_management
    ;;
  backup-create)
    backup_create
    ;;
  backup-list)
    backup_list
    ;;
  backup-restore)
    shift 2>/dev/null || true
    backup_restore
    ;;
  setup-2fa|2fa|twofa)
    twofa_management
    ;;
  users|user-management)
    user_management
    ;;
  list-users|user-list)
    _cli_user_action "user_list"
    ;;
  add-user|user-add)
    _cli_user_action "user_add"
    ;;
  search-user|user-search)
    _cli_user_action "user_search"
    ;;
  disable-user)
    _cli_user_action "user_toggle_status" "DISABLED"
    ;;
  enable-user)
    _cli_user_action "user_toggle_status" "ACTIVE"
    ;;
  traffic|traffic-dashboard)
    traffic_dashboard
    ;;
  add-inbound|inbound-add|inbound)
    inbound_quickadd
    ;;
  subscription|sub-url|domain)
    subscription_management
    ;;
  security-rules|security|rules)
    security_rules_management
    ;;
  bulk|bulk-ops)
    bulk_operations
    ;;
  bulk-create)
    _cli_user_action "bulk_create"
    ;;
  health|healthcheck|health-check)
    health_check
    ;;
  xray-update)
    update_xray "stable"
    ;;
  xray-latest)
    update_xray "latest"
    ;;
  xray-rollback)
    [ -x "$UPDATE_SCRIPT" ] && "$UPDATE_SCRIPT" --rollback || echo "Update script not found"
    ;;
  xray-version)
    show_xray_status
    ;;
  smoke)
    run_smoke_suite
    ;;
  "")
    # Interactive menu loop
    while true; do
      show_menu
      echo ""
      read -r -p "  Press Enter to continue..." _
    done
    ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}"
    echo "Run 'one-ui help' for available commands."
    exit 1
    ;;
esac

#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_NAME="One-UI"

# Runtime configuration (defaults can be overridden by env/flags)
NON_INTERACTIVE="${ONEUI_NON_INTERACTIVE:-${XRAY_PANEL_NON_INTERACTIVE:-false}}"
SKIP_SSL="${ONEUI_SKIP_SSL:-${XRAY_PANEL_SKIP_SSL:-false}}"
REPAIR_MODE="${ONEUI_REPAIR:-${XRAY_PANEL_REPAIR:-false}}"

PANEL_PORT="${ONEUI_PORT:-${XRAY_PANEL_PORT:-}}"
DB_PORT="${ONEUI_DB_PORT:-${XRAY_PANEL_DB_PORT:-}}"
PANEL_PATH="${ONEUI_PANEL_PATH:-${XRAY_PANEL_PATH:-}}"

DOMAIN="${ONEUI_DOMAIN:-${XRAY_PANEL_DOMAIN:-${SSL_DOMAIN:-}}}"
ADMIN_USER="${ONEUI_ADMIN_USER:-${XRAY_PANEL_ADMIN_USER:-admin}}"
ADMIN_PASS="${ONEUI_ADMIN_PASS:-${XRAY_PANEL_ADMIN_PASS:-}}"
ADMIN_PASS_FILE="${ONEUI_ADMIN_PASS_FILE:-${XRAY_PANEL_ADMIN_PASS_FILE:-}}"
SSL_EMAIL="${ONEUI_SSL_EMAIL:-${XRAY_PANEL_SSL_EMAIL:-}}"
CF_EMAIL="${ONEUI_CF_EMAIL:-${XRAY_PANEL_CF_EMAIL:-${CLOUDFLARE_EMAIL:-${CLOUDFLARE_ACCOUNT_EMAIL:-}}}}"
CF_KEY="${ONEUI_CF_KEY:-${XRAY_PANEL_CF_KEY:-${CLOUDFLARE_API_KEY:-}}}"
CF_TOKEN="${ONEUI_CF_TOKEN:-${XRAY_PANEL_CF_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}}"
CF_ACCOUNT_ID="${ONEUI_CF_ACCOUNT_ID:-${XRAY_PANEL_CF_ACCOUNT_ID:-}}"
CF_ZONE_ID="${ONEUI_CF_ZONE_ID:-${XRAY_PANEL_CF_ZONE_ID:-${CLOUDFLARE_ZONE_ID:-}}}"

INSTALL_DIR="${ONEUI_INSTALL_DIR:-${XRAY_PANEL_INSTALL_DIR:-/opt/one-ui}}"
DATA_DIR="${ONEUI_DATA_DIR:-${XRAY_PANEL_DATA_DIR:-/var/lib/one-ui}}"
BACKUP_DIR="${ONEUI_BACKUP_DIR:-${XRAY_PANEL_BACKUP_DIR:-/var/backups/one-ui}}"

print_banner() {
  echo -e "${GREEN}"
  echo "========================================="
  echo "        ${PROJECT_NAME} Installer v1.0"
  echo "========================================="
  echo -e "${NC}"
}

info() {
  echo -e "${YELLOW}$*${NC}"
}

ok() {
  echo -e "${GREEN}$*${NC}"
}

warn() {
  echo -e "${YELLOW}$*${NC}"
}

fail() {
  echo -e "${RED}$*${NC}"
  exit 1
}

prompt_read() {
  # Read user input from /dev/tty when available. This keeps prompts working even when
  # the installer is piped into bash (e.g. wget -qO- ... | sudo bash).
  #
  # Usage:
  #   prompt_read var_name "Prompt: " "default" [silent=0|1]
  local __var="$1"
  local __prompt="$2"
  local __default="${3:-}"
  local __silent="${4:-0}"
  local __value=""

  # Prefer /dev/tty for interactive prompts when stdin is not a TTY.
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    if [ "${__silent}" = "1" ]; then
      IFS= read -r -s -p "${__prompt}" __value < /dev/tty || fail "Failed to read input from TTY."
      echo
    else
      IFS= read -r -p "${__prompt}" __value < /dev/tty || fail "Failed to read input from TTY."
    fi
  elif [ -t 0 ]; then
    if [ "${__silent}" = "1" ]; then
      IFS= read -r -s -p "${__prompt}" __value || fail "Failed to read input."
      echo
    else
      IFS= read -r -p "${__prompt}" __value || fail "Failed to read input."
    fi
  else
    fail "No TTY available for interactive prompts. Re-run with --non-interactive or set ONEUI_NON_INTERACTIVE=true."
  fi

  if [ -z "${__value}" ] && [ -n "${__default}" ]; then
    __value="${__default}"
  fi

  printf -v "${__var}" '%s' "${__value}"
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|y|Y|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

generate_random_path() {
  openssl rand -hex 4
}

# Ensure at least 1 GB swap exists so Vite builds don't get OOM-killed on small VPS instances.
ensure_swap() {
  local swap_total
  swap_total=$(free -m 2>/dev/null | awk '/^Swap:/ { print $2 }')
  if [ "${swap_total:-0}" -ge 1024 ]; then
    return  # enough swap already
  fi
  if [ -f /swapfile ]; then
    return  # swap file exists (may be active)
  fi
  info "Low memory detected — creating 1 GB swap file for build..."
  dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none 2>/dev/null || return 0
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null 2>&1 || { rm -f /swapfile; return 0; }
  swapon /swapfile 2>/dev/null || { rm -f /swapfile; return 0; }
  ok "Swap enabled (1 GB)."
}

find_available_port() {
  # Find an available port in the range 2000-9999, avoiding well-known ports.
  local port
  for _ in $(seq 1 50); do
    port=$(( (RANDOM % 8000) + 2000 ))
    if ! is_port_in_use "${port}"; then
      echo "${port}"
      return
    fi
  done
  # Fallback
  echo "3000"
}

find_available_db_port() {
  # Find an available port for postgres, starting from 5432.
  local port
  for port in 5432 5433 5434 5435 5436 5437 5438 5439 5440; do
    if ! is_port_in_use "${port}"; then
      echo "${port}"
      return
    fi
  done
  # Try random range
  for _ in $(seq 1 20); do
    port=$(( (RANDOM % 1000) + 5500 ))
    if ! is_port_in_use "${port}"; then
      echo "${port}"
      return
    fi
  done
  echo "5432"
}

print_usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --non-interactive           Run without prompts (env/flags only)
  --interactive               Force interactive prompts
  --port <port>               Panel port (auto-assigned if omitted or in use)
  --db-port <port>            Local DB port (auto-assigned if omitted or in use)
  --panel-path <path>         Panel sub-path for security (auto-generated if omitted)
  --domain <domain>           Domain used for subscription URL and SSL
  --admin-user <username>     Admin username (default: admin)
  --admin-pass <password>     Admin password
  --admin-pass-file <path>    Read admin password from file (first line)
  --ssl-email <email>         SSL email (default: admin@<domain>)
  --cf-email <email>          Cloudflare email
  --cf-key <key>              Cloudflare Global API key
  --cf-token <token>          Cloudflare API token (preferred)
  --cf-account-id <id>        Cloudflare account id (optional, for token-based DNS)
  --cf-zone-id <id>           Cloudflare zone id (optional)
  --skip-ssl                  Skip SSL issuance even if domain is set
  --repair                    Repair existing install (restart stack + migrations + health checks)
  --repo <git-url>            Override repository URL (XRAY_PANEL_REPO)
  -h, --help                  Show help

Ports and panel path are auto-assigned for security and to avoid conflicts.
Ports use random available ports; path uses a random 8-character hex string.

Environment equivalents (recommended ONEUI_*; XRAY_PANEL_* still supported):
  ONEUI_NON_INTERACTIVE=true
  ONEUI_PORT=3000                    (optional, auto-assigned if omitted)
  ONEUI_DB_PORT=5432                 (optional, auto-assigned if omitted)
  ONEUI_PANEL_PATH=a1b2c3d4          (optional, auto-generated if omitted)
  ONEUI_DOMAIN=example.com
  ONEUI_ADMIN_USER=admin
  ONEUI_ADMIN_PASS='strong-password'
  ONEUI_ADMIN_PASS_FILE=/run/secrets/admin_password
  ONEUI_SSL_EMAIL=admin@example.com
  ONEUI_CF_EMAIL=you@example.com
  ONEUI_CF_KEY=xxxx
  ONEUI_CF_TOKEN=cf_api_token
  ONEUI_CF_ACCOUNT_ID=cloudflare_account_id
  ONEUI_CF_ZONE_ID=cloudflare_zone_id
  ONEUI_SKIP_SSL=true
  ONEUI_REPAIR=true
  ONEUI_INSTALL_DIR=/opt/one-ui
  ONEUI_DATA_DIR=/var/lib/one-ui
  ONEUI_BACKUP_DIR=/var/backups/one-ui
  ONEUI_REPO=https://github.com/sankahchan/One-UI.git
EOF
}

parse_cli() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --non-interactive)
        NON_INTERACTIVE="true"
        ;;
      --interactive)
        NON_INTERACTIVE="false"
        ;;
      --skip-ssl)
        SKIP_SSL="true"
        ;;
      --repair)
        REPAIR_MODE="true"
        ;;
      --port)
        [ "$#" -ge 2 ] || fail "Missing value for --port"
        PANEL_PORT="$2"
        shift
        ;;
      --db-port)
        [ "$#" -ge 2 ] || fail "Missing value for --db-port"
        DB_PORT="$2"
        shift
        ;;
      --panel-path)
        [ "$#" -ge 2 ] || fail "Missing value for --panel-path"
        PANEL_PATH="$2"
        shift
        ;;
      --domain)
        [ "$#" -ge 2 ] || fail "Missing value for --domain"
        DOMAIN="$2"
        shift
        ;;
      --admin-user)
        [ "$#" -ge 2 ] || fail "Missing value for --admin-user"
        ADMIN_USER="$2"
        shift
        ;;
      --admin-pass)
        [ "$#" -ge 2 ] || fail "Missing value for --admin-pass"
        ADMIN_PASS="$2"
        shift
        ;;
      --admin-pass-file)
        [ "$#" -ge 2 ] || fail "Missing value for --admin-pass-file"
        ADMIN_PASS_FILE="$2"
        shift
        ;;
      --ssl-email)
        [ "$#" -ge 2 ] || fail "Missing value for --ssl-email"
        SSL_EMAIL="$2"
        shift
        ;;
      --cf-email)
        [ "$#" -ge 2 ] || fail "Missing value for --cf-email"
        CF_EMAIL="$2"
        shift
        ;;
      --cf-key)
        [ "$#" -ge 2 ] || fail "Missing value for --cf-key"
        CF_KEY="$2"
        shift
        ;;
      --cf-token)
        [ "$#" -ge 2 ] || fail "Missing value for --cf-token"
        CF_TOKEN="$2"
        shift
        ;;
      --cf-account-id)
        [ "$#" -ge 2 ] || fail "Missing value for --cf-account-id"
        CF_ACCOUNT_ID="$2"
        shift
        ;;
      --cf-zone-id)
        [ "$#" -ge 2 ] || fail "Missing value for --cf-zone-id"
        CF_ZONE_ID="$2"
        shift
        ;;
      --repo)
        [ "$#" -ge 2 ] || fail "Missing value for --repo"
        XRAY_PANEL_REPO="$2"
        shift
        ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1 (use --help)"
        ;;
    esac
    shift
  done
}

load_admin_password_from_file() {
  if [ -z "${ADMIN_PASS_FILE}" ]; then
    return
  fi

  if [ ! -r "${ADMIN_PASS_FILE}" ]; then
    fail "Admin password file is not readable: ${ADMIN_PASS_FILE}"
  fi

  ADMIN_PASS="$(head -n 1 "${ADMIN_PASS_FILE}" | tr -d '\r\n')"
}

validate_non_interactive_config() {
  # Ports are optional — they will be auto-assigned if empty.
  if [ -n "${PANEL_PORT}" ]; then
    if ! [[ "${PANEL_PORT}" =~ ^[0-9]+$ ]] || [ "${PANEL_PORT}" -lt 1 ] || [ "${PANEL_PORT}" -gt 65535 ]; then
      fail "Invalid panel port: ${PANEL_PORT} (expected 1-65535)."
    fi
  fi

  if [ -n "${DB_PORT}" ]; then
    if ! [[ "${DB_PORT}" =~ ^[0-9]+$ ]] || [ "${DB_PORT}" -lt 1 ] || [ "${DB_PORT}" -gt 65535 ]; then
      fail "Invalid DB port: ${DB_PORT} (expected 1-65535)."
    fi
  fi

  if [ -n "${DB_PORT}" ] && [ -n "${PANEL_PORT}" ] && [ "${DB_PORT}" = "${PANEL_PORT}" ]; then
    fail "DB port and panel port cannot be the same (${PANEL_PORT})."
  fi

  if [ -z "${ADMIN_USER}" ]; then
    fail "Admin username cannot be empty in non-interactive mode."
  fi

  if [ -z "${ADMIN_PASS}" ]; then
    fail "Admin password is required in non-interactive mode. Use --admin-pass, --admin-pass-file, or XRAY_PANEL_ADMIN_PASS."
  fi

  if [ -n "${DOMAIN}" ] && [ -z "${SSL_EMAIL}" ]; then
    SSL_EMAIL="admin@${DOMAIN}"
  fi

  if [ -n "${DOMAIN}" ] && ! is_truthy "${SKIP_SSL}"; then
    if [ -n "${CF_TOKEN}" ]; then
      return
    fi

    if [ -z "${CF_EMAIL}" ] || [ -z "${CF_KEY}" ]; then
      fail "Domain is set but Cloudflare credentials are missing. Provide --cf-token (preferred) or --cf-email/--cf-key, or set --skip-ssl."
    fi
  fi
}

compose() {
  # Prefer the modern Docker Compose v2 CLI plugin over the legacy Python v1.
  # The legacy docker-compose (Python) has known bugs such as KeyError: 'ContainerConfig'
  # when recreating containers.
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  fail "Neither 'docker compose' (v2) nor 'docker-compose' (v1) found. Install docker-compose-plugin."
}

ensure_root() {
  if [ "${EUID}" -ne 0 ]; then
    fail "Please run as root."
  fi
}

ensure_supported_os() {
  if [ ! -f /etc/os-release ]; then
    fail "Unsupported OS: /etc/os-release not found."
  fi

  # shellcheck disable=SC1091
  source /etc/os-release

  if [[ "${ID}" != "ubuntu" && "${ID}" != "debian" && "${ID_LIKE:-}" != *debian* ]]; then
    fail "Only Debian/Ubuntu are supported."
  fi

  ok "OS check passed: ${PRETTY_NAME}"
}

install_dependencies() {
  info "Installing dependencies..."
  apt-get update -qq

  # Install base dependencies first (these rarely fail)
  apt-get install -y -qq curl wget git nano ufw openssl lsof ca-certificates gnupg

  # Install Docker — prefer docker.io from Ubuntu/Debian repos, fall back to official Docker repo
  if ! command -v docker >/dev/null 2>&1; then
    info "Installing Docker..."
    if apt-get install -y -qq docker.io 2>/dev/null; then
      ok "Docker installed from system packages."
    else
      warn "docker.io package not available, installing from official Docker repository..."
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
      apt-get update -qq
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    fi
  fi

  # Ensure Docker Compose v2 plugin is available
  if ! docker compose version >/dev/null 2>&1; then
    info "Docker Compose plugin not found, attempting install..."
    if ! apt-get install -y -qq docker-compose-plugin 2>/dev/null; then
      warn "docker-compose-plugin package not available, installing manually..."
      local compose_arch
      compose_arch="$(uname -m)"
      case "${compose_arch}" in
        x86_64)  compose_arch="x86_64" ;;
        aarch64) compose_arch="aarch64" ;;
        armv7l)  compose_arch="armv7" ;;
      esac
      mkdir -p /usr/local/lib/docker/cli-plugins
      curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${compose_arch}" -o /usr/local/lib/docker/cli-plugins/docker-compose
      chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    fi

    # Verify it works now
    if ! docker compose version >/dev/null 2>&1; then
      # Last resort: try legacy docker-compose
      if ! command -v docker-compose >/dev/null 2>&1; then
        apt-get install -y -qq docker-compose 2>/dev/null || true
      fi
    fi
  fi

  systemctl enable docker
  systemctl restart docker
  ok "Dependencies installed."
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

stop_existing_containers() {
  # Auto-stop any existing One-UI containers so ports are freed for re-install.
  local has_existing=false

  for name in one-ui-backend one-ui-db xray-core one-ui-prometheus one-ui-alertmanager one-ui-grafana; do
    if docker ps -q --filter "name=${name}" 2>/dev/null | grep -q .; then
      has_existing=true
      break
    fi
  done

  if [ "${has_existing}" = "true" ]; then
    info "Stopping existing One-UI containers..."
    # Stop containers but preserve volumes (keeps database data across re-installs).
    # Using 'down' without -v keeps named volumes like postgres_data intact.
    if [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
      (cd "${INSTALL_DIR}" && compose down 2>/dev/null) || true
    fi
    # Force-stop any stragglers
    for name in one-ui-backend one-ui-db xray-core one-ui-prometheus one-ui-alertmanager one-ui-grafana; do
      docker stop "${name}" 2>/dev/null || true
      docker rm -f "${name}" 2>/dev/null || true
    done
    sleep 2
    ok "Existing containers stopped."
  fi
}

ensure_ports_available() {
  info "Checking ports..."

  # Auto-assign panel port if not specified
  if [ -z "${PANEL_PORT}" ]; then
    PANEL_PORT="$(find_available_port)"
    ok "Auto-assigned panel port: ${PANEL_PORT}"
  elif is_port_in_use "${PANEL_PORT}"; then
    warn "Port ${PANEL_PORT} is already in use. Finding an available port..."
    PANEL_PORT="$(find_available_port)"
    ok "Auto-assigned panel port: ${PANEL_PORT}"
  fi

  # Auto-assign DB port if not specified
  if [ -z "${DB_PORT}" ]; then
    DB_PORT="$(find_available_db_port)"
    ok "Auto-assigned database port: ${DB_PORT}"
  elif is_port_in_use "${DB_PORT}"; then
    warn "DB port ${DB_PORT} is already in use. Finding an available port..."
    DB_PORT="$(find_available_db_port)"
    ok "Auto-assigned database port: ${DB_PORT}"
  fi

  # Generate random panel path for security (like 3x-ui)
  if [ -z "${PANEL_PATH}" ]; then
    PANEL_PATH="$(generate_random_path)"
    ok "Generated random panel path: /${PANEL_PATH}/"
  fi

  ok "Ports available: panel=${PANEL_PORT}, db=127.0.0.1:${DB_PORT}, path=/${PANEL_PATH}/"
}

prepare_directories() {
  mkdir -p "${INSTALL_DIR}"
  mkdir -p "${DATA_DIR}/certs"
  mkdir -p "${BACKUP_DIR}"
  mkdir -p /var/log/xray
  touch /var/log/xray/access.log /var/log/xray/error.log /var/log/xray/output.log 2>/dev/null || true
  chown -R 65532:65532 /var/log/xray 2>/dev/null || true
  chmod 755 /var/log/xray 2>/dev/null || true
  chmod 664 /var/log/xray/*.log 2>/dev/null || true
}

download_project() {
  local repo_url="${ONEUI_REPO:-${XRAY_PANEL_REPO:-https://github.com/sankahchan/One-UI.git}}"

  cd "${INSTALL_DIR}"

  info "Downloading ${PROJECT_NAME}..."
  if [ -d ".git" ]; then
    git pull --ff-only || git pull
  else
    if [ -n "$(ls -A . 2>/dev/null)" ]; then
      fail "${INSTALL_DIR} is not empty and is not a git repository."
    fi
    git clone "${repo_url}" .
  fi
  # Ensure all shell scripts are executable (git may not preserve +x on some systems).
  find "${INSTALL_DIR}/scripts" -name '*.sh' -exec chmod +x {} + 2>/dev/null || true
  ok "Project downloaded."
}

prompt_config() {
  load_admin_password_from_file

  if is_truthy "${NON_INTERACTIVE}"; then
    info "Configuration (non-interactive mode)"
    validate_non_interactive_config
    return
  fi

  echo
  info "Configuration"
  echo

  local domain_input=""
  local admin_user_input=""

  if [ -n "${DOMAIN}" ]; then
    prompt_read domain_input "Enter domain name (or press Enter to skip SSL) [${DOMAIN}]: " "${DOMAIN}"
  else
    prompt_read domain_input "Enter domain name (or press Enter to skip SSL): " ""
  fi
  DOMAIN="${domain_input:-${DOMAIN}}"

  prompt_read admin_user_input "Enter admin username [${ADMIN_USER}]: " "${ADMIN_USER}"
  ADMIN_USER="${admin_user_input:-${ADMIN_USER}}"

  if [ -z "${ADMIN_PASS}" ]; then
    while true; do
      prompt_read ADMIN_PASS "Enter admin password: " "" 1

      if [ -n "${ADMIN_PASS}" ]; then
        break
      fi

      warn "Admin password cannot be empty."
    done
  else
    info "Using admin password from environment/flags."
  fi

  if [ -n "${DOMAIN}" ] && [ -z "${SSL_EMAIL}" ]; then
    SSL_EMAIL="admin@${DOMAIN}"
  fi

  if [ -n "${DOMAIN}" ] && ! is_truthy "${SKIP_SSL}"; then
    echo
    info "SSL Configuration (Cloudflare DNS validation)"

    local ssl_email_input=""

    prompt_read ssl_email_input "Enter SSL certificate email [${SSL_EMAIL}]: " "${SSL_EMAIL}"
    SSL_EMAIL="${ssl_email_input:-${SSL_EMAIL}}"

    if [ -n "${CF_TOKEN}" ]; then
      local cf_token_input=""
      local cf_account_id_input=""
      local cf_zone_id_input=""

      prompt_read cf_token_input "Enter Cloudflare API Token [provided]: " "${CF_TOKEN}"
      CF_TOKEN="${cf_token_input:-${CF_TOKEN}}"

      if [ -n "${CF_ACCOUNT_ID}" ]; then
        prompt_read cf_account_id_input "Enter Cloudflare Account ID (optional) [${CF_ACCOUNT_ID}]: " "${CF_ACCOUNT_ID}"
        CF_ACCOUNT_ID="${cf_account_id_input:-${CF_ACCOUNT_ID}}"
      else
        prompt_read cf_account_id_input "Enter Cloudflare Account ID (optional): " ""
        CF_ACCOUNT_ID="${cf_account_id_input:-${CF_ACCOUNT_ID}}"
      fi

      if [ -n "${CF_ZONE_ID}" ]; then
        prompt_read cf_zone_id_input "Enter Cloudflare Zone ID (optional) [${CF_ZONE_ID}]: " "${CF_ZONE_ID}"
        CF_ZONE_ID="${cf_zone_id_input:-${CF_ZONE_ID}}"
      else
        prompt_read cf_zone_id_input "Enter Cloudflare Zone ID (optional): " ""
        CF_ZONE_ID="${cf_zone_id_input:-${CF_ZONE_ID}}"
      fi
    else
      local cf_email_input=""
      local cf_key_input=""
      local cf_token_input=""
      local use_token=""

      prompt_read use_token "Use Cloudflare API Token instead of Global API Key? (recommended) [y/N]: " ""
      if is_truthy "${use_token}"; then
        prompt_read CF_TOKEN "Enter Cloudflare API Token: " ""

        local cf_account_id_input=""
        local cf_zone_id_input=""
        prompt_read cf_account_id_input "Enter Cloudflare Account ID (optional): " ""
        CF_ACCOUNT_ID="${cf_account_id_input:-${CF_ACCOUNT_ID}}"
        prompt_read cf_zone_id_input "Enter Cloudflare Zone ID (optional): " ""
        CF_ZONE_ID="${cf_zone_id_input:-${CF_ZONE_ID}}"
      else
        if [ -n "${CF_EMAIL}" ]; then
          prompt_read cf_email_input "Enter Cloudflare email [${CF_EMAIL}]: " "${CF_EMAIL}"
          CF_EMAIL="${cf_email_input:-${CF_EMAIL}}"
        else
          prompt_read CF_EMAIL "Enter Cloudflare email: " ""
        fi

        if [ -n "${CF_KEY}" ]; then
          prompt_read cf_key_input "Enter Cloudflare Global API Key [provided]: " "${CF_KEY}"
          CF_KEY="${cf_key_input:-${CF_KEY}}"
        else
          prompt_read CF_KEY "Enter Cloudflare Global API Key: " ""
        fi
      fi
    fi
  fi
}

write_backend_env() {
  local db_password="$1"
  local jwt_secret="$2"
  local subscription_url=""
  local ssl_enabled="false"

  if [ -n "${DOMAIN}" ]; then
    if is_truthy "${SKIP_SSL}"; then
      subscription_url="http://${DOMAIN}:${PANEL_PORT}"
      ssl_enabled="false"
    else
      subscription_url="https://${DOMAIN}"
      ssl_enabled="true"
    fi
  fi

  # Build CORS_ORIGIN — must not be '*' in production
  local cors_origin
  if [ -n "${DOMAIN}" ]; then
    if is_truthy "${SKIP_SSL}"; then
      cors_origin="http://${DOMAIN}:${PANEL_PORT}"
    else
      cors_origin="https://${DOMAIN}"
    fi
  else
    local server_ip
    server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
    server_ip="${server_ip:-$(curl -s ifconfig.me 2>/dev/null || echo '127.0.0.1')}"
    cors_origin="http://${server_ip}:${PANEL_PORT}"
  fi

  # Generate a strong webhook secret
  local webhook_secret
  webhook_secret="$(openssl rand -hex 32)"

  cat > "${INSTALL_DIR}/backend/.env" <<EOF
# Application
NODE_ENV=production
PORT=${PANEL_PORT}
API_VERSION=v1
SERVE_FRONTEND=true
PANEL_PATH=/${PANEL_PATH}

# Database
DATABASE_URL=postgresql://postgres:${db_password}@127.0.0.1:${DB_PORT}/xray_panel

# JWT
JWT_SECRET=${jwt_secret}
JWT_EXPIRY=7d
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d
AUTH_REQUIRE_2FA_SUPER_ADMIN=false
AUTH_STRICT_SESSION_BINDING=false
ADMIN_REQUIRE_PRIVATE_IP=false
SECRETS_ENCRYPTION_KEY=
SECRETS_ENCRYPTION_REQUIRED=false

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_MAX=10

# Logging
LOG_LEVEL=info
CORS_ORIGIN=${cors_origin}

# Subscription
SUBSCRIPTION_URL=${subscription_url}

# Telegram Bot
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=
TELEGRAM_POLLING=true
TELEGRAM_REPORT_CRON=0 9 * * *
TELEGRAM_NOTIFY_EXPIRY_DAYS=7
TELEGRAM_NOTIFY_DATA_THRESHOLD=10
TELEGRAM_ALERTS_ENABLED=true

# Scheduled Jobs
JOBS_ENABLED=true
TRAFFIC_MONITOR_CRON=*/10 * * * *
EXPIRY_CHECK_CRON=0 * * * *
SSL_RENEW_CRON=0 3 * * *
SMART_FALLBACK_ENABLED=true
SMART_FALLBACK_CRON=*/15 * * * *
SMART_FALLBACK_WINDOW_MINUTES=60
SMART_FALLBACK_MIN_KEYS=2

# Startup gates (avoid hard failures when XRAY API is temporarily unavailable during boot)
STARTUP_HEALTH_GATE_STRICT=false

# Xray
XRAY_DEPLOYMENT=docker
XRAY_BINARY_PATH=xray
XRAY_CONFIG_PATH=/etc/xray/config.json
XRAY_LOG_LEVEL=warning
XRAY_PID_PATH=/tmp/one-ui-xray.pid
XRAY_TRAFFIC_SYNC_ENABLED=true
XRAY_API_URL=http://127.0.0.1:10085
XRAY_API_SERVER=127.0.0.1:10085
XRAY_API_CLI_TIMEOUT_MS=7000
XRAY_API_LISTEN=127.0.0.1
XRAY_API_ADDRESS=127.0.0.1
TRAFFIC_SYNC_INTERVAL=60
XRAY_UPDATE_SCRIPT=/opt/one-ui/scripts/update-xray-core.sh
COMPOSE_FILE=/opt/one-ui/docker-compose.yml

# SSL / ACME
SSL_ENABLED=${ssl_enabled}
SSL_DOMAIN=${DOMAIN}
SSL_EMAIL=${SSL_EMAIL}
SSL_CERT_PATH=${DATA_DIR}/certs
SSL_KEY_PATH=${DATA_DIR}/certs/key.pem
SSL_RENEW_DAYS=30
SSL_RELOAD_CMD=
ACME_HOME=/root/.acme.sh
ACME_SH_PATH=/root/.acme.sh/acme.sh

# Cloudflare DNS API
CLOUDFLARE_API_TOKEN=${CF_TOKEN}
CLOUDFLARE_ZONE_ID=${CF_ZONE_ID}
CLOUDFLARE_EMAIL=${CF_EMAIL}
CLOUDFLARE_ACCOUNT_EMAIL=${CF_EMAIL}
CLOUDFLARE_API_KEY=${CF_KEY}

# System Monitoring
SYSTEM_MONITOR_ENABLED=true
SYSTEM_MONITOR_INTERVAL=300
SYSTEM_MONITOR_ALERT_COOLDOWN=1800
CPU_THRESHOLD=80
MEMORY_THRESHOLD=80
DISK_THRESHOLD=80

# Alert Webhook
ALERT_WEBHOOK_SECRET=${webhook_secret}

# Backup
BACKUP_ENABLED=true
BACKUP_DIR=${BACKUP_DIR}
BACKUP_RETENTION_DAYS=7
BACKUP_SCHEDULE=0 2 * * *
BACKUP_USE_DOCKER=true
BACKUP_DB_DOCKER_CONTAINER=one-ui-db
S3_ENABLED=false
S3_BUCKET=
EOF

  chmod 600 "${INSTALL_DIR}/backend/.env" 2>/dev/null || true
  ok "backend/.env created."
}

write_compose() {
  local db_password="$1"

  cat > "${INSTALL_DIR}/docker-compose.yml" <<EOF
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: one-ui-db
    restart: always
    environment:
      POSTGRES_DB: xray_panel
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${db_password}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:${DB_PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: one-ui-backend
    restart: always
    env_file:
      - ./backend/.env
    volumes:
      - ${INSTALL_DIR}/xray:/etc/xray
      - ${DATA_DIR}/certs:${DATA_DIR}/certs
      - /var/log/xray:/var/log/xray
      - ${BACKUP_DIR}:${BACKUP_DIR}
      - /var/run/docker.sock:/var/run/docker.sock
      - ${INSTALL_DIR}/scripts:/opt/one-ui/scripts:ro
      - ${INSTALL_DIR}/docker-compose.yml:/opt/one-ui/docker-compose.yml:ro
    network_mode: host
    depends_on:
      db:
        condition: service_healthy

  xray:
    build:
      context: .
      dockerfile: docker/Dockerfile.xray
      args:
        XRAY_BASE_IMAGE: \${XRAY_BASE_IMAGE:-ghcr.io/xtls/xray-core:latest}
    container_name: xray-core
    restart: always
    volumes:
      - ${INSTALL_DIR}/xray:/etc/xray
      - /var/log/xray:/var/log/xray
      - ${DATA_DIR}/certs:/certs
    network_mode: host
    cap_add:
      - NET_ADMIN
    depends_on:
      - backend

volumes:
  postgres_data:
EOF

  ok "docker-compose.yml created."
}

build_frontend_assets() {
  info "Building frontend assets (Docker build container)..."

  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker is not available; skipping frontend build. The API will still run, but the web UI won't be served."
    return
  fi

  # Small VPS instances (1-2 GB RAM) can OOM during Vite builds — ensure swap exists.
  ensure_swap

  # Build inside a clean Node container so we don't need Node.js installed on the VPS.
  # NODE_OPTIONS limits the V8 heap; --memory-swap -1 lets Docker use all host swap.
  docker run --rm \
    --memory-swap -1 \
    -v "${INSTALL_DIR}:/work" \
    -w /work/frontend \
    -e NODE_OPTIONS="--max-old-space-size=1024" \
    node:20-alpine \
    sh -lc "set -e; npm ci --loglevel=error; VITE_API_URL=/${PANEL_PATH}/api VITE_PANEL_PATH=/${PANEL_PATH} npm run build"

  rm -rf "${INSTALL_DIR}/backend/public"
  mkdir -p "${INSTALL_DIR}/backend/public"
  cp -R "${INSTALL_DIR}/frontend/dist/." "${INSTALL_DIR}/backend/public/"
  rm -rf "${INSTALL_DIR}/frontend/node_modules" || true

  ok "Frontend assets built and copied to backend/public."
}

wait_for_backend() {
  info "Waiting for backend to become healthy..."
  for _ in $(seq 1 45); do
    # Try both direct /api and panel-path-prefixed /PANEL_PATH/api health checks
    if curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/system/health" >/dev/null 2>&1; then
      ok "Backend is healthy."
      return
    fi
    sleep 2
  done

  warn "Backend health endpoint not ready yet. Continuing."
}

load_existing_runtime_config() {
  local env_file="${INSTALL_DIR}/backend/.env"
  if [ ! -f "${env_file}" ]; then
    return
  fi

  local file_port
  file_port="$(grep -E '^PORT=' "${env_file}" | head -n 1 | cut -d '=' -f2- || true)"
  if [[ "${file_port}" =~ ^[0-9]+$ ]]; then
    PANEL_PORT="${file_port}"
  fi

  local file_domain
  file_domain="$(grep -E '^SSL_DOMAIN=' "${env_file}" | head -n 1 | cut -d '=' -f2- || true)"
  if [ -n "${file_domain}" ]; then
    DOMAIN="${file_domain}"
  fi
}

run_post_install_checks() {
  info "Running post-install self-checks..."
  local failures=0

  if compose ps >/tmp/one-ui-compose-ps.txt 2>/tmp/one-ui-compose-ps.err; then
    if grep -Eq "(one-ui-backend|one-ui-db|xray-core)" /tmp/one-ui-compose-ps.txt; then
      ok "Compose services detected."
    else
      warn "Compose services not found in ps output."
      failures=$((failures + 1))
    fi
  else
    warn "Unable to read compose status: $(cat /tmp/one-ui-compose-ps.err 2>/dev/null || true)"
    failures=$((failures + 1))
  fi

  if curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/system/health" >/tmp/one-ui-health.json 2>/tmp/one-ui-health.err; then
    ok "Backend health endpoint is reachable."
  else
    warn "Backend health endpoint failed on :${PANEL_PORT}."
    failures=$((failures + 1))
  fi

  if [ -n "${ADMIN_USER}" ] && [ -n "${ADMIN_PASS}" ]; then
    if curl -fsS -X POST "http://127.0.0.1:${PANEL_PORT}/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
      >/tmp/one-ui-auth.json 2>/tmp/one-ui-auth.err; then
      if grep -q '"token"' /tmp/one-ui-auth.json; then
        ok "Admin authentication check passed."
      else
        warn "Admin login responded without token."
        failures=$((failures + 1))
      fi
    else
      warn "Admin authentication check failed."
      failures=$((failures + 1))
    fi
  else
    warn "Skipping admin auth self-check (admin credentials not provided)."
  fi

  rm -f /tmp/one-ui-compose-ps.txt /tmp/one-ui-compose-ps.err /tmp/one-ui-health.json /tmp/one-ui-health.err /tmp/one-ui-auth.json /tmp/one-ui-auth.err || true

  if [ "${failures}" -gt 0 ]; then
    warn "Self-check finished with ${failures} issue(s). Run: sudo one-ui logs backend"
  else
    ok "Self-check passed."
  fi
}

wait_for_container_running() {
  local container="$1"
  local max_wait="${2:-60}"
  local elapsed=0

  while [ "${elapsed}" -lt "${max_wait}" ]; do
    local state
    state="$(docker inspect -f '{{.State.Status}}' "${container}" 2>/dev/null || echo "missing")"
    if [ "${state}" = "running" ]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  warn "Container ${container} is not running after ${max_wait}s (state: ${state})."
  return 1
}

run_migrations() {
  info "Running database migrations..."

  local max_attempts=3
  local attempt=0

  while [ "${attempt}" -lt "${max_attempts}" ]; do
    attempt=$((attempt + 1))

    # Use 'compose run --rm' to create a disposable container.
    # This does NOT require the backend container to be running.
    if compose run --rm -T backend npx prisma migrate deploy 2>&1; then
      ok "Database schema is up to date (migrate deploy)."
      return
    fi

    # Fall back to prisma db push (schema-only sync, works for fresh installs)
    if compose run --rm -T backend npx prisma db push --accept-data-loss 2>&1; then
      ok "Database schema is up to date (db push)."
      return
    fi

    if [ "${attempt}" -lt "${max_attempts}" ]; then
      warn "Migration attempt ${attempt}/${max_attempts} failed. Retrying in 5s..."
      sleep 5
    fi
  done

  warn "All migration attempts failed. The backend may apply schema on first boot."
}

create_admin() {
  info "Creating or updating admin user..."

  local admin_user_b64
  local admin_pass_b64
  admin_user_b64="$(printf '%s' "${ADMIN_USER}" | base64 | tr -d '\n')"
  admin_pass_b64="$(printf '%s' "${ADMIN_PASS}" | base64 | tr -d '\n')"

  local max_attempts=3
  local attempt=0
  local admin_ok=false

  while [ "${attempt}" -lt "${max_attempts}" ]; do
    attempt=$((attempt + 1))

    if compose run --rm -T \
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
      data: { password: hash, role: 'SUPER_ADMIN' }
    });
    console.log('Admin user updated');
  } else {
    await prisma.admin.create({
      data: { username, password: hash, role: 'SUPER_ADMIN' }
    });
    console.log('Admin user created');
  }

  await prisma.\$disconnect();
})();
" 2>&1; then
      admin_ok=true
      break
    fi

    if [ "${attempt}" -lt "${max_attempts}" ]; then
      warn "Admin creation attempt ${attempt}/${max_attempts} failed. Retrying in 3s..."
      sleep 3
    fi
  done

  if [ "${admin_ok}" = "true" ]; then
    ok "Admin account ready."
  else
    echo
    warn "Admin account creation failed after ${max_attempts} attempts."
    warn "Fix this after install by running: one-ui reset-password"
    echo
  fi
}

setup_ssl_if_requested() {
  if [ -z "${DOMAIN}" ]; then
    return
  fi

  if is_truthy "${SKIP_SSL}"; then
    warn "SSL issuance skipped (--skip-ssl / ONEUI_SKIP_SSL=true)."
    return
  fi

  if [ ! -x "/root/.acme.sh/acme.sh" ]; then
    local acme_email="${SSL_EMAIL:-${CF_EMAIL:-admin@${DOMAIN}}}"
    curl -fsSL https://get.acme.sh | sh -s email="${acme_email}"
  fi

  if [ -n "${CF_TOKEN}" ]; then
    export CF_Token="${CF_TOKEN}"
    if [ -n "${CF_ACCOUNT_ID}" ]; then
      export CF_Account_ID="${CF_ACCOUNT_ID}"
    fi
    if [ -n "${CF_ZONE_ID}" ]; then
      export CF_Zone_ID="${CF_ZONE_ID}"
    fi
  elif [ -n "${CF_EMAIL}" ] && [ -n "${CF_KEY}" ]; then
    export CF_Key="${CF_KEY}"
    export CF_Email="${CF_EMAIL}"
  else
    warn "Cloudflare credentials not provided. Skipping SSL issuance (you can configure it later in Settings)."
    return
  fi

  /root/.acme.sh/acme.sh --issue --dns dns_cf -d "${DOMAIN}" -d "*.${DOMAIN}"
  /root/.acme.sh/acme.sh --install-cert -d "${DOMAIN}" \
    --cert-file "${DATA_DIR}/certs/cert.pem" \
    --key-file "${DATA_DIR}/certs/key.pem" \
    --fullchain-file "${DATA_DIR}/certs/fullchain.pem" \
    --reloadcmd "cd \"${INSTALL_DIR}\" && (docker compose restart backend xray || docker-compose restart backend xray)"

  ok "SSL certificate installed."
}

configure_firewall() {
  if ! command -v ufw >/dev/null 2>&1; then
    warn "ufw not available; skipping firewall configuration."
    return
  fi

  info "Configuring firewall..."
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow "${PANEL_PORT}/tcp"
  ufw --force enable
  ok "Firewall configured."
}

install_cli_wrapper() {
  local bin_path="/usr/local/bin/one-ui"

  info "Installing one-ui CLI wrapper..."

  cat > "${bin_path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

ONEUI_HOME="\${ONEUI_INSTALL_DIR:-${INSTALL_DIR}}"

if [[ ! -d "\${ONEUI_HOME}" ]]; then
  echo "One-UI install directory not found: \${ONEUI_HOME}" >&2
  echo "Set ONEUI_INSTALL_DIR or reinstall One-UI." >&2
  exit 1
fi

cd "\${ONEUI_HOME}"

# All commands are handled by the management script (scripts/menu.sh).
# It supports both interactive menu (no args) and direct CLI commands.
exec ./scripts/menu.sh "\$@"
EOF

  chmod +x "${bin_path}"
  ok "CLI wrapper installed: ${bin_path}"
}

repair_existing_install() {
  print_banner
  ensure_root
  ensure_supported_os
  install_dependencies

  if [ ! -d "${INSTALL_DIR}" ]; then
    fail "Repair mode failed: install dir not found (${INSTALL_DIR})."
  fi
  if [ ! -f "${INSTALL_DIR}/docker-compose.yml" ]; then
    fail "Repair mode failed: docker-compose.yml not found in ${INSTALL_DIR}."
  fi

  load_existing_runtime_config
  cd "${INSTALL_DIR}"

  info "Repair mode: rebuilding and restarting services..."
  compose up -d --build

  wait_for_backend
  run_migrations || warn "Migration step failed during repair. You can retry with: cd ${INSTALL_DIR} && $(command -v docker-compose >/dev/null 2>&1 && echo 'docker-compose' || echo 'docker compose') exec -T backend npx prisma migrate deploy"
  install_cli_wrapper
  run_post_install_checks
  print_summary
}

print_summary() {
  local panel_url
  local base_url
  if [ -n "${DOMAIN}" ]; then
    base_url="http://${DOMAIN}:${PANEL_PORT}"
  else
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    ip="${ip:-$(curl -s ifconfig.me || echo 'SERVER_IP')}"
    base_url="http://${ip}:${PANEL_PORT}"
  fi
  panel_url="${base_url}/${PANEL_PATH}/"

  # Save panel config for management script
  echo "${PANEL_PORT}" > "${INSTALL_DIR}/.panel_port"
  echo "/${PANEL_PATH}" > "${INSTALL_DIR}/.panel_path"

  echo
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║              INSTALLATION COMPLETE!                          ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo
  echo -e "${YELLOW}┌──────────────────────────────────────────────────────────────┐${NC}"
  echo -e "${YELLOW}│${NC}  Panel URL:  ${GREEN}${panel_url}${NC}"
  echo -e "${YELLOW}│${NC}  Port:       ${GREEN}${PANEL_PORT}${NC}"
  echo -e "${YELLOW}│${NC}  Path:       ${GREEN}/${PANEL_PATH}/${NC}"
  echo -e "${YELLOW}│${NC}"
  if [ -n "${ADMIN_USER}" ]; then
    echo -e "${YELLOW}│${NC}  Username:   ${GREEN}${ADMIN_USER}${NC}"
  fi
  if [ -n "${ADMIN_PASS}" ]; then
    echo -e "${YELLOW}│${NC}  Password:   ${GREEN}${ADMIN_PASS}${NC}"
  else
    echo -e "${YELLOW}│${NC}  Password:   ${GREEN}(unchanged / hidden)${NC}"
  fi
  echo -e "${YELLOW}│${NC}"
  echo -e "${YELLOW}│${NC}  ${RED}⚠ IMPORTANT: Change the password after first login!${NC}"
  echo -e "${YELLOW}│${NC}  ${RED}⚠ SAVE YOUR PANEL PATH - You need it to access the panel!${NC}"
  echo -e "${YELLOW}└──────────────────────────────────────────────────────────────┘${NC}"
  echo
  echo -e "${YELLOW}Important:${NC}"
  echo "- Save your credentials and panel path in a secure location."
  echo "- Configure Telegram bot in backend/.env."
  echo "- Add inbounds and users via admin panel."
  echo "- Enable 2FA for SUPER_ADMIN accounts from Settings after first login."
  if [ -n "${DOMAIN}" ] && is_truthy "${SKIP_SSL}"; then
    echo "- SSL issuance was skipped. Configure SSL later via Settings/API."
  fi
  echo
  echo -e "${YELLOW}Useful Commands:${NC}"
  echo "- CLI menu:   sudo one-ui menu"
  echo "- CLI info:   sudo one-ui info"
  echo "- CLI status: sudo one-ui status"
  echo "- CLI logs:   sudo one-ui logs backend"
  echo "- Runtime fix: sudo one-ui self-heal"
  echo "- View logs: cd \"${INSTALL_DIR}\" && docker compose logs -f"
  echo "- Restart:   cd \"${INSTALL_DIR}\" && docker compose restart"
  echo "- Stop:      cd \"${INSTALL_DIR}\" && docker compose down"
}

main() {
  parse_cli "$@"

  if is_truthy "${REPAIR_MODE}"; then
    repair_existing_install
    return
  fi

  if is_truthy "${NON_INTERACTIVE}"; then
    # Fail fast before privileged install steps.
    load_admin_password_from_file
    validate_non_interactive_config
  fi
  print_banner
  ensure_root
  ensure_supported_os
  install_dependencies
  prepare_directories
  download_project
  prompt_config
  stop_existing_containers
  ensure_ports_available

  # Preserve existing credentials on re-install to keep database data intact
  if [ -f "${INSTALL_DIR}/backend/.env" ]; then
    EXISTING_DB_PASS="$(grep -oP '^DATABASE_URL=.*://postgres:\K[^@]+' "${INSTALL_DIR}/backend/.env" 2>/dev/null || true)"
    EXISTING_JWT="$(grep -oP '^JWT_SECRET=\K.+' "${INSTALL_DIR}/backend/.env" 2>/dev/null || true)"
  fi
  DB_PASSWORD="${EXISTING_DB_PASS:-$(openssl rand -hex 24)}"
  JWT_SECRET="${EXISTING_JWT:-$(openssl rand -hex 64)}"

  write_backend_env "${DB_PASSWORD}" "${JWT_SECRET}"
  write_compose "${DB_PASSWORD}"
  build_frontend_assets

  info "Building Docker images..."
  compose build

  # Start only the database first so we can run migrations before the backend starts.
  # This avoids the chicken-and-egg problem where the backend crash-loops because
  # the schema doesn't exist, but migrations can't run inside a crashing container.
  info "Starting database..."
  compose up -d db

  # Wait for the DB to be healthy (pg_isready)
  info "Waiting for database to be healthy..."
  for _ in $(seq 1 30); do
    if compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
      ok "Database is healthy."
      break
    fi
    sleep 2
  done

  # Run migrations in a disposable container (compose run) — does NOT depend on the
  # backend container being up. This creates a temporary container from the backend
  # service definition, runs the command, then removes it.
  run_migrations

  # Create admin user in a disposable container too
  create_admin

  # Now start all services (backend will start cleanly with schema already in place)
  info "Starting all services..."
  compose up -d

  wait_for_backend
  setup_ssl_if_requested
  configure_firewall
  install_cli_wrapper
  run_post_install_checks
  print_summary
}

main "$@"

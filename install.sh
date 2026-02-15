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

PANEL_PORT="${ONEUI_PORT:-${XRAY_PANEL_PORT:-3000}}"
DB_PORT="${ONEUI_DB_PORT:-${XRAY_PANEL_DB_PORT:-5432}}"

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

print_usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --non-interactive           Run without prompts (env/flags only)
  --interactive               Force interactive prompts
  --port <port>               Panel port (default: 3000)
  --db-port <port>            Local DB port bound to 127.0.0.1 (default: 5432)
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
  --repo <git-url>            Override repository URL (XRAY_PANEL_REPO)
  -h, --help                  Show help

Environment equivalents (recommended ONEUI_*; XRAY_PANEL_* still supported):
  ONEUI_NON_INTERACTIVE=true
  ONEUI_PORT=3000
  ONEUI_DB_PORT=5432
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
  if ! [[ "${PANEL_PORT}" =~ ^[0-9]+$ ]] || [ "${PANEL_PORT}" -lt 1 ] || [ "${PANEL_PORT}" -gt 65535 ]; then
    fail "Invalid panel port: ${PANEL_PORT} (expected 1-65535)."
  fi

  if ! [[ "${DB_PORT}" =~ ^[0-9]+$ ]] || [ "${DB_PORT}" -lt 1 ] || [ "${DB_PORT}" -gt 65535 ]; then
    fail "Invalid DB port: ${DB_PORT} (expected 1-65535)."
  fi

  if [ "${DB_PORT}" = "${PANEL_PORT}" ]; then
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
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  docker compose "$@"
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
  apt-get update

  if ! apt-get install -y curl wget git nano ufw openssl docker.io docker-compose-plugin; then
    warn "docker-compose-plugin install failed, trying docker-compose package..."
    apt-get install -y curl wget git nano ufw openssl docker.io docker-compose
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

ensure_ports_available() {
  info "Checking ports..."

  if is_port_in_use "${PANEL_PORT}"; then
    fail "Port ${PANEL_PORT} is already in use. Set ONEUI_PORT or use --port."
  fi

  if is_port_in_use "${DB_PORT}"; then
    fail "Port ${DB_PORT} is already in use. Set ONEUI_DB_PORT or use --db-port."
  fi

  ok "Ports available: panel=${PANEL_PORT}, db=127.0.0.1:${DB_PORT}"
}

prepare_directories() {
  mkdir -p "${INSTALL_DIR}"
  mkdir -p "${DATA_DIR}/certs"
  mkdir -p "${BACKUP_DIR}"
  mkdir -p /var/log/xray
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
    read -r -p "Enter domain name (or press Enter to skip SSL) [${DOMAIN}]: " domain_input
  else
    read -r -p "Enter domain name (or press Enter to skip SSL): " domain_input
  fi
  DOMAIN="${domain_input:-${DOMAIN}}"

  read -r -p "Enter admin username [${ADMIN_USER}]: " admin_user_input
  ADMIN_USER="${admin_user_input:-${ADMIN_USER}}"

  if [ -z "${ADMIN_PASS}" ]; then
    while true; do
      read -r -s -p "Enter admin password: " ADMIN_PASS
      echo

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

    read -r -p "Enter SSL certificate email [${SSL_EMAIL}]: " ssl_email_input
    SSL_EMAIL="${ssl_email_input:-${SSL_EMAIL}}"

    if [ -n "${CF_TOKEN}" ]; then
      local cf_token_input=""
      local cf_account_id_input=""
      local cf_zone_id_input=""

      read -r -p "Enter Cloudflare API Token [provided]: " cf_token_input
      CF_TOKEN="${cf_token_input:-${CF_TOKEN}}"

      if [ -n "${CF_ACCOUNT_ID}" ]; then
        read -r -p "Enter Cloudflare Account ID (optional) [${CF_ACCOUNT_ID}]: " cf_account_id_input
        CF_ACCOUNT_ID="${cf_account_id_input:-${CF_ACCOUNT_ID}}"
      else
        read -r -p "Enter Cloudflare Account ID (optional): " cf_account_id_input
        CF_ACCOUNT_ID="${cf_account_id_input:-${CF_ACCOUNT_ID}}"
      fi

      if [ -n "${CF_ZONE_ID}" ]; then
        read -r -p "Enter Cloudflare Zone ID (optional) [${CF_ZONE_ID}]: " cf_zone_id_input
        CF_ZONE_ID="${cf_zone_id_input:-${CF_ZONE_ID}}"
      else
        read -r -p "Enter Cloudflare Zone ID (optional): " cf_zone_id_input
        CF_ZONE_ID="${cf_zone_id_input:-${CF_ZONE_ID}}"
      fi
    else
      local cf_email_input=""
      local cf_key_input=""
      local cf_token_input=""
      local use_token=""

      read -r -p "Use Cloudflare API Token instead of Global API Key? (recommended) [y/N]: " use_token
      if is_truthy "${use_token}"; then
        read -r -p "Enter Cloudflare API Token: " CF_TOKEN

        local cf_account_id_input=""
        local cf_zone_id_input=""
        read -r -p "Enter Cloudflare Account ID (optional): " cf_account_id_input
        CF_ACCOUNT_ID="${cf_account_id_input:-${CF_ACCOUNT_ID}}"
        read -r -p "Enter Cloudflare Zone ID (optional): " cf_zone_id_input
        CF_ZONE_ID="${cf_zone_id_input:-${CF_ZONE_ID}}"
      else
        if [ -n "${CF_EMAIL}" ]; then
          read -r -p "Enter Cloudflare email [${CF_EMAIL}]: " cf_email_input
          CF_EMAIL="${cf_email_input:-${CF_EMAIL}}"
        else
          read -r -p "Enter Cloudflare email: " CF_EMAIL
        fi

        if [ -n "${CF_KEY}" ]; then
          read -r -p "Enter Cloudflare Global API Key [provided]: " cf_key_input
          CF_KEY="${cf_key_input:-${CF_KEY}}"
        else
          read -r -p "Enter Cloudflare Global API Key: " CF_KEY
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
    subscription_url="http://${DOMAIN}:${PANEL_PORT}"
    ssl_enabled="true"
  fi

  cat > "${INSTALL_DIR}/backend/.env" <<EOF
# Application
NODE_ENV=production
PORT=${PANEL_PORT}
API_VERSION=v1
SERVE_FRONTEND=true

# Database
DATABASE_URL=postgresql://postgres:${db_password}@127.0.0.1:${DB_PORT}/xray_panel

# JWT
JWT_SECRET=${jwt_secret}
JWT_EXPIRY=7d
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d
AUTH_REQUIRE_2FA_SUPER_ADMIN=true
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
CORS_ORIGIN=*

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
TRAFFIC_SYNC_INTERVAL=60

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

  # Build inside a clean Node container so we don't need Node.js installed on the VPS.
  docker run --rm \
    -v "${INSTALL_DIR}:/work" \
    -w /work/frontend \
    node:20-alpine \
    sh -lc "set -e; npm ci; VITE_API_URL=/api npm run build"

  rm -rf "${INSTALL_DIR}/backend/public"
  mkdir -p "${INSTALL_DIR}/backend/public"
  cp -R "${INSTALL_DIR}/frontend/dist/." "${INSTALL_DIR}/backend/public/"
  rm -rf "${INSTALL_DIR}/frontend/node_modules" || true

  ok "Frontend assets built and copied to backend/public."
}

wait_for_backend() {
  info "Waiting for backend to become healthy..."
  for _ in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/system/health" >/dev/null 2>&1; then
      ok "Backend is healthy."
      return
    fi
    sleep 2
  done

  warn "Backend health endpoint not ready yet. Continuing."
}

run_migrations() {
  info "Running database migrations..."
  if ! compose exec -T backend npx prisma migrate deploy; then
    warn "prisma migrate deploy failed, falling back to prisma db push..."
    compose exec -T backend npx prisma db push
  fi
  ok "Database schema is up to date."
}

create_admin() {
  info "Creating or updating admin user..."

  local admin_user_b64
  local admin_pass_b64
  admin_user_b64="$(printf '%s' "${ADMIN_USER}" | base64 | tr -d '\n')"
  admin_pass_b64="$(printf '%s' "${ADMIN_PASS}" | base64 | tr -d '\n')"

  compose exec -T backend sh -lc "ADMIN_USER_B64='${admin_user_b64}' ADMIN_PASS_B64='${admin_pass_b64}' node - <<'NODE'
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
NODE"

  ok "Admin account ready."
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

print_summary() {
  local panel_url
  if [ -n "${DOMAIN}" ]; then
    panel_url="http://${DOMAIN}:${PANEL_PORT}"
  else
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    ip="${ip:-$(curl -s ifconfig.me || echo 'SERVER_IP')}"
    panel_url="http://${ip}:${PANEL_PORT}"
  fi

  echo
  ok "========================================="
  ok "Installation Complete"
  ok "========================================="
  echo
  echo -e "${YELLOW}Access Information:${NC}"
  echo "Panel URL: ${panel_url}"
  echo "Username: ${ADMIN_USER}"
  echo "Password: ${ADMIN_PASS}"
  echo
  echo -e "${YELLOW}Important:${NC}"
  echo "- Save your credentials in a secure location."
  echo "- Configure Telegram bot in backend/.env."
  echo "- Add inbounds and users via admin panel."
  if [ -n "${DOMAIN}" ] && is_truthy "${SKIP_SSL}"; then
    echo "- SSL issuance was skipped. Configure SSL later via Settings/API."
  fi
  echo
  echo -e "${YELLOW}Useful Commands:${NC}"
  echo "- View logs: cd \"${INSTALL_DIR}\" && $(command -v docker-compose >/dev/null 2>&1 && echo 'docker-compose' || echo 'docker compose') logs -f"
  echo "- Restart: cd \"${INSTALL_DIR}\" && $(command -v docker-compose >/dev/null 2>&1 && echo 'docker-compose' || echo 'docker compose') restart"
  echo "- Stop: cd \"${INSTALL_DIR}\" && $(command -v docker-compose >/dev/null 2>&1 && echo 'docker-compose' || echo 'docker compose') down"
  echo "- Run core smoke: cd \"${INSTALL_DIR}\" && ./scripts/smoke-core-api.sh"
  echo "- Run Myanmar smoke: cd \"${INSTALL_DIR}\" && ./scripts/smoke-myanmar-hardening.sh"
  echo "- Run smoke suite from menu: cd \"${INSTALL_DIR}\" && ./scripts/menu.sh (option 7)"
  echo "- Deploy with smoke gate: cd \"${INSTALL_DIR}\" && ./scripts/deploy-complete.sh"
  echo "- Deploy without smoke gate: cd \"${INSTALL_DIR}\" && SMOKE_GATE_ENABLED=false ./scripts/deploy-complete.sh"
}

main() {
  parse_cli "$@"
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
  ensure_ports_available

  DB_PASSWORD="$(openssl rand -base64 32)"
  JWT_SECRET="$(openssl rand -hex 64)"

  write_backend_env "${DB_PASSWORD}" "${JWT_SECRET}"
  write_compose "${DB_PASSWORD}"
  build_frontend_assets

  info "Building Docker images..."
  compose build

  info "Starting services..."
  compose up -d

  wait_for_backend
  run_migrations
  create_admin
  setup_ssl_if_requested
  configure_firewall
  print_summary
}

main "$@"

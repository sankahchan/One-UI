#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FALLBACK_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="${PROJECT_DIR:-/opt/xray-panel}"
SMOKE_GATE_ENABLED="${SMOKE_GATE_ENABLED:-true}"
SMOKE_API_BASE_URL="${SMOKE_API_BASE_URL:-http://127.0.0.1:3000/api}"
SMOKE_ADMIN_USERNAME="${SMOKE_ADMIN_USERNAME:-admin}"
SMOKE_ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-admin123}"

echo "🚀 Complete X-Ray Panel Deployment"
echo "==================================="

# 1. Deploy backend
echo "📦 Step 1: Deploying Backend..."
if [[ ! -f "$PROJECT_DIR/docker-compose.yml" ]]; then
  PROJECT_DIR="$FALLBACK_PROJECT_DIR"
fi
cd "$PROJECT_DIR"
docker-compose up -d --build

# 1.5 Pre-deploy gate
if [[ "$SMOKE_GATE_ENABLED" == "true" ]]; then
  echo "🧪 Step 1.5: Running smoke gate..."
  chmod +x scripts/*.sh
  export SMOKE_API_BASE_URL
  export SMOKE_ADMIN_USERNAME
  export SMOKE_ADMIN_PASSWORD
  ./scripts/smoke-core-api.sh
  ./scripts/smoke-myanmar-hardening.sh
  echo "✅ Smoke gate passed"
else
  echo "⏭️  Step 1.5: Smoke gate skipped (SMOKE_GATE_ENABLED=${SMOKE_GATE_ENABLED})"
fi

# 2. Build frontend
echo "🏗️  Step 2: Building Frontend..."
./scripts/build-frontend.sh

# 3. Setup Nginx
echo "🌐 Step 3: Configuring Nginx..."
sudo cp nginx/xray-panel.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/xray-panel.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4. Setup SSL (if not already done)
if [ ! -f /var/lib/xray-panel/certs/fullchain.pem ]; then
    echo "🔐 Step 4: SSL certificates not found. Please configure via admin panel."
else
    echo "✅ SSL certificates found"
fi

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "📍 Access your panel at: https://your.domain.com"
echo "🔑 Login with the credentials from installation"
echo ""
echo "📝 Next steps:"
echo "  1. Login to admin panel"
echo "  2. Configure SSL certificate (if needed)"
echo "  3. Setup Telegram bot (optional)"
echo "  4. Create your first inbound"
echo "  5. Add users"
echo ""

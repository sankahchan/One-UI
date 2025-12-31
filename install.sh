#!/bin/bash

# One-UI - One Command Installation Script
# Author: sankahchan (https://github.com/sankahchan)
# Usage: curl -sL https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | bash

set -e

echo "╔════════════════════════════════════════╗"
echo "║      One-UI Auto Installer v1.0        ║"
echo "║   VPN Management Panel Installation    ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

echo -e "${GREEN}[1/8] Checking system...${NC}"
# Check Ubuntu version
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
    VER=$VERSION_ID
    echo "  ✓ Detected: $OS $VER"
else
    echo -e "${RED}  ✗ Unable to detect OS${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}[2/8] Installing Node.js 20...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "  ✓ Node.js installed: $(node --version)"
else
    echo "  ✓ Node.js already installed: $(node --version)"
fi

echo ""
echo -e "${GREEN}[3/8] Installing dependencies...${NC}"
apt-get update
apt-get install -y git unzip curl wget
echo "  ✓ Dependencies installed"

echo ""
echo -e "${GREEN}[4/8] Downloading One-UI...${NC}"
cd /opt
if [ -d "One-UI" ]; then
    echo "  ! One-UI directory exists, backing up..."
    mv One-UI One-UI-backup-$(date +%Y%m%d-%H%M%S)
fi

# Download from GitHub (change to your repo URL after upload)
git clone https://github.com/sankahchan/One-UI.git
cd One-UI
echo "  ✓ One-UI downloaded"

echo ""
echo -e "${GREEN}[5/8] Installing packages...${NC}"
npm install --production
echo "  ✓ Packages installed"

echo ""
echo -e "${GREEN}[6/8] Configuring environment...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    # Generate random JWT secret
    JWT_SECRET=$(openssl rand -base64 32)
    sed -i "s/change-this-to-a-secure-random-string/$JWT_SECRET/" .env
    echo "  ✓ Environment configured with random JWT secret"
else
    echo "  ✓ Environment file already exists"
fi

echo ""
echo -e "${GREEN}[7/8] Setting up database...${NC}"
npx prisma generate
npx prisma migrate deploy
echo "  ✓ Database setup complete"

echo ""
echo -e "${GREEN}[8/8] Building application...${NC}"
npm run build
echo "  ✓ Build complete"

echo ""
echo -e "${GREEN}Installing PM2 process manager...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    echo "  ✓ PM2 installed"
else
    echo "  ✓ PM2 already installed"
fi

echo ""
echo -e "${GREEN}Starting One-UI...${NC}"
cd .next/standalone
pm2 start server.js --name one-ui
pm2 save
pm2 startup | tail -n 1 | bash
echo "  ✓ One-UI started"

echo ""
echo -e "${GREEN}Configuring firewall...${NC}"
if command -v ufw &> /dev/null; then
    ufw allow 3000/tcp
    echo "  ✓ Firewall rule added (port 3000)"
else
    echo "  ! UFW not found, skipping firewall configuration"
fi

# Get server IP
SERVER_IP=$(curl -s ifconfig.me)

echo ""
echo "╔════════════════════════════════════════╗"
echo "║     ✅ Installation Complete! ✅        ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "🎉 One-UI is now running!"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Create admin account:"
echo "   cd /opt/One-UI"
echo "   npm run setup"
echo ""
echo "2. Access panel:"
echo "   http://$SERVER_IP:3000"
echo ""
echo -e "${YELLOW}Useful Commands:${NC}"
echo "  Status:  pm2 status"
echo "  Logs:    pm2 logs one-ui"
echo "  Restart: pm2 restart one-ui"
echo "  Stop:    pm2 stop one-ui"
echo ""
echo "📚 Documentation: /opt/One-UI/README.md"
echo ""
echo "🎯 Setup admin now:"
echo "   cd /opt/One-UI && npm run setup"
echo ""

# 🚀 One-UI VPS Deployment Guide

**Quick guide to deploy One-UI on your VPS server**

---

## 📋 Prerequisites

- Ubuntu 22.04 VPS (recommended)
- Root or sudo access
- Domain name (optional but recommended)
- 2GB RAM minimum

---

## ⚡ Quick Installation (10 Minutes)

### Step 1: Connect to VPS

```bash
ssh root@YOUR_VPS_IP
```

### Step 2: Install Node.js

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # Should show v20.x
npm --version   # Should show 10.x
```

### Step 3: Upload and Extract One-UI

```bash
# Create directory
mkdir -p /opt
cd /opt

# Upload One-UI.zip to your VPS (use scp or SFTP)
# From your local computer:
# scp One-UI.zip root@YOUR_VPS_IP:/opt/

# Extract
unzip One-UI.zip
cd One-UI
```

### Step 4: Install Dependencies

```bash
npm install
```

###Step 5: Configure

```bash
# Create environment file
cp .env.example .env

# Edit configuration
nano .env
```

**Edit these values:**
```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="CHANGE-THIS-TO-RANDOM-STRING"
PORT=3000
NODE_ENV="production"
```

Press `Ctrl + X`, then `Y`, then `Enter` to save.

### Step 6: Setup Database

```bash
npx prisma generate
npx prisma migrate deploy
npm run setup
```

**Enter when prompted:**
- Email: your@email.com
- Password: (choose strong password)
- Name: Admin

### Step 7: Build Application

```bash
npm run build
```

### Step 8: Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

### Step 9: Start Application

```bash
cd .next/standalone
pm2 start server.js --name one-ui
pm2 save
pm2 startup
```

### Step 10: Configure Firewall

```bash
sudo ufw allow 22     # SSH
sudo ufw allow 3000   # One-UI
sudo ufw enable
```

---

## ✅ Access Your Panel

**Open browser:**
```
http://YOUR_VPS_IP:3000
```

**Login with:**
- Email: your@email.com
- Password: (what you set)

---

## 🌐 Setup Domain (Optional)

### Install Nginx

```bash
sudo apt install nginx -y
```

### Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/one-ui
```

**Paste this:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Enable site:**
```bash
sudo ln -s /etc/nginx/sites-available/one-ui /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Setup SSL (Free HTTPS)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

**Now access:** https://your-domain.com

---

## 🔧 Common Commands

### Check Status
```bash
pm2 status
pm2 logs one-ui
```

### Restart
```bash
pm2 restart one-ui
```

### Stop
```bash
pm2 stop one-ui
```

### View Logs
```bash
pm2 logs one-ui --lines 100
```

### Update Application
```bash
cd /opt/One-UI
git pull  # If using Git
npm install
npm run build
pm2 restart one-ui
```

---

## 🆘 Troubleshooting

### Can't Access Panel

**Check if running:**
```bash
pm2 status
```

**Check logs:**
```bash
pm2 logs one-ui
```

**Restart:**
```bash
pm2 restart one-ui
```

### Port 3000 Already in Use

**Find what's using it:**
```bash
sudo lsof -i :3000
```

**Kill it:**
```bash
sudo kill -9 PID_NUMBER
```

**Or change port in .env:**
```env
PORT=3001
```

### Database Errors

**Reset database:**
```bash
cd /opt/One-UI
rm prisma/dev.db
npx prisma migrate deploy
npm run setup
pm2 restart one-ui
```

### Forgot Admin Password

**Reset password:**
```bash
cd /opt/One-UI
npm run password:change
```

---

## 🔐 Security Checklist

Before going live:

- [ ] Change JWT_SECRET in .env
- [ ] Use strong admin password
- [ ] Enable firewall (UFW)
- [ ] Setup SSL/HTTPS
- [ ] Regular backups
- [ ] Keep system updated
- [ ] Use non-root user (optional)

---

## 📊 Resource Usage

**Minimum Requirements:**
- CPU: 1 core
- RAM: 2GB
- Storage: 10GB
- Bandwidth: Unlimited recommended

**Recommended for 100+ users:**
- CPU: 2 cores
- RAM: 4GB
- Storage: 20GB

---

## 🔄 Backup & Restore

### Backup

```bash
# Backup database
cp /opt/One-UI/prisma/dev.db /backup/one-ui-$(date +%Y%m%d).db

# Backup config
cp /opt/One-UI/.env /backup/one-ui-env-$(date +%Y%m%d)
```

### Restore

```bash
# Restore database
cp /backup/one-ui-YYYYMMDD.db /opt/One-UI/prisma/dev.db
pm2 restart one-ui
```

### Automated Daily Backups

```bash
# Add to crontab
crontab -e

# Add this line:
0 2 * * * cp /opt/One-UI/prisma/dev.db /backup/one-ui-$(date +\%Y\%m\%d).db
```

---

## ✅ Post-Installation

After successful installation:

1. Login to panel
2. Add your first Outline server
3. Create test access key
4. Verify everything works
5. Start adding customers!

---

## 📞 Support

- GitHub: https://github.com/sankahchan/One-UI
- Issues: https://github.com/sankahchan/One-UI/issues

---

**Your VPN business starts now!** 🚀💰

# 🚀 One-UI - One Command Installation

**Just like OutlineAdmin - Install with ONE command!**

---

## ⚡ Super Simple Installation

### Step 1: SSH to your VPS

```bash
ssh root@YOUR_VPS_IP
```

### Step 2: Run ONE command

```bash
curl -sL https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | bash
```

**That's it!** 🎉

The script will:
- ✅ Install Node.js
- ✅ Download One-UI
- ✅ Install dependencies
- ✅ Setup database
- ✅ Build application
- ✅ Start with PM2
- ✅ Configure firewall

---

## 📝 After Installation

### Create Admin Account

```bash
cd /opt/One-UI
npm run setup
```

**Enter:**
- Email: your@email.com
- Password: (your password)
- Name: Admin

### Access Panel

```
http://YOUR_VPS_IP:3000
```

---

## 🎯 That's All!

No complicated steps. Just:

1. **One command** to install
2. **Create admin** account
3. **Login** and start!

---

## 🔧 Useful Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs one-ui

# Restart
pm2 restart one-ui

# Stop
pm2 stop one-ui
```

---

## 📦 Manual Installation (Alternative)

If you prefer manual:

```bash
# Download and extract
cd /opt
git clone https://github.com/sankahchan/One-UI.git
cd One-UI

# Install
npm install
cp .env.example .env
nano .env  # Edit settings

# Setup
npx prisma generate
npx prisma migrate deploy
npm run setup
npm run build

# Start
npm install -g pm2
cd .next/standalone
pm2 start server.js --name one-ui
pm2 save
```

---

## 🌐 Setup Domain (Optional)

```bash
# Install Nginx
apt install nginx -y

# Configure
nano /etc/nginx/sites-available/one-ui
```

**Add:**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

**Enable:**
```bash
ln -s /etc/nginx/sites-available/one-ui /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

**Add SSL:**
```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

---

## ✅ Done!

**One command installation - just like OutlineAdmin!**

```bash
curl -sL https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | bash
```

🚀 **Easy!**

---

**Author:** sankahchan  
**GitHub:** https://github.com/sankahchan/One-UI

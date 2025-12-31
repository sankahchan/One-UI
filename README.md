# 🌐 One-UI

### Advanced VPN Management Panel for Outline VPN Servers

<p align="center">
  <img src=".github/logo.svg" alt="One-UI Logo" width="120">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=for-the-badge" alt="Node">
  <img src="https://img.shields.io/badge/next.js-14.2-black?style=for-the-badge" alt="Next.js">
</p>

<p align="center">
  <strong>A modern, feature-rich web panel for managing multiple Outline VPN servers with dynamic access keys, health monitoring, and real-time analytics.</strong>
</p>

---

## 📸 Screenshots

<details>
<summary>Click to view screenshots</summary>

| Login | Servers Dashboard |
|:---:|:---:|
| ![Login](.github/screenshots/1-login.png) | ![Servers](.github/screenshots/2-servers.png) |

| Add Server | Server Settings |
|:---:|:---:|
| ![New Server](.github/screenshots/3-new-server.png) | ![Settings](.github/screenshots/4-server-settings.png) |

| Server Metrics | Access Keys |
|:---:|:---:|
| ![Metrics](.github/screenshots/5-server-metrics.png) | ![Access Keys](.github/screenshots/6-server-access-keys.png) |

| Dynamic Access Keys | New Dynamic Key |
|:---:|:---:|
| ![DAK](.github/screenshots/7-dynamic-access-keys.png) | ![New DAK](.github/screenshots/8-new-dynamic-access-key.png) |

| Health Checks | Notification Channels |
|:---:|:---:|
| ![Health](.github/screenshots/9-health-checks.png) | ![Notifications](.github/screenshots/10-notification-channels.png) |

| New Notification Channel | Server Tags |
|:---:|:---:|
| ![New Channel](.github/screenshots/11-new-notification-channel.png) | ![Tags](.github/screenshots/12-tags.png) |

</details>

---

## ✨ Features

### 🖥️ Multi-Server Management
- Connect and manage multiple Outline VPN servers from a single dashboard
- Real-time server status monitoring
- One-click server synchronization
- Server tagging and organization

### 🔑 Access Key Management
- Create, edit, and delete access keys
- Set data limits (Bytes, KB, MB, GB)
- Set expiration dates
- QR code generation for easy sharing
- Custom key prefixes for advanced configurations

### ⚡ Dynamic Access Keys (DAK)
- **Load Balancing Algorithms:**
  - User IP Address based (sticky sessions)
  - Random Key on Each Connection
  - Random Server Key on Each Connection
- **Self-Managed Keys:**
  - Automatic key creation across server pools
  - Tag-based or specific server selection
  - Validity periods (daily, weekly, monthly, custom)
  - Automatic cleanup on expiration
- **Manual Mode:**
  - Hand-pick specific access keys
  - Full control over key assignment

### 📊 Analytics & Monitoring
- Real-time bandwidth usage tracking
- Per-key data consumption statistics
- Server metrics and performance data
- Geographic usage distribution
- Peak bandwidth monitoring

### 🏥 Health Checks
- Automated server health monitoring
- Configurable check intervals
- Notification on server issues
- Cooldown periods to prevent spam

### 🔔 Notification Channels
- **Telegram Integration:**
  - Custom bot token configuration
  - Customizable message templates
  - Real-time alerts on server issues

### 🏷️ Server Tags
- Organize servers with custom tags
- Filter and group servers
- Use tags for Dynamic Access Key server pools

### 🎨 Modern UI/UX
- Clean, responsive design with HeroUI components
- Dark and Light theme support
- Mobile-friendly interface
- Smooth animations with Framer Motion

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 14 (App Router) |
| **Language** | TypeScript |
| **UI Library** | HeroUI (formerly NextUI) |
| **Styling** | Tailwind CSS |
| **Database** | SQLite with Prisma ORM |
| **Authentication** | JWT (jose) + bcrypt |
| **State Management** | React Hook Form |
| **Process Manager** | PM2 |
| **Logging** | Winston with daily rotation |

---

## 📋 Requirements

- **Node.js** 20.x or higher
- **npm** 10.x or higher
- **Ubuntu** 22.04 LTS (recommended)
- **RAM** 2GB minimum (4GB recommended)
- **Storage** 10GB minimum

---

## 🚀 Quick Start

### One-Command Installation

```bash
curl -sL https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | bash
```

### Manual Installation

```bash
# Clone repository
git clone https://github.com/sankahchan/One-UI.git
cd One-UI

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env  # Edit your settings

# Setup database
npx prisma generate
npx prisma migrate deploy

# Create admin account
npm run setup

# Build for production
npm run build

# Start the application
cd .next/standalone
pm2 start server.js --name one-ui
pm2 save
pm2 startup
```

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL="file:./dev.db"

# Authentication (CHANGE THIS!)
JWT_SECRET="your-super-secret-jwt-key-change-this"

# Server
PORT=3000
NODE_ENV="production"
```

> ⚠️ **Important:** Always change the `JWT_SECRET` to a random, secure string in production!

---

## 📖 Usage

### Adding an Outline Server

1. Navigate to **Servers** → **Add Server**
2. Paste your Outline server's `apiUrl` and management JSON
3. Click **Add Server**
4. The server will sync automatically

### Creating Access Keys

1. Go to **Servers** → Select a server → **Access Keys**
2. Click **Create Access Key**
3. Set name, data limit, and expiration (optional)
4. Share the access URL or QR code with your users

### Setting Up Dynamic Access Keys

1. Navigate to **Dynamic Access Keys** → **Create**
2. Choose a name and unique path (e.g., `/my-vpn`)
3. Select load balancing algorithm
4. Choose between:
   - **Self-Managed:** Automatic key creation on tagged servers
   - **Manual:** Select specific existing keys
5. Access your dynamic endpoint at: `https://your-domain.com/api/dak/your-path`

### Configuring Health Checks

1. Add servers to the panel
2. Go to **Health Checks**
3. Configure check interval and notification settings
4. Set up a Telegram notification channel for alerts

---

## 🔧 Maintenance Commands

```bash
# Check application status
pm2 status

# View real-time logs
pm2 logs one-ui

# Restart application
pm2 restart one-ui

# Stop application
pm2 stop one-ui

# Change admin password
npm run password:change

# Run manual sync job
npm run sync-job

# Run health check job
npm run health-check-job

# Run dynamic access key maintenance
npm run dak-job
```

---

## 🔐 Security Best Practices

- ✅ Change the default `JWT_SECRET` immediately
- ✅ Use a strong admin password
- ✅ Enable UFW firewall
- ✅ Set up SSL/HTTPS with Let's Encrypt
- ✅ Keep your system and dependencies updated
- ✅ Regular database backups
- ✅ Use a reverse proxy (Nginx) in production

---

## 🗂️ Project Structure

```
One-UI/
├── prisma/                 # Database schema and migrations
│   ├── schema.prisma       # Prisma schema definition
│   ├── migrations/         # Database migrations
│   └── db.ts               # Prisma client instance
├── scripts/                # Utility scripts
│   ├── setup.ts            # Initial setup script
│   ├── build.ts            # Build script
│   ├── start.ts            # Production start script
│   ├── dak-job.ts          # Dynamic access key maintenance
│   ├── health-check-job.ts # Server health monitoring
│   └── outline-sync-job.ts # Outline server synchronization
├── src/
│   ├── app/                # Next.js App Router pages
│   ├── components/         # React components
│   ├── core/               # Core business logic
│   │   ├── actions/        # Server actions
│   │   ├── outline/        # Outline VPN client
│   │   └── definitions.ts  # Type definitions
│   ├── hooks/              # Custom React hooks
│   └── styles/             # Global styles
├── public/                 # Static assets
└── .github/                # GitHub assets and workflows
```

---

## 🔄 Updating

```bash
cd /opt/One-UI

# Pull latest changes (if using Git)
git pull

# Install new dependencies
npm install

# Run any new migrations
npx prisma migrate deploy

# Rebuild
npm run build

# Restart
pm2 restart one-ui
```

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t one-ui .

# Run container
docker-compose up -d
```

---

## 📚 Documentation

- [VPS Deployment Guide](./VPS_DEPLOYMENT.md) - Detailed VPS setup instructions
- [One Command Install](./ONE_COMMAND_INSTALL.md) - Quick installation guide

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**sankahchan**

- GitHub: [@sankahchan](https://github.com/sankahchan)

---

## 🙏 Acknowledgments

- [Outline VPN](https://getoutline.org/) - The VPN solution this panel manages
- [HeroUI](https://heroui.com/) - Beautiful React components
- [Next.js](https://nextjs.org/) - The React framework
- [Prisma](https://prisma.io/) - Database toolkit

---

## 💬 Support

If you encounter any issues or have questions:

1. Check the [existing issues](https://github.com/sankahchan/One-UI/issues)
2. Create a [new issue](https://github.com/sankahchan/One-UI/issues/new)

---

<p align="center">
  <strong>Made with ❤️ for the VPN community</strong>
</p>

<p align="center">
  ⭐ Star this repository if you find it useful!
</p>

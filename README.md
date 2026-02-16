<p align="center">
  <img src="https://img.shields.io/badge/Xray-9+-blue?style=flat-square" alt="Xray Protocols" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

# One-UI

A modern Xray proxy management panel. Install in one command, manage from the web or CLI.

---

## Features

| | |
|---|---|
| **9 Protocols** | VLESS, VMess, Trojan, Shadowsocks, SOCKS, HTTP, Dokodemo-door, WireGuard, MTProto |
| **REALITY** | One-click setup with auto key generation |
| **Users** | Create, bulk-create, disable, extend expiry, reset traffic, rotate keys |
| **Groups** | Group users with shared limits, inbound assignments, schedules |
| **Subscriptions** | Per-user links, Clash/ClashMeta YAML, QR codes |
| **Telegram Bot** | User stats, system alerts, daily reports |
| **Backup** | Scheduled backups with retention, one-click restore |
| **SSL** | Auto-issue & renew via Let's Encrypt / Cloudflare DNS |
| **Security** | 2FA, IP/CIDR/country blocking, random panel path |
| **CLI** | `one-ui` command with interactive menu + 40 direct commands |

---

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh)
```

The installer will:
1. Install Docker if needed
2. Set up PostgreSQL + build the panel
3. Auto-assign a random port and secure panel path
4. Start all services and print your login URL

### Non-interactive

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh) \
  --non-interactive \
  --domain panel.example.com \
  --admin-pass 'YourStrongPassword' \
  --cf-token 'cloudflare-api-token'
```

<details>
<summary>All installer flags</summary>

| Flag | Env var | Description |
|------|---------|-------------|
| `--domain` | `ONEUI_DOMAIN` | Panel domain (enables SSL) |
| `--admin-user` | `ONEUI_ADMIN_USER` | Admin username (default: `admin`) |
| `--admin-pass` | `ONEUI_ADMIN_PASS` | Admin password |
| `--ssl-email` | `ONEUI_SSL_EMAIL` | Email for Let's Encrypt |
| `--cf-token` | `ONEUI_CF_TOKEN` | Cloudflare API token |
| `--cf-email` | `ONEUI_CF_EMAIL` | Cloudflare account email |
| `--cf-key` | `ONEUI_CF_KEY` | Cloudflare Global API key |
| `--skip-ssl` | — | Skip SSL certificate issuance |
| `--non-interactive` | `ONEUI_NON_INTERACTIVE=true` | No prompts |
| `--port` | `ONEUI_PORT` | Panel port (default: auto) |
| `--db-port` | `ONEUI_DB_PORT` | PostgreSQL port (default: auto) |

</details>

---

## CLI

After installation, manage everything with `one-ui`:

```bash
one-ui                    # Interactive menu (36 options)
one-ui status             # Service status
one-ui health             # Full health check
one-ui logs backend       # View backend logs
```

### Users

```bash
one-ui users              # User management menu
one-ui list-users         # List all users
one-ui add-user           # Add a user
one-ui bulk               # Bulk operations (create, disable, extend, reset, delete)
one-ui bulk-create        # Bulk create users
```

### Configuration

```bash
one-ui reset-password     # Reset admin credentials
one-ui port               # Change panel port
one-ui ssl                # SSL certificate management
one-ui telegram           # Telegram bot setup
one-ui backup             # Backup & restore
one-ui setup-2fa          # Two-factor authentication
one-ui subscription       # Configure subscription URLs
one-ui security-rules     # IP/CIDR/Country block rules
```

### Xray

```bash
one-ui add-inbound        # Quick-add inbound (protocol presets)
one-ui traffic            # Live traffic monitoring
one-ui xray-update        # Update Xray core
one-ui xray-rollback      # Rollback Xray core
```

### Service control

```bash
one-ui start              # Start all services
one-ui stop               # Stop all services
one-ui restart            # Restart all services
one-ui update             # Update One-UI to latest
one-ui uninstall          # Uninstall One-UI
```

---

## After Install

1. Open the panel URL shown in your terminal
2. Log in with the credentials you set (or `admin` / `admin123` if defaults)
3. **Change your password** in Settings
4. **Enable 2FA** in Settings for security
5. Add your first inbound via the web UI or `one-ui add-inbound`
6. Create users and share their subscription links

---

## SSL Setup

**With Cloudflare (recommended):**
```bash
one-ui ssl
# or during install:
--domain panel.example.com --cf-token 'your-token'
```

**Skip SSL and configure later:**
```bash
--domain panel.example.com --skip-ssl
```

---

## Backup & Restore

```bash
one-ui backup             # Open backup menu
one-ui backup-create      # Create a backup now
one-ui backup-list        # List existing backups
```

Backups are saved to `/var/backups/one-ui` by default. Enable scheduled backups and set retention from the backup menu.

---

## Telegram Bot

```bash
one-ui telegram
```

Set your bot token and admin chat IDs. Once enabled you get:
- Daily usage reports
- Expiry and traffic limit alerts
- System health notifications

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't access panel | Check `one-ui status` and `one-ui info` for URL/port |
| Forgot panel path | Run `one-ui settings` to see the current path |
| Forgot password | Run `one-ui reset-password` |
| Services won't start | Run `one-ui logs backend` to check errors |
| Port conflict | Run `one-ui port` to change the panel port |
| SSL not working | Run `one-ui ssl` to re-issue or check `one-ui health` |
| Xray not connecting | Run `one-ui health` and check xray logs with `one-ui logs xray` |

---

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for dev setup, architecture, API reference, and testing.

---

## License

MIT

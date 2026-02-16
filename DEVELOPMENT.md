# Development Guide

Developer documentation for contributing to One-UI.

---

## Requirements

- Node.js 20+
- Docker & Docker Compose v2
- Git

---

## Quick Start

```bash
./scripts/dev-up.sh
```

This starts PostgreSQL, runs migrations + seed, and launches:
- **Backend** at `http://localhost:3000` (hot reload via nodemon)
- **Frontend** at `http://localhost:5173` (Vite HMR)

```bash
./scripts/dev-down.sh            # Stop services
./scripts/dev-down.sh --with-db  # Stop + remove DB container
```

### Manual setup

```bash
# Backend
cd backend
cp .env.example .env             # Edit DATABASE_URL if needed
npm install
npx prisma generate
npx prisma db push
npx prisma db seed
npm run dev

# Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev
```

### Docker (dev mode)

```bash
docker compose up --build
```

Services: `db` (PostgreSQL 15), `backend` (:3000), `xray`, `prometheus` (:9090), `alertmanager` (:9093), `grafana` (:3001)

---

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── config/          # Database, env, logger
│   │   ├── controllers/     # Request handlers
│   │   ├── middleware/       # Auth, rate limit, security rules
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Business logic
│   │   ├── telegram/        # Telegram bot (commands, handlers, keyboards)
│   │   ├── subscription/    # Subscription format generators
│   │   ├── xray/            # Xray config builder, protocol handlers
│   │   ├── worker/          # Background job runner
│   │   ├── startup/         # Boot-time health gates
│   │   ├── observability/   # Prometheus metrics
│   │   └── utils/           # Helpers, errors
│   └── prisma/
│       ├── schema.prisma    # Database schema
│       ├── migrations/      # Migration files
│       └── seed.js          # Default admin + sample data
├── frontend/
│   └── src/
│       ├── api/             # Axios client, API modules
│       ├── components/      # Atomic design (atoms → templates)
│       ├── pages/           # Lazy-loaded page components
│       ├── store/           # Zustand state management
│       ├── hooks/           # Custom React hooks
│       ├── types/           # TypeScript definitions
│       ├── locales/         # i18n translation files
│       └── utils/           # Helper functions
├── xray/
│   └── config.json          # Default Xray config
├── docker/
│   └── Dockerfile.xray      # Xray container image
├── scripts/                 # Dev, test, deploy scripts
└── docker-compose.yml       # Dev stack definition
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand |
| Backend | Node.js, Express, Prisma ORM, Winston |
| Database | PostgreSQL 15 |
| Proxy | Xray Core (9 protocols) |
| Auth | JWT (access + refresh tokens), TOTP 2FA |
| Containers | Docker Compose |

---

## Key Patterns

### PrismaClient singleton

All backend files must import from the shared instance:

```js
const prisma = require('./config/database');   // ✅
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();              // ❌ causes connection pool exhaustion
```

Only standalone scripts (`seed.js`, `cli/index.js`) may create their own instance.

### Frontend routing

- Routes defined in `frontend/src/App.tsx`
- All pages use `React.lazy()` with Suspense for code splitting
- Sidebar navigation in `DashboardLayout.tsx`
- Panel path from `VITE_PANEL_PATH` env var, applied as `basename` in React Router

### Auth flow

- JWT with access (15m) + refresh (30d) tokens
- Axios interceptor in `api/client.ts` auto-refreshes on 401
- `useAuthStore` (Zustand) manages auth state

### Atomic design

Components are organized as:
- `atoms/` — Buttons, inputs, badges
- `molecules/` — Form groups, stat cards
- `organisms/` — Tables, modals, sidebars
- `templates/` — Page layouts

---

## Database

### Schema changes

```bash
cd backend

# Create a migration
npx prisma migrate dev --name describe_your_change

# Apply without creating migration (dev only)
npx prisma db push

# Reset and re-seed
npx prisma migrate reset
```

### Seed data

```bash
npx prisma db seed
```

Creates a default `admin` / `admin123` SUPER_ADMIN account. Override with `SEED_ADMIN_USER` and `SEED_ADMIN_PASS` env vars.

---

## Testing

### Smoke tests (fast)

```bash
./scripts/e2e-smoke.sh                        # Frontend smoke + core API
./scripts/smoke-core-api.sh                    # API CRUD lifecycle
```

### Full E2E

```bash
cd frontend
npx playwright install chromium                # First time
npm run e2e:smoke                              # Smoke subset
npm run e2e                                    # Full suite
npm run e2e:headed                             # With browser visible
npm run e2e:debug                              # Step-through debugger
```

### Backend checks

```bash
cd backend
npm run check                                  # Prisma validate + syntax check
```

### API performance

```bash
./scripts/api-budget-check.sh                  # Response-time budgets
./scripts/api-slo-check.sh                     # p95/p99 SLO validation
```

### Pre-release

```bash
./scripts/release-check.sh --bootstrap --teardown --quiet
```

Runs: core smoke + Myanmar smoke + API budget + API SLO + rollback readiness.

---

## Monitoring

```bash
./scripts/observability-up.sh                  # Start Prometheus + Grafana + Alertmanager
./scripts/observability-down.sh                # Stop monitoring stack
```

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | `http://localhost:3001` | `admin` / `admin` |
| Prometheus | `http://localhost:9090` | — |
| Alertmanager | `http://localhost:9093` | — |

Override Grafana credentials with `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` env vars.

**Pre-configured alerts:** `OneUIBackendDown`, `OneUIHighHttp5xxRate`, `OneUIHighHttpLatencyP95`, `OneUIHighDbLatencyP95`, `OneUIOnlineUsersDroppedToZero`

**Alert flow:** Prometheus → Alertmanager → `POST /api/system/alerts/webhook` → Telegram

---

## API Reference

All endpoints are under `/api` (or `/<panel-path>/api` when a panel path is set). Both paths work simultaneously.

### Auth
| Method | Endpoint | Auth |
|--------|----------|------|
| `POST` | `/auth/login` | Public |
| `POST` | `/auth/logout` | Bearer |
| `POST` | `/auth/refresh` | Bearer |
| `GET` | `/auth/me` | Bearer |
| `PUT` | `/auth/profile` | Bearer |
| `POST` | `/auth/2fa/setup` | Bearer |
| `POST` | `/auth/2fa/enable` | Bearer |
| `POST` | `/auth/2fa/disable` | Bearer |

### Users
| Method | Endpoint | Auth |
|--------|----------|------|
| `GET` | `/users` | Admin |
| `POST` | `/users` | Admin |
| `GET` | `/users/:id` | Admin |
| `PUT` | `/users/:id` | Admin |
| `DELETE` | `/users/:id` | Super Admin |
| `GET` | `/users/stats` | Admin |
| `POST` | `/users/bulk/create` | Admin |
| `POST` | `/users/bulk/delete` | Super Admin |
| `POST` | `/users/bulk/update-status` | Admin |
| `POST` | `/users/bulk/extend-expiry` | Admin |
| `POST` | `/users/bulk/reset-traffic` | Admin |
| `POST` | `/users/bulk/assign-inbounds` | Admin |
| `POST` | `/users/bulk/keys/rotate` | Admin |

### Inbounds
| Method | Endpoint | Auth |
|--------|----------|------|
| `GET` | `/inbounds` | Admin |
| `POST` | `/inbounds` | Admin |
| `GET` | `/inbounds/:id` | Admin |
| `PUT` | `/inbounds/:id` | Admin |
| `DELETE` | `/inbounds/:id` | Super Admin |
| `POST` | `/inbounds/presets/myanmar` | Admin |
| `GET` | `/inbounds/reality/keys` | Admin |

### Xray
| Method | Endpoint | Auth |
|--------|----------|------|
| `GET` | `/xray/status` | Admin |
| `GET` | `/xray/config` | Admin |
| `POST` | `/xray/restart` | Admin |
| `POST` | `/xray/config/reload` | Admin |
| `GET` | `/xray/online` | Admin |

### System
| Method | Endpoint | Auth |
|--------|----------|------|
| `GET` | `/system/health` | Public |
| `GET` | `/system/metrics` | Public |
| `GET` | `/system/stats` | Bearer |

### Subscriptions (public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sub/:token` | V2Ray/Xray URI list |
| `GET` | `/sub/:token/clash` | Clash YAML config |
| `GET` | `/sub/:token/qr` | QR code |
| `GET` | `/sub/:token/links` | Per-inbound links |

**Response format:**
```json
{ "success": true, "data": {}, "message": "..." }
```

---

## CI / CD

GitHub Actions (`.github/workflows/ci.yml`):

| Job | Trigger | What it does |
|-----|---------|-------------|
| `frontend-quality` | Push, PR | Lint + build (Node 20, 22) |
| `backend-quality` | Push, PR | Syntax check + Prisma validate (Node 20, 22) |
| `docker-build` | Push, PR | Build backend & Xray Docker images |
| `smoke-e2e` | Push, PR | Playwright smoke tests + performance budgets |
| `api-smoke-scripts` | Push, PR | Core API & Myanmar hardening smoke |
| `nightly-full-e2e` | Daily 03:00 UTC | Full E2E suite |

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `dev-up.sh` | Start full dev stack |
| `dev-down.sh` | Stop dev services |
| `bootstrap-local.sh` | Init DB + start backend/frontend |
| `build-frontend.sh` | Production frontend build |
| `verify.sh` | Run all quality checks |
| `e2e-smoke.sh` | Quick smoke tests |
| `e2e-full.sh` | Full Playwright suite |
| `smoke-core-api.sh` | Core API CRUD tests |
| `smoke-reality-hardening.sh` | REALITY protocol tests |
| `smoke-myanmar-hardening.sh` | Myanmar connectivity tests |
| `api-budget-check.sh` | Response-time budgets |
| `api-slo-check.sh` | p95/p99 SLO checks |
| `release-check.sh` | Pre-release validation |
| `observability-up.sh` | Start monitoring stack |
| `observability-down.sh` | Stop monitoring stack |
| `update-xray-core.sh` | Update Xray core |
| `production-hardening-audit.sh` | Security audit |

---

## Common Pitfalls

1. **PrismaClient duplication** — Never use `new PrismaClient()` in backend source files. Import from `config/database.js`.
2. **`.split()` on arrays** — Watch for `.split('\n')` called on `.map()` results (array, not string).
3. **Unused route params** — When a route has `:id`, verify the component calls `useParams()`.
4. **Panel path in redirects** — Client-side redirects must include `VITE_PANEL_PATH`, not hard-code `/login`.
5. **`set_env_var()` in menu.sh** — Use the helper instead of raw `sed` for `.env` modifications (handles missing keys).

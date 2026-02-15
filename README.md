# One-UI

Foundational backend for One-UI with PostgreSQL, Prisma ORM, JWT auth, and CRUD APIs for users and inbounds.

## Stack

- Node.js 20+
- Express.js
- PostgreSQL 15
- Prisma ORM
- JWT authentication
- Docker + Docker Compose
- Winston logging
- express-validator for request validation

## Project structure

```text
One-UI/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.js
│   ├── src/
│   │   ├── index.js
│   │   ├── config/
│   │   │   ├── database.js
│   │   │   ├── logger.js
│   │   │   └── env.js
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   ├── errorHandler.js
│   │   │   ├── rateLimit.js
│   │   │   └── validator.js
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── user.routes.js
│   │   │   ├── inbound.routes.js
│   │   │   └── system.routes.js
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   ├── user.controller.js
│   │   │   ├── inbound.controller.js
│   │   │   ├── system.controller.js
│   │   │   └── xray.controller.js
│   │   ├── services/
│   │   │   ├── auth.service.js
│   │   │   ├── user.service.js
│   │   │   ├── inbound.service.js
│   │   │   └── crypto.service.js
│   │   ├── xray/
│   │   │   ├── config-generator.js
│   │   │   ├── manager.js
│   │   │   ├── protocols/
│   │   │   └── templates/
│   │   └── utils/
│   │       ├── response.js
│   │       ├── errors.js
│   │       └── validators.js
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Data model highlights

- `Admin` for panel authentication (roles: `SUPER_ADMIN`, `ADMIN`, `AGENT`)
- `User` for client/account lifecycle, traffic limits, and subscription tokens
- `Inbound` for protocol and transport configuration
- `UserInbound` join table for user-to-inbound assignments
- `TrafficLog` and `SystemLog` for usage/system event history

## Auth security hardening

- Access tokens now include a session claim (`sid`) when issued from login/refresh flows.
- Sensitive auth routes enforce active-session checks (`/auth/profile`, `/auth/logout-all`, `/auth/2fa/*`, Telegram link management).
- Added auth session management endpoints:
  - `GET /api/auth/sessions?limit=20`
  - `DELETE /api/auth/sessions/:sid`
- Added dedicated rate limiters for auth-sensitive endpoints:
  - `AUTH_REFRESH_RATE_LIMIT_MAX`
  - `AUTH_PROFILE_RATE_LIMIT_MAX`
- Optional strict session-claim requirement:
  - `AUTH_REQUIRE_SESSION_CLAIM=true` (enabled by default in production).

## Connection limits and device fingerprinting

- User limits are now enforced independently:
  - `ipLimit` for distinct client IPs
  - `deviceLimit` for distinct device fingerprints
- Subscription requests now support optional fingerprint headers:
  - `X-Device-Fingerprint`
  - `X-Client-Fingerprint`
  - `X-OneUI-Device-Id`
- If no explicit fingerprint header is provided, One-UI derives a deterministic fingerprint from request metadata.
- New admin endpoints:
  - `GET /api/users/:id/devices?windowMinutes=60`
  - `DELETE /api/users/:id/devices/:fingerprint`
- Device-session freshness window is configurable via:
  - `DEVICE_TRACKING_TTL_SECONDS` (default `1800`).

## Local setup

### One-command bootstrap (recommended)

From project root:

```bash
./scripts/dev-up.sh
```

This command now:

- starts PostgreSQL (`docker compose up -d db`)
- runs Prisma generate + migrations + seed
- starts backend on `http://127.0.0.1:3000`
- starts frontend on `http://127.0.0.1:5173`
- waits for backend/frontend readiness before returning
- retries runtime startup automatically when a process exits during boot

Startup retry/timeout controls (optional):

```bash
STARTUP_MAX_ATTEMPTS=3 BACKEND_READY_TIMEOUT_SECONDS=120 FRONTEND_READY_TIMEOUT_SECONDS=120 ./scripts/dev-up.sh
```

Stop local services:

```bash
./scripts/dev-down.sh
```

Stop local services and database container:

```bash
./scripts/dev-down.sh --with-db
```

### Manual setup

1. Create environment file:

```bash
cd backend
cp .env.example .env
```

2. Install dependencies and generate Prisma client:

```bash
npm install
npm run prisma:generate
```

3. Sync database schema and seed admin account:

```bash
npm run prisma:push
npm run prisma:seed
```

4. Start API:

```bash
npm run dev
```

## E2E smoke tests

Install Playwright browser (first time only):

```bash
cd frontend
npx playwright install chromium
```

Run smoke tests (expects local stack running on ports `3000` and `5173`):

```bash
cd frontend
npm run e2e:smoke
```

Run full E2E suite:

```bash
cd frontend
npm run e2e:full
```

Or run with automated bootstrap + teardown from project root:

```bash
PLAYWRIGHT_INSTALL=1 ./scripts/e2e-smoke.sh
```

Run API-only core smoke checks (health/login/users/inbounds/basic CRUD lifecycle):

```bash
./scripts/smoke-core-api.sh
```

Run REALITY hardening smoke checks (Myanmar-focused REALITY endpoints + config mapping):

```bash
./scripts/smoke-reality-hardening.sh
```

Run Myanmar connectivity hardening smoke checks (pack apply + bulk/group assignment + reorder + profile counters):

```bash
./scripts/smoke-myanmar-hardening.sh
```

Run full release checklist (core smoke + Myanmar smoke + API budget + API SLO + rollback readiness) with one summary:

```bash
./scripts/release-check.sh
```

Run checklist with automated local bootstrap + teardown:

```bash
./scripts/release-check.sh --bootstrap --teardown --quiet
```

Run checklist with local preflight reset (clears in-memory limiter state before checks):

```bash
./scripts/release-check.sh --preflight-reset --quiet
```

Run only the preflight reset step:

```bash
./scripts/release-preflight-reset.sh
```

Update Xray-core safely (build/pull + canary preflight + restart + config test + rollback):

```bash
./scripts/update-xray-core.sh --stable --canary
```

Use latest channel explicitly:

```bash
./scripts/update-xray-core.sh --latest --canary
```

Pin to a specific Xray-core image tag:

```bash
./scripts/update-xray-core.sh --image ghcr.io/xtls/xray-core:v1.8.24 --canary
```

Open interactive operations menu:

```bash
./scripts/menu.sh
```

Menu includes:

- `7) Run smoke suite (core + Myanmar hardening)`
- `8) Run release checklist` (uses preflight reset + rollback readiness + quiet logs)

Run rollback readiness gate only:

```bash
./scripts/rollback-readiness-check.sh
```

Run production hardening audit (env/containers/secrets baseline):

```bash
./scripts/production-hardening-audit.sh
```

Detailed operations checklist is documented in:

- `/Users/sankahchan/xray-panel/docs/production-hardening-runbook.md`

Canary policy + audit trail API endpoints:

```bash
# policy
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/xray/update/policy

# preflight checks (script/docker/lock readiness)
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/xray/update/preflight

# run canary (no restart)
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"channel":"stable"}' \
  http://localhost:3000/api/xray/update/canary

# run full rollout (restart)
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"channel":"stable"}' \
  http://localhost:3000/api/xray/update/full

# list rollback backup tags
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3000/api/xray/update/backups

# run rollback (latest backup by default)
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3000/api/xray/update/rollback

# force unlock stuck update lock (SUPER_ADMIN only)
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"reason":"manual-force-unlock","force":true}' \
  http://localhost:3000/api/xray/update/unlock

# history
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/xray/update/history?page=1&limit=20"
```

Skip core API smoke from E2E wrappers if needed:

```bash
SKIP_CORE_SMOKE=1 ./scripts/e2e-smoke.sh
```

Run API response-time budget checks only:

```bash
./scripts/api-budget-check.sh
```

Run API percentile SLO checks (`p95`/`p99`) only:

```bash
./scripts/api-slo-check.sh
```

Nightly/full script from project root:

```bash
PLAYWRIGHT_INSTALL=1 ./scripts/e2e-full.sh
```

## CI checks

GitHub Actions workflow: `.github/workflows/ci.yml`

- Push/PR:
  - `Frontend Lint + Build (Node 20)`
  - `Frontend Lint + Build (Node 22)`
  - `Smoke E2E (Node 20)`
  - `Smoke E2E (Node 22)`
  - `API Smoke Scripts (Core + Myanmar)`
- Smoke E2E includes API response-time budget validation for:
  - `/api/system/health`
  - `/api/system/metrics`
  - `/api/auth/login`
  - `/api/users`
  - `/api/inbounds`
- Smoke E2E also includes API percentile SLO validation (`p95`/`p99`) for:
  - `/api/system/health`
  - `/api/system/metrics`
  - `/api/users`
  - `/api/inbounds`
  - `/api/system/stats`
- Nightly (03:00 UTC) / Manual (`workflow_dispatch`):
  - `Full E2E (Nightly/Manual)`

## Deploy smoke gate

`/Users/sankahchan/xray-panel/scripts/deploy-complete.sh` now includes a pre-deploy smoke gate after backend startup:

- `./scripts/smoke-core-api.sh`
- `./scripts/smoke-myanmar-hardening.sh`

If either script fails, deployment stops immediately.

Control flags:

```bash
# default is true
export SMOKE_GATE_ENABLED=true

# optional overrides
export SMOKE_API_BASE_URL=http://127.0.0.1:3000/api
export SMOKE_ADMIN_USERNAME=admin
export SMOKE_ADMIN_PASSWORD=admin123
```

Skip gate when needed:

```bash
SMOKE_GATE_ENABLED=false ./scripts/deploy-complete.sh
```

## Docker setup

From project root:

```bash
docker compose up --build
```

API: `http://localhost:3000`

## One-command install (VPS)

One-UI ships with a one-command installer (Ubuntu/Debian):

```bash
wget -qO- https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | sudo bash
```

Defaults:

- Install dir: `/opt/one-ui`
- Data dir: `/var/lib/one-ui` (certs under `/var/lib/one-ui/certs`)
- Backup dir: `/var/backups/one-ui`
- Panel port: `3000`

### Non-interactive installer (flags/env only)

Run without prompts (recommended for automation):

```bash
wget -qO- https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | sudo bash -s -- \
  --non-interactive \
  --domain yourdomain.com \
  --admin-user admin \
  --admin-pass 'StrongPasswordHere' \
  --ssl-email admin@yourdomain.com \
  --cf-token 'your-cloudflare-api-token'
```

Environment-based example:

```bash
export ONEUI_NON_INTERACTIVE=true
export ONEUI_DOMAIN=yourdomain.com
export ONEUI_ADMIN_USER=admin
export ONEUI_ADMIN_PASS='StrongPasswordHere'
export ONEUI_SSL_EMAIL=admin@yourdomain.com
export ONEUI_CF_TOKEN='your-cloudflare-api-token'

wget -qO- https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | sudo bash
```

Global API key fallback (if you don’t want to use a token):

```bash
wget -qO- https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | sudo bash -s -- \
  --non-interactive \
  --domain yourdomain.com \
  --admin-pass 'StrongPasswordHere' \
  --cf-email your-cloudflare-email@example.com \
  --cf-key 'your-cloudflare-global-api-key'
```

To skip SSL issuance during unattended installs:

```bash
wget -qO- https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | sudo bash -s -- \
  --non-interactive \
  --domain yourdomain.com \
  --admin-pass 'StrongPasswordHere' \
  --skip-ssl
```

Optional port overrides (use if `3000` or `5432` are already used):

```bash
export ONEUI_PORT=3200
export ONEUI_DB_PORT=15432
wget -qO- https://raw.githubusercontent.com/sankahchan/One-UI/main/install.sh | sudo bash
```

## Observability (Prometheus + Alertmanager + Grafana)

Bring up monitoring services:

```bash
./scripts/observability-up.sh
```

Stop monitoring services:

```bash
./scripts/observability-down.sh
```

Send a synthetic firing alert to Alertmanager (end-to-end test):

```bash
./scripts/alertmanager-test.sh
```

Send a synthetic resolved alert:

```bash
./scripts/alertmanager-test.sh --resolve
```

Endpoints:

- Alertmanager: `http://127.0.0.1:9093`
- Prometheus: `http://127.0.0.1:9090`
- Grafana: `http://127.0.0.1:3001`

Grafana default credentials:

- Username: `admin`
- Password: `admin`

To override Grafana credentials:

```bash
export GRAFANA_ADMIN_USER=your_admin
export GRAFANA_ADMIN_PASSWORD=your_strong_password
export ALERT_WEBHOOK_SECRET=your_strong_alert_secret
./scripts/observability-up.sh
```

Pre-provisioned Grafana dashboard:

- `One-UI Backend Overview`

Pre-provisioned Prometheus alert rules:

- `OneUIBackendDown`
- `OneUIHighHttp5xxRate`
- `OneUIHighHttpLatencyP95`
- `OneUIHighDbLatencyP95`
- `OneUIOnlineUsersDroppedToZero`

Alertmanager noise-control policies:

- Critical alerts inhibit warning/info alerts with the same `alertname` and `service`
- Warning alerts inhibit info alerts with the same `alertname` and `service`
- `OneUIBackendDown` inhibits latency/5xx alerts for the same service
- Info alerts are muted during configured night windows (`oneui-night-silence`)

Alert flow:

- Prometheus evaluates rules from `/Users/sankahchan/xray-panel/monitoring/prometheus/alerts.yml`
- Prometheus sends firing/resolved alerts to Alertmanager
- Alertmanager sends webhook to `POST /api/system/alerts/webhook`
- Backend validates `Authorization: Bearer <ALERT_WEBHOOK_SECRET>` and forwards to Telegram admins

## Default seeded admin

- Username: `admin`
- Password: `admin123`
- Role: `SUPER_ADMIN`

Override with `SEED_ADMIN_*` environment variables.

## API endpoints

### Auth

- `POST /api/auth/login` (username/password)
- `POST /api/auth/logout` (Bearer token)
- `GET /api/auth/me` (Bearer token)

### Users (`SUPER_ADMIN` / `ADMIN`)

- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`

### Inbounds (authenticated admin)

- `GET /api/inbounds`
- `GET /api/inbounds/:id`
- `POST /api/inbounds`
- `PUT /api/inbounds/:id`
- `DELETE /api/inbounds/:id`

### Xray (authenticated admin)

- `GET /api/xray/status`
- `GET /api/xray/config`
- `POST /api/xray/config/reload`
- `POST /api/xray/start`
- `POST /api/xray/stop`
- `POST /api/xray/restart`

### System

- `GET /api/system/health`
- `GET /api/system/metrics` (Prometheus format)
- `POST /api/system/alerts/webhook` (internal Alertmanager receiver, Bearer secret required)
- `GET /api/system/stats` (Bearer token)

## Response format

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {},
  "meta": {}
}
```

## Notes

- `BigInt` values are serialized as strings in API responses.
- Passwords are stored as bcrypt hashes.

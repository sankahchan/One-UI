# One-UI Production Hardening Runbook

This runbook is the minimum operational baseline for production rollout.

## 1) Environment and Secrets

- Set `NODE_ENV=production` in `/Users/sankahchan/xray-panel/backend/.env`.
- Replace all default credentials (`DATABASE_URL`, admin seed password, bot tokens).
- Use a long random `JWT_SECRET` (at least 32 chars, recommended 64+).
- Prefer `CLOUDFLARE_API_TOKEN` over global key/email.
- Keep `.env` out of source control and rotate secrets on staff changes.

## 2) TLS and Network

- Ensure certificates exist at `SSL_CERT_PATH` before enabling TLS-only profiles.
- Verify nginx (or edge proxy) enforces HTTPS and forwards `X-Forwarded-*` headers.
- Expose only required ports:
  - `22/tcp` (restricted by IP if possible),
  - `80/443` for edge,
  - hide panel/API internal ports behind reverse proxy where possible.
- Confirm Cloudflare proxy mode for WS fallback domains when using CDN masking.

## 3) Access Control and Roles

- Use `SUPER_ADMIN` only for destructive actions (delete/revoke).
- Use `ADMIN` for day-to-day operations.
- Review admin accounts monthly and disable stale accounts.
- Enable and test 2FA where configured.

## 4) Backups and Restore Drill

- Schedule daily backup job and verify archive creation.
- Keep at least 7 days retention (or compliance policy requirement).
- Perform restore drill weekly on a staging environment.
- Validate that restored environment can:
  - authenticate admin,
  - list users/inbounds,
  - generate subscriptions.

## 5) Xray Core Update Safety

- Run preflight checks before canary/full rollout.
- Use canary deployment first, then full rollout.
- Keep rollback tag list fresh and test rollback path.
- Monitor error rate and reconnect spikes for at least 15 minutes after rollout.
- Run rollback readiness gate before rollout:
  - `./scripts/rollback-readiness-check.sh`

## 6) Monitoring and Alerts

- Enable health checks for backend, database, and xray runtime.
- Track:
  - login failures,
  - subscription errors,
  - reconnect spikes,
  - device/IP limit rejects.
- Verify Telegram/notification channels with periodic test events.

## 7) Pre-Release Checklist

Run from `/Users/sankahchan/xray-panel`:

```bash
./scripts/production-hardening-audit.sh
./scripts/release-check.sh
./scripts/rollback-readiness-check.sh
./scripts/smoke-core-api.sh
cd frontend && npm run lint && npm run build
cd ../backend && npm run check
```

## 8) Incident Rollback

- If rollout degrades connectivity:
  1. pause new config changes,
  2. run xray rollback (settings flow or rollback script),
  3. restore last known-good config snapshot,
  4. notify operators and open incident timeline.

## 9) Verification After Any Major Change

- Login path works.
- Users/Inbounds pages load and actions respond within expected latency.
- Subscription endpoints return valid payloads for v2ray/clash/singbox.
- Myanmar fallback profiles remain in expected priority order.

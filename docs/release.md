# One-UI Release Playbook

## Scope
This playbook covers pre-release validation, deploy, and rollback for `/Users/sankahchan/xray-panel`.

## 1) Pre-Release Validation

Run from project root:

```bash
cd /Users/sankahchan/xray-panel
npm run verify:quick
```

Full validation (includes API + Playwright smoke):

```bash
cd /Users/sankahchan/xray-panel
npm run verify
```

Release checklist wrapper:

```bash
cd /Users/sankahchan/xray-panel
./scripts/release-check.sh --preflight-reset --quiet
```

Combined pre-deploy gate:

```bash
cd /Users/sankahchan/xray-panel
npm run verify && ./scripts/release-check.sh --preflight-reset --quiet
```

## 2) Deploy

```bash
cd /Users/sankahchan/xray-panel
docker compose up -d --build
```

Optional frontend production artifact refresh:

```bash
cd /Users/sankahchan/xray-panel
./scripts/build-frontend.sh
```

## 3) Post-Deploy Checks

```bash
curl -s http://127.0.0.1:3000/api/system/health | jq
curl -s http://127.0.0.1:3000/api/system/stats -H "Authorization: Bearer <TOKEN>" | jq
```

Check runtime logs:

```bash
cd /Users/sankahchan/xray-panel
docker compose logs --tail=200 backend
docker compose logs --tail=200 xray
```

## 4) Rollback Path

### Application rollback

```bash
cd /Users/sankahchan/xray-panel
docker compose down
git checkout <last-known-good-tag-or-commit>
docker compose up -d --build
```

### Xray-core rollback

```bash
cd /Users/sankahchan/xray-panel
./scripts/update-xray-core.sh --list-backups
./scripts/update-xray-core.sh --rollback
```

### Xray config rollback snapshot

```bash
curl -X GET http://127.0.0.1:3000/api/xray/config/snapshots \
  -H "Authorization: Bearer <TOKEN>"

curl -X POST http://127.0.0.1:3000/api/xray/config/rollback \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"snapshotId":"<SNAPSHOT_ID>","applyMethod":"restart"}'
```

## 5) Menu Shortcut

You can run the same gates from:

```bash
cd /Users/sankahchan/xray-panel
./scripts/menu.sh
```

Use:
- `8` for quick verify.
- `9` for release checklist.
- `10` for full pre-deploy gate.

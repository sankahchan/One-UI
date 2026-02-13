#!/bin/bash
set -euo pipefail

ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://127.0.0.1:9093}"
ALERT_NAME="${ALERT_NAME:-OneUISyntheticAlert}"
ALERT_SEVERITY="${ALERT_SEVERITY:-warning}"
ALERT_SERVICE="${ALERT_SERVICE:-one-ui-backend}"
ALERT_SUMMARY="${ALERT_SUMMARY:-Synthetic alert from script}"
ALERT_DESCRIPTION="${ALERT_DESCRIPTION:-Manual test triggered via scripts/alertmanager-test.sh}"
RESOLVE="${RESOLVE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resolve)
      RESOLVE=1
      shift
      ;;
    --url)
      ALERTMANAGER_URL="$2"
      shift 2
      ;;
    --name)
      ALERT_NAME="$2"
      shift 2
      ;;
    --severity)
      ALERT_SEVERITY="$2"
      shift 2
      ;;
    --service)
      ALERT_SERVICE="$2"
      shift 2
      ;;
    --summary)
      ALERT_SUMMARY="$2"
      shift 2
      ;;
    --description)
      ALERT_DESCRIPTION="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--resolve] [--url <alertmanager-url>] [--name <alert-name>] [--severity <info|warning|critical>] [--service <service>] [--summary <text>] [--description <text>]"
      exit 1
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

PAYLOAD=$(ALERT_NAME="$ALERT_NAME" ALERT_SEVERITY="$ALERT_SEVERITY" ALERT_SERVICE="$ALERT_SERVICE" ALERT_SUMMARY="$ALERT_SUMMARY" ALERT_DESCRIPTION="$ALERT_DESCRIPTION" RESOLVE="$RESOLVE" node <<'NODE'
const now = Date.now();
const resolve = process.env.RESOLVE === '1';
const startsAt = new Date(now - 5 * 60 * 1000).toISOString();
const endsAt = resolve
  ? new Date(now - 1000).toISOString()
  : new Date(now + 4 * 60 * 60 * 1000).toISOString();

const payload = [
  {
    labels: {
      alertname: process.env.ALERT_NAME || 'OneUISyntheticAlert',
      severity: process.env.ALERT_SEVERITY || 'warning',
      service: process.env.ALERT_SERVICE || 'one-ui-backend'
    },
    annotations: {
      summary: process.env.ALERT_SUMMARY || 'Synthetic alert from script',
      description:
        process.env.ALERT_DESCRIPTION ||
        'Manual test triggered via scripts/alertmanager-test.sh'
    },
    startsAt,
    endsAt
  }
];

process.stdout.write(JSON.stringify(payload));
NODE
)

HTTP_CODE=$(curl -sS -o /tmp/oneui-alertmanager-test-response.json -w '%{http_code}' \
  -X POST "$ALERTMANAGER_URL/api/v2/alerts" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")

echo "Alertmanager response code: $HTTP_CODE"
if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  echo "Request failed"
  cat /tmp/oneui-alertmanager-test-response.json || true
  exit 1
fi

if [[ "$RESOLVE" == "1" ]]; then
  echo "Resolved synthetic alert sent to Alertmanager."
else
  echo "Firing synthetic alert sent to Alertmanager."
fi

echo "Target: $ALERTMANAGER_URL/api/v2/alerts"

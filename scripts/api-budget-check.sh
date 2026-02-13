#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
RUNS="${BUDGET_RUNS:-3}"

HEALTH_BUDGET_MS="${HEALTH_BUDGET_MS:-1200}"
METRICS_BUDGET_MS="${METRICS_BUDGET_MS:-1500}"
LOGIN_BUDGET_MS="${LOGIN_BUDGET_MS:-2500}"
USERS_BUDGET_MS="${USERS_BUDGET_MS:-2500}"
INBOUNDS_BUDGET_MS="${INBOUNDS_BUDGET_MS:-2500}"

ADMIN_USERNAME="${E2E_ADMIN_USERNAME:-${ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-admin123}}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to run API budget checks"
  exit 1
fi

wait_for_health() {
  local attempts=0
  local max_attempts=60

  until [[ "$attempts" -ge "$max_attempts" ]]; do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/system/health" || true)"

    if [[ "$code" == "200" ]]; then
      return 0
    fi

    attempts=$((attempts + 1))
    sleep 1
  done

  echo "Backend health endpoint did not become ready in time."
  return 1
}

to_milliseconds() {
  local seconds="$1"
  awk -v sec="$seconds" 'BEGIN { printf "%.0f", sec * 1000 }'
}

check_status() {
  local code="$1"
  local expected="$2"

  if [[ "$expected" == "2xx" ]]; then
    [[ "$code" -ge 200 && "$code" -lt 300 ]]
    return
  fi

  [[ "$code" == "$expected" ]]
}

measure_endpoint() {
  local name="$1"
  local method="$2"
  local url="$3"
  local expected="$4"
  local budget_ms="$5"
  local auth_header="${6:-}"
  local payload="${7:-}"

  local max_ms=0
  local sum_ms=0

  for ((i = 1; i <= RUNS; i += 1)); do
    local result

    if [[ "$method" == "GET" ]]; then
      if [[ -n "$auth_header" ]]; then
        result="$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' -H "$auth_header" "$url")"
      else
        result="$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' "$url")"
      fi
    else
      if [[ -n "$auth_header" ]]; then
        result="$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' -X "$method" -H 'Content-Type: application/json' -H "$auth_header" -d "$payload" "$url")"
      else
        result="$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' -X "$method" -H 'Content-Type: application/json' -d "$payload" "$url")"
      fi
    fi

    local code="${result%% *}"
    local time_total="${result##* }"
    local elapsed_ms
    elapsed_ms="$(to_milliseconds "$time_total")"

    if ! check_status "$code" "$expected"; then
      echo "[FAIL] $name run#$i returned status $code (expected $expected)"
      return 1
    fi

    if [[ "$elapsed_ms" -gt "$max_ms" ]]; then
      max_ms="$elapsed_ms"
    fi
    sum_ms=$((sum_ms + elapsed_ms))
  done

  local avg_ms
  avg_ms=$((sum_ms / RUNS))

  printf '[BUDGET] %-18s avg=%4sms max=%4sms budget=%4sms\n' "$name" "$avg_ms" "$max_ms" "$budget_ms"

  if [[ "$max_ms" -gt "$budget_ms" ]]; then
    echo "[FAIL] $name exceeded budget (max ${max_ms}ms > ${budget_ms}ms)"
    return 1
  fi

  return 0
}

extract_token() {
  local login_response="$1"

  TOKEN_JSON="$login_response" node -e '
    const raw = process.env.TOKEN_JSON || "";
    try {
      const parsed = JSON.parse(raw);
      const token = parsed?.data?.token || parsed?.token || "";
      if (!token) process.exit(2);
      process.stdout.write(token);
    } catch (_error) {
      process.exit(2);
    }
  '
}

main() {
  echo "Running API response-time budget checks against: $BASE_URL"
  wait_for_health

  measure_endpoint "health" "GET" "$BASE_URL/api/system/health" "2xx" "$HEALTH_BUDGET_MS"
  measure_endpoint "metrics" "GET" "$BASE_URL/api/system/metrics" "2xx" "$METRICS_BUDGET_MS"

  local login_payload
  login_payload=$(printf '{"username":"%s","password":"%s"}' "$ADMIN_USERNAME" "$ADMIN_PASSWORD")

  measure_endpoint "login" "POST" "$BASE_URL/api/auth/login" "2xx" "$LOGIN_BUDGET_MS" "" "$login_payload"

  local login_response
  login_response="$(curl -sS -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' -d "$login_payload")"

  local token
  token="$(extract_token "$login_response")"
  if [[ -z "$token" ]]; then
    echo "[FAIL] Could not extract access token from /api/auth/login response"
    return 1
  fi

  local auth_header
  auth_header="Authorization: Bearer $token"

  measure_endpoint "users" "GET" "$BASE_URL/api/users?page=1&limit=20" "2xx" "$USERS_BUDGET_MS" "$auth_header"
  measure_endpoint "inbounds" "GET" "$BASE_URL/api/inbounds" "2xx" "$INBOUNDS_BUDGET_MS" "$auth_header"

  echo "API response-time budgets passed."
}

main "$@"

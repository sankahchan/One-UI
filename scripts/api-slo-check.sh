#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
RUNS="${SLO_RUNS:-5}"

HEALTH_P95_MS="${HEALTH_P95_MS:-900}"
HEALTH_P99_MS="${HEALTH_P99_MS:-1200}"
METRICS_P95_MS="${METRICS_P95_MS:-1100}"
METRICS_P99_MS="${METRICS_P99_MS:-1500}"
USERS_P95_MS="${USERS_P95_MS:-1800}"
USERS_P99_MS="${USERS_P99_MS:-2300}"
INBOUNDS_P95_MS="${INBOUNDS_P95_MS:-1800}"
INBOUNDS_P99_MS="${INBOUNDS_P99_MS:-2300}"
SYSTEM_STATS_P95_MS="${SYSTEM_STATS_P95_MS:-1800}"
SYSTEM_STATS_P99_MS="${SYSTEM_STATS_P99_MS:-2300}"

ADMIN_USERNAME="${E2E_ADMIN_USERNAME:-${ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-admin123}}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to run API SLO checks"
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

percentile_index() {
  local percentile="$1"
  local n="$2"
  local idx=$(( (percentile * n + 99) / 100 ))
  if [[ "$idx" -lt 1 ]]; then
    idx=1
  fi
  if [[ "$idx" -gt "$n" ]]; then
    idx="$n"
  fi
  echo "$idx"
}

measure_percentiles() {
  local name="$1"
  local method="$2"
  local url="$3"
  local expected="$4"
  local p95_budget="$5"
  local p99_budget="$6"
  local auth_header="${7:-}"
  local payload="${8:-}"

  local -a samples=()
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

    samples+=("$elapsed_ms")
    sum_ms=$((sum_ms + elapsed_ms))
  done

  local -a sorted=()
  IFS=$'\n' sorted=($(printf '%s\n' "${samples[@]}" | sort -n))
  unset IFS

  local n="${#sorted[@]}"
  if [[ "$n" -eq 0 ]]; then
    echo "[FAIL] $name has no samples"
    return 1
  fi

  local idx95 idx99
  idx95="$(percentile_index 95 "$n")"
  idx99="$(percentile_index 99 "$n")"

  local p95="${sorted[$((idx95 - 1))]}"
  local p99="${sorted[$((idx99 - 1))]}"
  local avg=$((sum_ms / n))

  printf '[SLO] %-18s avg=%4sms p95=%4sms p99=%4sms budget(p95/p99)=%4s/%4sms\n' \
    "$name" "$avg" "$p95" "$p99" "$p95_budget" "$p99_budget"

  if [[ "$p95" -gt "$p95_budget" ]]; then
    echo "[FAIL] $name p95 budget exceeded (${p95}ms > ${p95_budget}ms)"
    return 1
  fi

  if [[ "$p99" -gt "$p99_budget" ]]; then
    echo "[FAIL] $name p99 budget exceeded (${p99}ms > ${p99_budget}ms)"
    return 1
  fi
}

main() {
  echo "Running API p95/p99 SLO checks against: $BASE_URL"
  wait_for_health

  local login_payload
  login_payload=$(printf '{"username":"%s","password":"%s"}' "$ADMIN_USERNAME" "$ADMIN_PASSWORD")

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

  measure_percentiles "health" "GET" "$BASE_URL/api/system/health" "2xx" "$HEALTH_P95_MS" "$HEALTH_P99_MS"
  measure_percentiles "metrics" "GET" "$BASE_URL/api/system/metrics" "2xx" "$METRICS_P95_MS" "$METRICS_P99_MS"
  measure_percentiles "users" "GET" "$BASE_URL/api/users?page=1&limit=20" "2xx" "$USERS_P95_MS" "$USERS_P99_MS" "$auth_header"
  measure_percentiles "inbounds" "GET" "$BASE_URL/api/inbounds" "2xx" "$INBOUNDS_P95_MS" "$INBOUNDS_P99_MS" "$auth_header"
  measure_percentiles "system_stats" "GET" "$BASE_URL/api/system/stats" "2xx" "$SYSTEM_STATS_P95_MS" "$SYSTEM_STATS_P99_MS" "$auth_header"

  echo "API p95/p99 SLO checks passed."
}

main "$@"

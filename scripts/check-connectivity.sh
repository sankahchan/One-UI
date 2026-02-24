#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ONEUI_INSTALL_DIR:-/opt/one-ui}"
PUBLIC_IP_INPUT="${1:-}"
COMPOSE_FILE="${COMPOSE_FILE:-}"
XRAY_SERVICE="${XRAY_SERVICE:-}"
XRAY_CONTAINER_NAME="${XRAY_CONTAINER_NAME:-}"
CONFIG_PATH="${CONFIG_PATH:-}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
cyan() { printf '\033[0;36m%s\033[0m\n' "$*"; }

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "[error] Missing required command: $cmd"
    exit 1
  fi
}

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return
  fi
  red "[error] docker compose is not available."
  exit 1
}

resolve_compose_file() {
  if [[ -n "$COMPOSE_FILE" && -f "$COMPOSE_FILE" ]]; then
    return
  fi

  local candidates=(
    "$ROOT_DIR/docker-compose.yml"
    "$ROOT_DIR/docker-compose.yaml"
    "$PWD/docker-compose.yml"
    "$PWD/docker-compose.yaml"
  )

  COMPOSE_FILE=""
  for f in "${candidates[@]}"; do
    if [[ -f "$f" ]]; then
      COMPOSE_FILE="$f"
      return
    fi
  done
}

compose() {
  if [[ -n "$COMPOSE_FILE" ]]; then
    "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" "$@"
  else
    "${COMPOSE_CMD[@]}" "$@"
  fi
}

resolve_public_ip() {
  if [[ -n "$PUBLIC_IP_INPUT" ]]; then
    printf '%s\n' "$PUBLIC_IP_INPUT"
    return
  fi

  local ip=""
  ip="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi

  printf '%s\n' "$ip"
}

resolve_xray_service() {
  if [[ -n "$XRAY_SERVICE" ]]; then
    printf '%s\n' "$XRAY_SERVICE"
    return
  fi

  local services
  services="$(compose config --services 2>/dev/null || true)"

  for candidate in xray-core xray one-ui-xray; do
    if printf '%s\n' "$services" | grep -qx "$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  printf '%s\n' ""
}

resolve_xray_container() {
  local service="$1"

  if [[ -n "$XRAY_CONTAINER_NAME" ]]; then
    printf '%s\n' "$XRAY_CONTAINER_NAME"
    return
  fi

  if [[ -n "$service" ]]; then
    local cid
    cid="$(compose ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##'
      return
    fi
  fi

  docker ps --format '{{.Names}}' | grep -E '(^xray-core$|^xray$|^one-ui-xray$|xray)' | head -n1 || true
}

resolve_config_file() {
  if [[ -n "$CONFIG_PATH" && -f "$CONFIG_PATH" ]]; then
    printf '%s\n' "$CONFIG_PATH"
    return
  fi

  local candidates=(
    "$ROOT_DIR/xray/config.json"
    "/etc/xray/config.json"
    "$PWD/xray/config.json"
  )

  for f in "${candidates[@]}"; do
    if [[ -f "$f" ]]; then
      printf '%s\n' "$f"
      return
    fi
  done

  printf '%s\n' ""
}

extract_inbounds() {
  local cfg="$1"
  local out="$2"

  jq -r '
    (.inbounds // [])[]
    | select((.port|type)=="number" and .port >= 1 and .port <= 65535)
    | [
        (.tag // .remark // "untagged"),
        (.protocol // "unknown"),
        (.port|tostring),
        (.listen // "0.0.0.0"),
        (.streamSettings.network // "tcp"),
        (.streamSettings.security // "none"),
        (.settings.network // ""),
        (.streamSettings.realitySettings.dest // "")
      ]
    | @tsv
  ' "$cfg" >"$out"
}

transport_for() {
  local protocol="$1"
  local network="$2"
  local dokodemo_network="$3"

  local p n d
  p="$(printf '%s' "$protocol" | tr '[:upper:]' '[:lower:]')"
  n="$(printf '%s' "$network" | tr '[:upper:]' '[:lower:]')"
  d="$(printf '%s' "$dokodemo_network" | tr '[:upper:]' '[:lower:]')"

  if [[ "$p" == "wireguard" ]]; then
    printf 'udp\n'
    return
  fi

  if [[ "$p" == "dokodemo-door" ]]; then
    if [[ "$d" == *"tcp"* && "$d" == *"udp"* ]]; then
      printf 'both\n'
      return
    fi
    if [[ "$d" == *"udp"* ]]; then
      printf 'udp\n'
      return
    fi
    printf 'tcp\n'
    return
  fi

  if [[ "$n" == "kcp" || "$n" == "quic" ]]; then
    printf 'udp\n'
    return
  fi

  printf 'tcp\n'
}

check_tcp_listener() {
  local port="$1"
  ss -lntH "( sport = :$port )" 2>/dev/null | grep -q .
}

check_udp_listener() {
  local port="$1"
  ss -lnuH "( sport = :$port )" 2>/dev/null | grep -q .
}

probe_tcp() {
  local host="$1"
  local port="$2"

  if command -v nc >/dev/null 2>&1; then
    nc -z -w2 "$host" "$port" >/dev/null 2>&1
    return
  fi

  timeout 3 bash -c "</dev/tcp/${host}/${port}" >/dev/null 2>&1
}

is_loopback_host() {
  local host="${1:-}"
  case "$host" in
    127.0.0.1|localhost|::1)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

probe_reality_dest_tls() {
  local dest="$1"
  local host port

  host="${dest%:*}"
  port="${dest##*:}"

  if [[ -z "$host" || -z "$port" || ! "$port" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  if command -v openssl >/dev/null 2>&1; then
    timeout 4 openssl s_client -connect "${host}:${port}" -servername "$host" -brief < /dev/null >/dev/null 2>&1
    return
  fi

  probe_tcp "$host" "$port"
}

print_header() {
  cyan "=== One-UI Connectivity Check ==="
  echo "Root dir:        $ROOT_DIR"
  echo "Compose file:    ${COMPOSE_FILE:-auto-detect}"
  echo "Xray service:    ${XRAY_SERVICE:-unknown}"
  echo "Xray container:  ${XRAY_CONTAINER_NAME:-unknown}"
  echo "Public IP:       ${PUBLIC_IP:-unknown}"
  echo "Config file:     ${CONFIG_FILE:-unknown}"
  echo
}

main() {
  require_cmd docker
  require_cmd jq
  require_cmd ss
  require_cmd awk

  resolve_compose_cmd
  resolve_compose_file

  PUBLIC_IP="$(resolve_public_ip)"
  XRAY_SERVICE="$(resolve_xray_service)"
  XRAY_CONTAINER_NAME="$(resolve_xray_container "$XRAY_SERVICE")"
  CONFIG_FILE="$(resolve_config_file)"

  if [[ -z "$CONFIG_FILE" ]]; then
    if [[ -n "$XRAY_CONTAINER_NAME" ]]; then
      CONFIG_FILE="$TMP_DIR/config.json"
      if ! docker exec "$XRAY_CONTAINER_NAME" cat /etc/xray/config.json >"$CONFIG_FILE" 2>/dev/null; then
        red "[error] Cannot read /etc/xray/config.json from container $XRAY_CONTAINER_NAME"
        exit 1
      fi
    else
      red "[error] Could not find config.json on host and no Xray container detected."
      exit 1
    fi
  fi

  local inbound_file="$TMP_DIR/inbounds.tsv"
  extract_inbounds "$CONFIG_FILE" "$inbound_file"

  if [[ ! -s "$inbound_file" ]]; then
    red "[error] No valid inbounds found in $CONFIG_FILE"
    exit 1
  fi

  print_header

  cyan "--- Compose status ---"
  compose ps || yellow "[warn] compose ps failed; continuing checks."
  echo

  if [[ -n "$XRAY_CONTAINER_NAME" ]]; then
    cyan "--- Xray quick checks ---"
    if docker exec "$XRAY_CONTAINER_NAME" xray -test -config /etc/xray/config.json >/dev/null 2>&1; then
      green "PASS: xray config test succeeded"
    else
      yellow "WARN: xray -test failed or xray binary unavailable; showing recent logs"
      docker logs --tail=40 "$XRAY_CONTAINER_NAME" 2>/dev/null || true
    fi
    echo
  fi

  cyan "--- Inbound matrix ---"
  printf "%-28s %-14s %-7s %-12s %-10s %-9s\n" "TAG" "PROTOCOL" "PORT" "NETWORK" "SECURITY" "TRANSPORT"
  printf "%-28s %-14s %-7s %-12s %-10s %-9s\n" "----------------------------" "--------------" "-------" "------------" "----------" "---------"

  while IFS=$'\t' read -r tag protocol port listen network security dokodemo_network reality_dest; do
    transport="$(transport_for "$protocol" "$network" "$dokodemo_network")"
    printf "%-28s %-14s %-7s %-12s %-10s %-9s\n" "$tag" "${protocol^^}" "$port" "${network^^}" "${security^^}" "${transport^^}"
  done <"$inbound_file"
  echo

  local failures=0
  local closed_tcp_ports=()
  local udp_ports=()

  cyan "--- Listener checks ---"
  while IFS=$'\t' read -r tag protocol port listen network security dokodemo_network reality_dest; do
    transport="$(transport_for "$protocol" "$network" "$dokodemo_network")"

    case "$transport" in
      tcp|both)
        if check_tcp_listener "$port"; then
          green "PASS: tcp/$port listening ($tag)"
        else
          red "FAIL: tcp/$port not listening ($tag)"
          failures=$((failures + 1))
        fi
        ;;
    esac

    case "$transport" in
      udp|both)
        udp_ports+=("$port")
        if check_udp_listener "$port"; then
          green "PASS: udp/$port listening ($tag)"
        else
          yellow "WARN: udp/$port not detected ($tag)"
        fi
        ;;
    esac

    if [[ "${security,,}" == "reality" && -n "$reality_dest" ]]; then
      if probe_reality_dest_tls "$reality_dest"; then
        green "PASS: REALITY destination reachable ($reality_dest)"
      else
        yellow "WARN: REALITY destination not reachable ($reality_dest)"
      fi
    fi
  done <"$inbound_file"
  echo

  if [[ -n "$PUBLIC_IP" ]]; then
    cyan "--- External TCP reachability (this host -> $PUBLIC_IP) ---"
    while IFS=$'\t' read -r tag protocol port listen network security dokodemo_network reality_dest; do
      transport="$(transport_for "$protocol" "$network" "$dokodemo_network")"
      if [[ "$transport" != "tcp" && "$transport" != "both" ]]; then
        continue
      fi
      # Skip internal control-plane/API inbounds from external checks.
      if [[ "$tag" == "api" ]] || is_loopback_host "$listen"; then
        continue
      fi

      if probe_tcp "$PUBLIC_IP" "$port"; then
        green "PASS: tcp/$port reachable on public IP"
      else
        red "FAIL: tcp/$port blocked on public IP"
        closed_tcp_ports+=("$port")
      fi
    done <"$inbound_file"
    echo
  else
    yellow "[warn] Could not determine public IP. Skip external TCP probe."
    echo
  fi

  cyan "--- Firewall summary ---"
  if command -v ufw >/dev/null 2>&1; then
    ufw status || true
  else
    yellow "ufw not installed"
  fi
  echo

  if [[ "${#closed_tcp_ports[@]}" -gt 0 ]]; then
    mapfile -t uniq_closed_tcp_ports < <(printf '%s\n' "${closed_tcp_ports[@]}" | sort -nu)
    cyan "--- Suggested fixes for blocked TCP ports ---"
    printf '%s\n' "1) Open VPS firewall:"
    for p in "${uniq_closed_tcp_ports[@]}"; do
      printf '   sudo ufw allow %s/tcp\n' "$p"
    done
    echo "   sudo ufw reload"
    echo
    printf '%s\n' "2) Open cloud firewall/security-group for:"
    for p in "${uniq_closed_tcp_ports[@]}"; do
      printf '   TCP %s\n' "$p"
    done
    echo
    printf '%s\n' "3) Re-run this script after firewall changes."
    echo
  fi

  if [[ "${#udp_ports[@]}" -gt 0 ]]; then
    yellow "[note] UDP inbounds detected: $(printf '%s\n' "${udp_ports[@]}" | sort -nu | tr '\n' ' ')"
    yellow "       External UDP reachability is not fully validated by this script."
    echo
  fi

  cyan "--- Result ---"
  if [[ "$failures" -eq 0 && "${#closed_tcp_ports[@]}" -eq 0 ]]; then
    green "PASS: no blocking connectivity issues detected."
    exit 0
  fi

  red "FAIL: connectivity issues detected (see failures above)."
  exit 2
}

main "$@"

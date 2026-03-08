#!/bin/sh

set -eu

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

COMMENT_TAG="oneui-mieru-managed"

normalize_transport() {
    case "$(printf '%s' "${1:-TCP}" | tr '[:lower:]' '[:upper:]')" in
        UDP)
            printf 'udp'
            ;;
        *)
            printf 'tcp'
            ;;
    esac
}

parse_range() {
    value=$(printf '%s' "${1:-}" | tr -d '[:space:]')
    [ -n "$value" ] || return 1

    case "$value" in
        *-*)
            start=${value%-*}
            end=${value#*-}
            ;;
        *)
            start=$value
            end=$value
            ;;
    esac

    case "$start" in
        ''|*[!0-9]*) return 1 ;;
    esac
    case "$end" in
        ''|*[!0-9]*) return 1 ;;
    esac

    if [ "$start" -lt 1 ] || [ "$start" -gt 65535 ] || [ "$end" -lt 1 ] || [ "$end" -gt 65535 ] || [ "$start" -gt "$end" ]; then
        return 1
    fi

    printf '%s\n%s\n' "$start" "$end"
}

port_spec_from_range() {
    start="$1"
    end="$2"
    if [ "$start" -eq "$end" ]; then
        printf '%s' "$start"
    else
        printf '%s:%s' "$start" "$end"
    fi
}

listener_exists() {
    protocol="$1"
    port="$2"

    if ! command -v ss >/dev/null 2>&1; then
        return 1
    fi

    if [ "$protocol" = "udp" ]; then
        ss -H -lun 2>/dev/null | awk '{print $5}' | grep -Eq "(:|\\])${port}$"
        return $?
    fi

    ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\])${port}$"
    return $?
}

transport=$(normalize_transport "${1:-TCP}")
range_value="${2:-8444-8444}"
parsed="$(parse_range "$range_value")" || {
    echo "error=invalid-port-range"
    exit 1
}
start=$(printf '%s\n' "$parsed" | sed -n '1p')
end=$(printf '%s\n' "$parsed" | sed -n '2p')
port_spec=$(port_spec_from_range "$start" "$end")

expected_ports=$((end - start + 1))
matched_ports=0
missing_ports=""

port="$start"
while [ "$port" -le "$end" ]; do
    if listener_exists "$transport" "$port"; then
        matched_ports=$((matched_ports + 1))
    else
        if [ -n "$missing_ports" ]; then
            missing_ports="${missing_ports},${port}"
        else
            missing_ports="${port}"
        fi
    fi
    port=$((port + 1))
done

listener_ok="false"
listener_detail="No listener detected on the configured Mieru port."
if [ "$matched_ports" -eq "$expected_ports" ]; then
    listener_ok="true"
    listener_detail="Listener detected on all configured Mieru ports."
elif [ "$matched_ports" -gt 0 ]; then
    listener_detail="Listener detected on ${matched_ports}/${expected_ports} configured Mieru ports."
fi

firewall_ok="false"
firewall_source="none"
firewall_detail="No One-UI-managed firewall rule detected for the configured Mieru port."

if command -v iptables >/dev/null 2>&1 && \
   iptables -C INPUT -p "$transport" -m "$transport" --dport "$port_spec" -m comment --comment "$COMMENT_TAG" -j ACCEPT 2>/dev/null; then
    firewall_ok="true"
    firewall_source="iptables"
    firewall_detail="One-UI-managed iptables rule detected for the configured Mieru port."
elif command -v ufw >/dev/null 2>&1 && \
     ufw status 2>/dev/null | grep -Eq "(^|[[:space:]])${port_spec}/${transport}([[:space:]]+|$).*ALLOW"; then
    firewall_ok="true"
    firewall_source="ufw"
    firewall_detail="UFW allow rule detected for the configured Mieru port."
fi

ready="false"
if [ "$listener_ok" = "true" ] && [ "$firewall_ok" = "true" ]; then
    ready="true"
fi

printf 'transport=%s\n' "$transport"
printf 'port_range=%s\n' "$range_value"
printf 'port_spec=%s\n' "$port_spec"
printf 'listener_ok=%s\n' "$listener_ok"
printf 'listener_expected=%s\n' "$expected_ports"
printf 'listener_matched=%s\n' "$matched_ports"
printf 'listener_missing=%s\n' "$missing_ports"
printf 'listener_detail=%s\n' "$listener_detail"
printf 'firewall_ok=%s\n' "$firewall_ok"
printf 'firewall_source=%s\n' "$firewall_source"
printf 'firewall_detail=%s\n' "$firewall_detail"
printf 'ready=%s\n' "$ready"

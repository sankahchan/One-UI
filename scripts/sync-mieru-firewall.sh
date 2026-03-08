#!/bin/sh

set -eu

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

COMMENT_TAG="oneui-mieru-managed"
COMMENT_LABEL="One-UI Mieru"
CONFIG_FILE="${MIERU_FIREWALL_CONFIG_PATH:-/opt/one-ui/mieru/server_config.json}"

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

range_to_port_spec() {
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

    if [ "$start" -eq "$end" ]; then
        printf '%s' "$start"
    else
        printf '%s:%s' "$start" "$end"
    fi
}

extract_from_config() {
    [ -f "$CONFIG_FILE" ] || return 1
    command -v jq >/dev/null 2>&1 || return 1

    transport_raw=$(jq -r '.portBindings[0].protocol // empty' "$CONFIG_FILE" 2>/dev/null || true)
    port_raw=$(jq -r '.portBindings[0].port // empty' "$CONFIG_FILE" 2>/dev/null || true)
    range_raw=$(jq -r '.portBindings[0].portRange // empty' "$CONFIG_FILE" 2>/dev/null || true)

    if [ -n "$range_raw" ]; then
        port_spec=$(range_to_port_spec "$range_raw") || return 1
    elif [ -n "$port_raw" ]; then
        port_spec=$(range_to_port_spec "$port_raw") || return 1
    else
        return 1
    fi

    transport=$(normalize_transport "$transport_raw")
    printf '%s\n%s\n' "$transport" "$port_spec"
}

cleanup_iptables_rules() {
    command -v iptables >/dev/null 2>&1 || return 0

    current_rules=$(iptables -S INPUT | grep "$COMMENT_TAG" || true)
    [ -n "$current_rules" ] || return 0

    printf '%s\n' "$current_rules" | while IFS= read -r rule; do
        [ -n "$rule" ] || continue
        clean_rule=$(printf '%s\n' "$rule" | sed 's/^-A INPUT /-D INPUT /')
        iptables $clean_rule 2>/dev/null || true
    done
}

sync_with_iptables() {
    transport="$1"
    port_spec="$2"
    transport_upper=$(printf '%s' "$transport" | tr '[:lower:]' '[:upper:]')

    command -v iptables >/dev/null 2>&1 || {
        echo "[sync-mieru-firewall] iptables not available; skipping."
        return 0
    }

    cleanup_iptables_rules

    if iptables -C INPUT -p "$transport" -m "$transport" --dport "$port_spec" -m comment --comment "$COMMENT_TAG" -j ACCEPT 2>/dev/null; then
        echo "[sync-mieru-firewall] ${transport_upper} ${port_spec} already allowed via iptables."
        return 0
    fi

    echo "[sync-mieru-firewall] Allowing ${transport_upper} ${port_spec} via iptables."
    iptables -I INPUT 1 -p "$transport" -m "$transport" --dport "$port_spec" -m comment --comment "$COMMENT_TAG" -j ACCEPT
}

sync_with_ufw() {
    transport="$1"
    port_spec="$2"

    command -v ufw >/dev/null 2>&1 || return 1

    rule="${port_spec}/${transport}"
    echo "[sync-mieru-firewall] Allowing ${rule} via ufw."
    ufw allow "$rule" comment "$COMMENT_LABEL" >/dev/null 2>&1 || ufw allow "$rule" >/dev/null 2>&1
}

if [ "$#" -ge 2 ]; then
    transport=$(normalize_transport "$1")
    port_spec=$(range_to_port_spec "$2") || {
        echo "[sync-mieru-firewall] Invalid port range: $2"
        exit 1
    }
else
    extracted="$(extract_from_config || true)"
    if [ -z "$extracted" ]; then
        echo "[sync-mieru-firewall] No Mieru port bindings found; skipping."
        exit 0
    fi
    transport=$(printf '%s\n' "$extracted" | sed -n '1p')
    port_spec=$(printf '%s\n' "$extracted" | sed -n '2p')
fi

if sync_with_ufw "$transport" "$port_spec"; then
    exit 0
fi

sync_with_iptables "$transport" "$port_spec"

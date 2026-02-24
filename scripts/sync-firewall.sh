#!/bin/sh

# One-UI Dynamic IPTables Firewall Sync
# This script is executed inside the xray-core container.
# It reads /etc/xray/config.json, extracts all inbound listening ports,
# and dynamically manages iptables rules on the host to ensure they are open.

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

CONFIG_FILE="/etc/xray/config.json"
COMMENT_TAG="oneui-managed"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "[sync-firewall] Xray config file not found: $CONFIG_FILE"
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "[sync-firewall] Error: jq is required but not installed."
    exit 1
fi

if ! command -v iptables >/dev/null 2>&1; then
    echo "[sync-firewall] Error: iptables is required but not installed."
    exit 1
fi

# 1. Parse all desired ports from the Xray config
echo "[sync-firewall] Reading active inbound ports from $CONFIG_FILE..."
DESIRED_TCP_PORTS=$(jq -r '.inbounds[] | select(.protocol == "shadowsocks" or .protocol == "vless" or .protocol == "vmess" or .protocol == "trojan") | .port' "$CONFIG_FILE" | grep -v "null" | sort -nu)
DESIRED_UDP_PORTS=$(jq -r '.inbounds[] | select(.protocol == "wireguard" or .protocol == "shadowsocks") | .port' "$CONFIG_FILE" | grep -v "null" | sort -nu)

# 2. Get current iptables rules managed by One-UI
CURRENT_TCP_RULES=$(iptables -S INPUT | grep "$COMMENT_TAG" | grep " -p tcp " || true)
CURRENT_UDP_RULES=$(iptables -S INPUT | grep "$COMMENT_TAG" | grep " -p udp " || true)

# 3. Clean up stale TCP ports
if [ -n "$CURRENT_TCP_RULES" ]; then
    echo "$CURRENT_TCP_RULES" | while read -r rule; do
        port=$(echo "$rule" | sed -n 's/.*--dport \([0-9][0-9]*\).*/\1/p')
        # If port is missing from extraction but rule exists, skip to avoid blank eval
        if [ -z "$port" ]; then continue; fi

        found=0
        for dp in $DESIRED_TCP_PORTS; do
            if [ "$dp" = "$port" ]; then
                found=1
                break
            fi
        done

        if [ $found -eq 0 ]; then
            echo "[sync-firewall] Removing stale TCP port: $port"
            clean_rule=$(echo "$rule" | sed 's/-A INPUT /-D INPUT /')
            iptables $clean_rule
        fi
    done
fi

# 4. Clean up stale UDP ports
if [ -n "$CURRENT_UDP_RULES" ]; then
    echo "$CURRENT_UDP_RULES" | while read -r rule; do
        port=$(echo "$rule" | sed -n 's/.*--dport \([0-9][0-9]*\).*/\1/p')
        if [ -z "$port" ]; then continue; fi

        found=0
        for dp in $DESIRED_UDP_PORTS; do
            if [ "$dp" = "$port" ]; then
                found=1
                break
            fi
        done

        if [ $found -eq 0 ]; then
            echo "[sync-firewall] Removing stale UDP port: $port"
            clean_rule=$(echo "$rule" | sed 's/-A INPUT /-D INPUT /')
            iptables $clean_rule
        fi
    done
fi

# 5. Add new TCP ports
for port in $DESIRED_TCP_PORTS; do
    if ! iptables -C INPUT -p tcp -m tcp --dport "$port" -m comment --comment "$COMMENT_TAG" -j ACCEPT 2>/dev/null; then
        echo "[sync-firewall] Allowing TCP port: $port"
        iptables -I INPUT 1 -p tcp -m tcp --dport "$port" -m comment --comment "$COMMENT_TAG" -j ACCEPT
    fi
done

# 6. Add new UDP ports
for port in $DESIRED_UDP_PORTS; do
    if ! iptables -C INPUT -p udp -m udp --dport "$port" -m comment --comment "$COMMENT_TAG" -j ACCEPT 2>/dev/null; then
        echo "[sync-firewall] Allowing UDP port: $port"
        iptables -I INPUT 1 -p udp -m udp --dport "$port" -m comment --comment "$COMMENT_TAG" -j ACCEPT
    fi
done

echo "[sync-firewall] Firewall port synchronization complete."

#!/bin/sh
echo "[entrypoint] Triggering initial firewall sync..."
sh /usr/local/bin/sync-firewall.sh &
sh /usr/local/bin/sync-mieru-firewall.sh &

echo "[entrypoint] Starting Xray core..."
exec xray run -config "$@"

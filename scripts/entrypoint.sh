#!/bin/sh
echo "[entrypoint] Triggering initial firewall sync..."
sh /usr/local/bin/sync-firewall.sh &

echo "[entrypoint] Starting Xray core..."
exec xray run -config "$@"

#!/bin/bash
# Wraps the official mongo entrypoint: a replica set with authentication needs
# a shared keyFile. A random one is generated into the (persistent) config
# volume on first start and reused afterwards.
set -euo pipefail
KEYFILE=/data/configdb/replica.key
if [ ! -s "$KEYFILE" ]; then
  echo "Generating MongoDB replica-set keyFile"
  head -c 756 /dev/urandom | base64 -w0 > "$KEYFILE"
fi
chmod 400 "$KEYFILE"
chown 999:999 "$KEYFILE" 2>/dev/null || true
exec /usr/local/bin/docker-entrypoint.sh "$@"

#!/usr/bin/env bash
# Logical MongoDB backup (compressed single archive) with a SHA-256 checksum and
# a collection-count manifest used by scripts/verify-restore.mjs.
#
#   MONGO_URI=... BACKUP_DIR=/var/backups/shop ./scripts/backup-mongo.sh
#
# Requires mongodump (MongoDB Database Tools). Read-only against the source database.
set -euo pipefail

: "${MONGO_URI:?MONGO_URI must be set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
MONGODUMP="${MONGODUMP:-mongodump}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${BACKUP_DIR}/shop-${stamp}.archive.gz"

mkdir -p "$BACKUP_DIR"
umask 077
"$MONGODUMP" --uri="$MONGO_URI" --gzip --archive="$archive" --readPreference=secondaryPreferred
sha256sum "$archive" > "${archive}.sha256"
node "$(dirname "$0")/verify-restore.mjs" manifest --out "${archive}.manifest.json"
echo "Backup written: $archive"

# Retention: remove archives (and sidecar files) older than RETENTION_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -name 'shop-*.archive.gz*' -mtime +"$RETENTION_DAYS" -print -delete

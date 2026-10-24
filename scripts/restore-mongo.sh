#!/usr/bin/env bash
# Restores a backup archive into a *target* database and refuses to touch the
# production database name unless explicitly forced. Intended for restore drills
# (restore into a scratch database, then run verify-restore.mjs compare).
#
#   ARCHIVE=backups/shop-2026....archive.gz \
#   SOURCE_DB=shop TARGET_DB=shop_restore_check \
#   RESTORE_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0 ./scripts/restore-mongo.sh
set -euo pipefail

: "${ARCHIVE:?ARCHIVE must point to a backup .archive.gz}"
: "${SOURCE_DB:?SOURCE_DB (database name inside the archive) must be set}"
: "${TARGET_DB:?TARGET_DB (database to restore into) must be set}"
: "${RESTORE_URI:?RESTORE_URI (connection string WITHOUT a database path) must be set}"
MONGORESTORE="${MONGORESTORE:-mongorestore}"

if [ "$SOURCE_DB" = "$TARGET_DB" ] && [ "${I_UNDERSTAND_THIS_OVERWRITES:-}" != "yes" ]; then
  echo "Refusing to restore over the source database name. Use a scratch TARGET_DB, or set I_UNDERSTAND_THIS_OVERWRITES=yes." >&2
  exit 1
fi
if [ -f "${ARCHIVE}.sha256" ]; then
  (cd "$(dirname "$ARCHIVE")" && sha256sum --check "$(basename "$ARCHIVE").sha256")
else
  echo "WARNING: no checksum file next to the archive; integrity not verified." >&2
fi
"$MONGORESTORE" --uri="$RESTORE_URI" --gzip --archive="$ARCHIVE" \
  --nsInclude="${SOURCE_DB}.*" --nsFrom="${SOURCE_DB}.*" --nsTo="${TARGET_DB}.*" --drop
echo "Restored ${SOURCE_DB} -> ${TARGET_DB}"

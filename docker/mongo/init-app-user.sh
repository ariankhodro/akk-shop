#!/bin/bash
# Runs once, on an empty data volume (docker-entrypoint-initdb.d). Creates the
# least-privilege application user: readWrite on the application database only.
set -euo pipefail
: "${MONGO_APP_DB:=miba}"
: "${MONGO_APP_USER:?MONGO_APP_USER is required}"
: "${MONGO_APP_PASSWORD:?MONGO_APP_PASSWORD is required}"
mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin "$MONGO_APP_DB" <<JS
const user = process.env.MONGO_APP_USER;
if (!db.getUser(user)) {
  db.createUser({ user, pwd: process.env.MONGO_APP_PASSWORD, roles: [{ role: "readWrite", db: process.env.MONGO_APP_DB || "miba" }] });
  print("Created application user " + user);
}
JS

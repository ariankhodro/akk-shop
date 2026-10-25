#!/bin/bash
# Healthy only when this node is the writable primary. Initiates the single-node
# replica set on first run (idempotent: rs.initiate is skipped once configured).
set -euo pipefail
mongosh --quiet --host 127.0.0.1 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin --eval '
try { rs.status(); }
catch (error) {
  if (error.codeName === "NotYetInitialized" || /no replset config/i.test(String(error.message))) {
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
  } else { throw error; }
}
if (!db.hello().isWritablePrimary) quit(1);
' >/dev/null

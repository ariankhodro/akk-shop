# Backup and restore

## What holds data of record

| Store | Contents | Backed up? |
|---|---|---|
| MongoDB (replica set) | users, products, orders, payments, coupons, audit log | **Yes, required** |
| Redis | refresh-token digests, rate-limit counters, locks, caches | No. Loss logs everyone out and resets counters; nothing of record. Persistence is not required. |
| Cloudinary | product images | Use Cloudinary's own backup/export; not covered here. |

Recommended targets (decide with the business): **RPO 24 h** with a daily logical backup, or minutes with a managed provider's continuous backup / point-in-time recovery (preferred for a live store). **RTO 2 h.** These are proposals, not measured values.

## Taking a backup

```bash
MONGO_URI='mongodb://...' BACKUP_DIR=/var/backups/shop RETENTION_DAYS=14 ./scripts/backup-mongo.sh
```

Requires `mongodump` (MongoDB Database Tools). Produces `shop-<UTC stamp>.archive.gz`, a `.sha256` checksum and a `.manifest.json` (per-collection counts and content fingerprints). Run it from a scheduler (cron/systemd timer) on a host that is not the database host, copy archives off-site and encrypt them at rest (archives contain personal data: treat them like the database).

## Restoring (drill and real)

Always restore **into a scratch database first**:

```bash
ARCHIVE=/var/backups/shop/shop-20261024T122915Z.archive.gz \
SOURCE_DB=shop TARGET_DB=shop_restore_check \
RESTORE_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0' ./scripts/restore-mongo.sh

MONGO_URI='mongodb://127.0.0.1:27017/shop_restore_check?replicaSet=rs0' \
  node scripts/verify-restore.mjs compare --manifest "$ARCHIVE.manifest.json"
```

`restore-mongo.sh` verifies the checksum, refuses `TARGET_DB == SOURCE_DB` unless `I_UNDERSTAND_THIS_OVERWRITES=yes`, and uses `--drop` only on the target. To recover production: restore into a new cluster/database, run `compare`, run the application's readiness check against it, then switch `MONGO_URI`. Do **not** restore over the live database while the app is serving traffic.

After any restore, run `scripts/reconcile-pending-payments.mjs` once: orders that changed state at the provider after the backup was taken are corrected by verification, and paid orders are never marked failed without a definitive provider answer.

## What was actually verified

On 2026-10-24 a drill was run against a **disposable Docker MongoDB 7.0 replica set with synthetic data** (250 orders, 40 users, one unique index):

- `backup-mongo.sh` produced the archive, checksum and manifest.
- `restore-mongo.sh` restored into a different database name: "290 document(s) restored successfully. 0 document(s) failed", including the unique index.
- `verify-restore.mjs compare` reported "Restore verified: 2 collections match (counts and content fingerprints)".
- Negative test: after modifying one restored document, `compare` failed with "orders: content fingerprint differs" (exit 1).
- `restore-mongo.sh` refused a same-name restore.

**Not verified:** restore of a production-sized dataset (timing/RTO), restore from a managed provider (Atlas) snapshot, off-site transfer and encryption, scheduled execution, and the application running against a restored cluster. Do not describe backups as production-verified until your own drill against real infrastructure succeeds and the date is recorded here.

# Docker deployment (MIBA)

One image (`Dockerfile`) contains the API and the built storefront. `docker-compose.yml`
runs it with MongoDB, Redis, a payment-reconciliation worker and, optionally, Caddy
for automatic HTTPS.

| Service  | Image                | Purpose | Network |
| -------- | -------------------- | ------- | ------- |
| `mongo`  | `mongo:7.0`          | Single-node replica set `rs0` (transactions) with authentication and a keyFile | `backend` (internal) |
| `redis`  | `redis:7.2-alpine`   | Sessions, rate limits, locks. Password protected, AOF persistence | `backend` (internal) |
| `app`    | `miba-shop` (built)  | Express API + SPA on port 5000, serves uploaded images | `backend`, `edge` |
| `worker` | `miba-shop` (built)  | Calls `/api/payments/reconcile-pending` every 5 minutes (`scripts/reconcile-worker.mjs`) | `backend` |
| `caddy`  | `caddy:2-alpine`     | Profile `proxy`: TLS termination and reverse proxy for `$DOMAIN` | `edge` |

The `backend` network is `internal: true`: MongoDB and Redis have no host ports and
no route to the internet. Only `app` is published, bound to `127.0.0.1:5000` by default.

## Quick start (local trial)

```sh
./scripts/docker-gen-env.sh                 # writes .env with random secrets for http://localhost:5000
docker compose up -d --build
docker compose ps                           # wait until every service is "healthy"
open http://localhost:5000
```

The app runs with `NODE_ENV=production`, so cookies are `Secure`. Browsers accept them
on `http://localhost`, but not on other plain-HTTP hosts. Use the proxy profile (or
another TLS proxy) for any real hostname.

## Production on a server

1. Point the DNS `A`/`AAAA` records of your domain (and `www.`) at the server and open ports 80 and 443.
2. `./scripts/docker-gen-env.sh https://miba.example.ir`, then edit `.env`:
   `ZARINPAL_MERCHANT_ID`, `ZARINPAL_SANDBOX=false`, `IRT_CATALOG_PRICES_CONFIRMED=true`
   (once the catalogue prices are whole Toman), `ACME_EMAIL`, the e-mail settings (`RESEND_API_KEY`, `EMAIL_FROM`) and the public `VITE_*` storefront links.
3. `docker compose --profile proxy up -d --build`

Caddy forwards to `app:5000` as the single trusted hop (`TRUST_PROXY_HOPS=1`). If you
use your own reverse proxy instead, keep `APP_BIND=127.0.0.1` and proxy to it, and make
sure it sets `X-Forwarded-For` and `X-Forwarded-Proto`.

## First-time data

```sh
# Optional demo catalogue (categories and sample auto parts):
docker compose run --rm app node scripts/seed-miba.mjs

# Make the first administrator an owner. Register the account in the storefront first.
docker compose run --rm app node scripts/bootstrap-owner.mjs --email owner@example.com            # dry run
docker compose run --rm -e BACKUP_CONFIRMED=yes app node scripts/bootstrap-owner.mjs --email owner@example.com --apply
```

Wholesale customer accounts are created by an administrator in the admin panel. The
storefront has no public wholesale sign-up.

## Configuration

Every variable is documented in `.env.docker.example`. Compose builds the connection
strings itself from these variables:

- `MONGO_URI=mongodb://$MONGO_APP_USER:$MONGO_APP_PASSWORD@mongo:27017/$MONGO_APP_DB?replicaSet=rs0&authSource=$MONGO_APP_DB`
- `REDIS_URL=redis://default:$REDIS_PASSWORD@redis:6379/0`

Use hex or URL-safe database passwords (the generator does this). The `VITE_*`
variables and `PUBLIC_SITE_URL` are baked into the SPA at build time, so run
`docker compose build` again after changing them.

### MongoDB bootstrap

- `docker/mongo/entrypoint.sh` generates a random keyFile in the `mongo-config`
  volume on first start and wraps the official entrypoint.
- `docker/mongo/init-app-user.sh` runs once on an empty volume. It creates
  `$MONGO_APP_USER` with `readWrite` on `$MONGO_APP_DB` only. The root account is
  used only by the healthcheck and by operators.
- `docker/mongo/healthcheck.sh` runs `rs.initiate` once if needed, and reports
  healthy only when the node is the writable primary. `app` waits for that.

Changing `MONGO_*_PASSWORD` in `.env` after the first start does **not** update the
database users. Change them with `mongosh` too, or recreate the volume.

## Hardening built in

- The app and worker run as the non-root `node` user, with a read-only root filesystem,
  a `/tmp` tmpfs, `cap_drop: ALL`, `no-new-privileges` and an init process.
- Only the `uploads` volume (`/app/data/uploads`) is writable.
- Healthchecks: the app checks `GET /api/health`, MongoDB checks for a writable primary
  and Redis checks `PING`. Detailed `/api/ready` output needs the `x-readiness-token` header.
- Logs use JSON files with rotation (10 MB × 5).

## Operations

```sh
docker compose logs -f app worker
docker compose pull && docker compose up -d --build     # upgrade
docker compose exec mongo sh -c 'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db "$MONGO_APP_DB" --archive --gzip' > miba-$(date +%F).archive.gz
docker run --rm -v miba_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Restore a dump with `mongorestore --archive --gzip` the same way. See also
`backup-and-restore.md`. The named volumes are `miba_mongo-data`, `miba_mongo-config`,
`miba_redis-data`, `miba_uploads`, `miba_caddy-data` and `miba_caddy-config`.
`docker compose down` keeps them. Only `docker compose down -v` deletes data.

### Building behind a TLS-intercepting proxy

Pass the proxy's CA bundle as a build secret. It is never written to an image layer:

```sh
docker build --secret id=build_ca,src=/path/to/ca.crt -t miba-shop:latest .
```

# Deployment and recovery

## Prerequisites

- Node.js 22 (`.nvmrc`; engines `>=20.19 <23`), npm with the committed lockfiles (`npm ci`, `npm ci --prefix frontend`).
- MongoDB 7 **replica set** (checkout and access changes use transactions; a standalone server returns 503 for them).
- Redis 7 (sessions, rate limits, locks). Redis outage behaviour is below.
- Environment variables: see `.env.example`. In production the process **refuses to start** (`backend/server.js`) or serves 503 (`backend/api/index.js` on Vercel) when required configuration is missing or weak: `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` (>= 32 chars, different), `MONGO_URI`, `REDIS_URL`, `CLIENT_URL`, `RATE_LIMIT_KEY_SALT` (>= 16), `CRON_SECRET` (>= 32 when set); `ALLOW_INSECURE_COOKIES` and `ALLOW_DEV_ORIGINS` must not be enabled.

## First deployment of this remediation (existing store) - order matters

1. **Take a verified backup** (`docs/operations/backup-and-restore.md`) and note the commit being replaced.
2. Deploy the new code with `RATE_LIMIT_KEY_SALT` and `TRUST_PROXY_HOPS` set. All users are signed out once: tokens now carry type/audience/version claims and the refresh cookie is path-scoped.
3. Create the first owner **before** migrating administrators:
   `BACKUP_CONFIRMED=yes node scripts/bootstrap-owner.mjs --email owner@example.com --apply` (dry-run without `--apply`).
4. Dry-run the administrator migration, review, then apply:
   `node scripts/migrate-admin-permissions.mjs [--assign staff@example.com=fulfillment ...]`
   `BACKUP_CONFIRMED=yes node scripts/migrate-admin-permissions.mjs --apply --assign ...`
   Legacy administrators without explicit permissions **lose all access** until the owner assigns a role; `*` holders become `manager` (everything except access management). The script is idempotent.
5. Run the payment and inventory migrations listed in the remediation report, then `scripts/reconcile-pending-payments.mjs`.
6. Smoke test: login, add to cart, sandbox checkout (`ZARINPAL_SANDBOX=true` in a staging environment), admin tabs per role.

Rollback: redeploy the previous build. The migrations are additive (new fields), but previous code treats administrators with explicit `permissions` correctly and has no knowledge of `isOwner`; do not roll back after relying on the owner tier without restoring the pre-migration backup.

## Failure behaviour (designed)

| Failure | Behaviour |
|---|---|
| Redis down | Login/signup/refresh/recovery return **503 (fail closed)**: they cannot complete without session storage and a per-process counter would multiply an attacker's budget. Browsing is unaffected; general API limiter degrades to per-instance counting and logs `rate_limit_degraded`. Payment reconciliation continues (the lock is only an overlap guard). |
| MongoDB down | `/api/*` returns 503 "Service temporarily unavailable"; `/api/health` stays 200 (liveness), `/api/ready` reports 503. |
| Zarinpal timeout / 5xx / unknown code | The order stays reserved and is re-verified by the reconciler; it is never marked failed or paid on an ambiguous answer. |
| Duplicate / replayed callback | Idempotent: one finalisation; replays are no-ops. |
| SIGTERM (self-hosted) | Server stops accepting, drains in-flight requests, closes MongoDB and Redis; hard exit after 15 s. |

## Monitoring and logs

- Structured JSON lines (`level`, `event`, ...) with `X-Request-Id` correlation; query strings and bodies are never logged. Alert on events: `config_error`, `rate_limit_degraded`, `unhandled_api_error`, `auth.refresh_token_reuse`, `startup_failed`, and on the reconcile workflow turning red.
- Uptime probes: `GET /api/health` (liveness). `GET /api/ready` for dependency state.
- Audit log (`admin` actions, PII exports, access changes with before/after) has no automatic expiry: define a retention period and purge by `createdAt` according to your privacy policy.

## Scheduled jobs

Payment reconciliation: GitHub Actions cron every 5 minutes is best-effort and can be delayed or disabled after repository inactivity. Add a second trigger (Vercel Cron or a system cron running `scripts/reconcile-pending-payments.mjs`) and alert when the endpoint has not succeeded for 15 minutes.

## Not verified in this remediation

Vercel deployment and rewrite/IP behaviour, real Zarinpal sandbox/production traffic, Cloudinary and Resend integrations, load/capacity, and restore at production scale. Verify each in staging before launch.

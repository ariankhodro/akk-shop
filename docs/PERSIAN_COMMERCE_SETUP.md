# Persian commerce setup and Iranian-host deployment

This guide configures the storefront for **Toman (IRT) only** and Zarinpal checkout. The application does not provide alternate payment providers or currency switching.

## 1. Currency and catalogue migration

Product prices and shipping settings are numeric values; the database does not attach a separate currency to each product. Changing a label or environment variable does not convert stored values.

Before enabling checkout on an existing database:

1. Take a verified MongoDB backup and define a rollback plan.
2. Prepare an approved, whole-Toman retail price for every sellable product. Update each product from that price list; do not apply an assumed exchange rate automatically.
3. Set `StoreSettings.flatRate` and `StoreSettings.freeShippingThreshold` to verified whole-Toman amounts.
4. Review existing carts and ask customers to refresh them after catalogue migration.
5. Keep `IRT_CATALOG_PRICES_CONFIRMED=false` until the catalogue and shipping values are reviewed. Set it to `true` only after verification.
6. Preserve historical order records and their recorded amounts. Records without explicit IRT/Zarinpal metadata are excluded from active order history until they have been reconciled; do not convert amounts automatically.

New product prices and shipping fees are validated as whole numbers. Zarinpal's API amount is supplied in Rial, so checkout converts the verified Toman amount to Rial by multiplying by 10.

## 2. Backend environment

Configure these variables on the backend host. Store secrets in the host's protected environment/secret manager, not in source control.

```dotenv
NODE_ENV=production
PORT=5000
MONGO_URI=your_mongodb_connection_string
REDIS_URL=redis://your-private-redis-host:6379
ACCESS_TOKEN_SECRET=replace_with_a_long_random_secret
REFRESH_TOKEN_SECRET=replace_with_a_different_long_random_secret
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
ZARINPAL_MERCHANT_ID=your_merchant_id
ZARINPAL_SANDBOX=true
IRT_CATALOG_PRICES_CONFIRMED=false
API_URL=https://api.example.ir
CLIENT_URL=https://store.example.ir
DEFAULT_SHIPPING_FEE=0
FREE_SHIPPING_THRESHOLD=0
CRON_SECRET=replace_with_a_random_secret_of_at_least_32_characters
```

Use your actual domain names and connection strings. Set `API_URL` to the backend origin without a trailing `/api`; set `CLIENT_URL` to the frontend origin. The payment callback is built from `API_URL` and must be reachable over HTTPS by the gateway. Keep sandbox mode enabled until real end-to-end tests have passed.

The application supports `REDIS_URL` for a private Redis service. The older `UPSTASH_REDIS_URL` variable is still accepted for compatibility, but Redis-backed distributed rate limiting should be configured and monitored in production.

## 3. Frontend configuration

Set `VITE_API_URL` at frontend build time if the API is not served under the same origin:

```dotenv
VITE_API_URL=https://api.example.ir/api
```

If a reverse proxy exposes the backend under the same origin at `/api`, the frontend's default `/api` base URL can be used. The currency is fixed to IRT/Toman; no currency override is needed.

## 4. Deploying to an Iranian host

A typical self-hosted deployment has a Node.js backend service, MongoDB, a private Redis instance, and a frontend build served through Nginx or the hosting panel's static-site service.

1. Install a supported Node.js version and install the root and frontend dependencies using their lockfiles.
2. Use MongoDB configured as a replica set (or a managed deployment that supports transactions) for production. The inventory release path is atomic when transactions are supported; the standalone compatibility fallback is not an equivalent production safety guarantee.
3. Configure the backend environment and run the backend with `npm start` from the backend application directory (or use a process manager such as systemd/PM2 to keep it running).
4. Build the frontend with `npm run build --prefix frontend` and publish `frontend/dist` through your static-site service.
5. Configure the reverse proxy for `/api` to the backend and ensure cookies/HTTPS are handled correctly.
6. Confirm the backend domain is publicly reachable for the payment callback.
7. Back up the database and complete the order-index migration before live checkout.
8. Keep secrets server-side and restrict MongoDB/Redis network access to the application and administration hosts.

The repository still contains optional Vercel configuration for deployments that use Vercel. Those files do not configure cron jobs on an Iranian VPS, control panel, or other hosting provider.

## 5. Frequent payment reconciliation (required on every host)

**Reconciliation must run about every five minutes in production.** The payment callback can be missed, provider responses can time out, and successful payments can need finalization recovery.

The endpoint is:

```text
GET /api/payments/reconcile-pending
Authorization: Bearer <CRON_SECRET>
```

### Vercel deployment using GitHub Actions

The repository uses `.github/workflows/reconcile-payments.yml` as its default five-minute scheduler. The backend's `vercel.json` intentionally does not configure Vercel Cron: Vercel Hobby plans support only daily schedules, which is not frequent enough for payment reconciliation. Pro/Enterprise Vercel Cron is an alternative if preferred; do not enable both schedules without accounting for duplicate invocations.

Configure these **GitHub Actions repository secrets** at **Settings → Secrets and variables → Actions**:

- `PAYMENTS_API_URL`: the backend's public HTTPS origin, without a trailing slash or `/api` suffix (for example, `https://your-api.example.ir`).
- `CRON_SECRET`: the same long random secret configured for the backend's `CRON_SECRET`.

The workflow calls the endpoint every five minutes and also supports manual execution through `workflow_dispatch`. It fails when the endpoint returns a non-200 response or a result whose `success` field is not `true`. Review the Actions run history and logs after configuration. GitHub scheduled workflows are best-effort and can be delayed; if reconciliation has a strict timing objective, use a managed scheduler with a suitable service-level guarantee.

Do not put `CRON_SECRET` into repository files, workflow text, query parameters, or command-line arguments. The workflow sends it in the Authorization header.

### Self-hosted scheduler alternative

For an Iranian VPS or another host, use a Linux cron job, systemd timer, or hosting-provider scheduler instead. If using this option, disable the GitHub Actions schedule to avoid duplicate routine invocations. A five-minute interval is the starting target; verify runtime, volume, and backlog behavior before production.

The repository includes `scripts/reconcile-pending-payments.mjs`. Put these values in a root-owned environment file such as `/etc/mern-ecommerce/reconcile.env`, readable only by the service administrator:

```dotenv
API_URL=https://api.example.ir
CRON_SECRET=the_same_long_random_secret_configured_for_the_backend
```

Then add a cron entry after replacing paths for your server:

```cron
*/5 * * * * set -a; . /etc/mern-ecommerce/reconcile.env; set +a; /usr/bin/node /var/www/mern-ecommerce/scripts/reconcile-pending-payments.mjs >> /var/log/mern-ecommerce-reconciliation.log 2>&1
```

Secure the environment file (for example, owner root and mode `0600`), rotate the log with suitable permissions, and monitor non-zero job exits and unresolved orders. The scheduler is not embedded in the Express process; deploying the API alone does not start a self-hosted scheduler.

The reconciliation endpoint uses a Redis distributed lock, bounded batches, and persisted retry/backoff state to prevent overlapping runs and avoid letting repeatedly failing records starve newer work. Confirm that the scheduler is running and that unresolved payment counts actually decrease after a sandbox recovery scenario.
 
## 6. Existing order index and payment metadata migration

On a database used by an earlier checkout implementation, the orders collection may still contain an obsolete unique index and provider-specific metadata. Those remnants can block inserts or cause old amounts to be misrepresented after the application has switched to its single IRT/Zarinpal policy.

**Take a verified backup first.** Review the target database name and `MONGO_URI`, then run the guarded migration from the repository root:

```bash
node scripts/migrate-orders-to-zarinpal-only.mjs
```

The migration inspects indexes that reference the obsolete checkout-session field. It removes only the expected single-field index; it aborts if it encounters an unexpected index definition so that it does not guess at schema changes. It clears stale checkout-session/provider/currency metadata but preserves order documents, item snapshots, statuses, and numeric amount fields. It does not perform a currency conversion.

Records that do not explicitly match `paymentProvider: "zarinpal"` and `currency: "IRT"` remain in the database but are excluded from active order history and current revenue/fulfillment metrics. Reconcile any such records separately using verified business records instead of assuming their amounts use the current store currency. Review the script output and run `db.orders.getIndexes()` after migration.

## 7. Verification checklist

- [ ] Backup and restore procedure tested.
- [ ] Product catalogue and shipping settings contain correct whole-Toman amounts.
- [ ] `IRT_CATALOG_PRICES_CONFIRMED=true` only after price review.
- [ ] Zarinpal sandbox request, redirect, callback, cancel, and verify flows tested.
- [ ] Duplicate callbacks do not finalize an order twice.
- [ ] Gateway timeouts leave uncertain orders pending; inventory is not released prematurely.
- [ ] Expired orders without a usable authority eventually expire and restore reserved inventory.
- [ ] Reconciliation job runs on schedule and its logs/exit status are monitored.
- [ ] Backend and frontend production builds pass from the current branch.
- [ ] Database and Redis are not exposed publicly; all production secrets are protected.

## Persian-aware search normalization

The backend normalizes Persian/Arabic ya and kaf variants, Arabic/Persian digits, tatweel, common diacritics, zero-width marks, Unicode compatibility forms, punctuation, and whitespace. Every product save maintains a normalized `searchTextNormalized` field so a normalized query can match normalized product text independent of the input digit script or common character variants.

Before deploying this schema change to an existing catalogue, take a database backup and run the one-time backfill from the repository root:

```bash
node scripts/backfill-persian-search.mjs
```

The migration works in batches. It only populates the derived search field and does not alter displayed product names, descriptions, categories, prices, or inventory. Re-run it after importing legacy catalogue data if those products were inserted outside the application.

## Iranian delivery addresses, shipment tracking and admin operations

New checkout requests must submit a validated delivery address: recipient name, Iranian mobile number, province, city, full address, and 10-digit postal code. Persian/Arabic digits are normalized to Western digits for phone and postal-code validation. The address is saved to the order as a snapshot; editing later customer profile data does not change an existing order. Historical orders can have no delivery address because those fields were introduced after they were created.

Customer endpoints:
- `GET /api/orders/mine?page=1&limit=10` lists only the authenticated customer's orders and shipment history.
- Admin shipment queue: `GET /api/orders/admin?page=1&limit=25`, optionally filtering with `shipmentStatus`.
- Admin shipment update: `PATCH /api/orders/:id/shipment` with `status`, `shippingCarrier`, `trackingCode`, and optional `note`.

Shipment transitions are kept in order: processing → packed → shipped → delivered → returned. The backend requires a carrier and tracking code when moving an order to shipped and records a timestamped shipment event. Customers can see the order's saved address, current shipment status, tracking details, and shipment event history on `/orders`. Only paid orders are eligible for admin shipment updates.

The admin dashboard also exposes:
- `GET /api/admin/audit-logs` for paginated administrator action history.
- `GET /api/admin/operations` for live database/Redis reachability and operational counts for pending payments, unfinished finalization, shipments waiting, shipment records missing a tracking code, failed payments in the last 24 hours, and audit events.

Audit entries are written for product creation/deletion and inventory changes, featured-product changes, campaign mutations, shipping-setting updates, and shipment/tracking changes. They intentionally exclude payment secrets and customer address content. Audit writes fail independently of successful business operations; monitor server logs for any audit-write errors.

The operations dashboard is an application-level snapshot, not an external alerting system. Configure host-level monitoring/alerts separately for latency, error rates, CPU/RAM, disk capacity, database capacity, TLS/domain expiry, and job failures.

## Explicit API headers, origin checks and CSRF defense

The API sets explicit headers for content-type sniffing, clickjacking, referrer handling, browser permissions, cross-domain policy, and a restrictive API Content Security Policy. HSTS is emitted only when production requests are identified as HTTPS. Configure Nginx/Caddy to forward the original scheme from the trusted proxy.

Set CLIENT_URL to the public storefront origin. For credentialed direct API requests from more than one frontend, configure CORS_ALLOWED_ORIGINS as a comma-separated list of exact origins, for example https://store.example.ir,https://admin.example.ir. Wildcard origins are intentionally not supported. Local Vite origins are allowed only outside production.

State-changing requests with a foreign Origin are rejected; requests with no Origin are rejected when Fetch Metadata identifies them as cross-site. This supplements HttpOnly/SameSite cookies, but does not replace HTTPS or safe cookie/domain configuration.

## Inventory integrity and unknown-stock audit

Unknown stock is **not unlimited stock**. Checkout now rejects active products whose stock or any sellable variant stock is missing, null, nonnumeric, negative, fractional, or outside the safe-integer range. No migration guesses quantities or changes the catalogue automatically.

Before enabling checkout for an existing store, run the read-only inventory report from the repository root with a MongoDB account that has read access to the catalogue:

```bash
npm run audit:inventory
```

The report lists each affected product ID, product name/category, and every invalid variant stock field. Exit code `0` means no untracked inventory was found; exit code `2` means findings need review; exit code `1` means the audit could not run. The script never writes to MongoDB.

For each finding, an authorized catalogue operator must review the physical/contractual stock and set an explicit non-negative whole-number quantity, including `0` only when the item is actually unavailable. If the business truly requires unlimited stock, define and implement a separate explicit inventory mode before selling such products. Do not use a null or string-valued stock as a substitute.

## Inventory integration tests

Run `npm test --prefix backend`. Security header/origin tests do not require external services. Inventory integration tests require `MONGO_TEST_URI` to point at a dedicated disposable database whose name includes test. Concurrent reservation and partial rollback are tested with atomic MongoDB updates; duplicate-release and transaction-rollback tests require a MongoDB replica set or sharded deployment.

Never point `MONGO_TEST_URI` at production or a database containing real orders. Tests remove only records created by the tests, but the URI must still use a dedicated test database.

<div align="center">

<img src="frontend/public/miba-logo.svg" alt="MIBA" width="220" />

# MIBA · میبا

**فروشگاه تخصصی قطعات یدکی خودروهای چینی — خرده‌فروشی و عمده‌فروشی**

A Persian-first, right-to-left e-commerce platform for Chinese automotive spare parts
(Chery/MVM, JAC, Haval/Great Wall, Geely, BYD, Lifan, Brilliance, Dongfeng, …),
with a public retail storefront and a private wholesale channel for pre-approved partners.

</div>

> **Licensing:** `LICENSE` is GPL-2.0 while older metadata said MIT/ISC. Read
> [docs/legal/licensing-status.md](docs/legal/licensing-status.md) before redistributing.
> All images in `frontend/public/` are original SVGs created for MIBA.

## Features

### Retail storefront (public)
- Orange MIBA brand, fully Persian RTL, responsive, light and dark themes, self-hosted Vazirmatn font.
- **Fitment finder**: pick make → model → year and see compatible parts.
- Search by part name, **SKU or OEM part number** (with or without dashes or spaces), car make or model.
- Filters for vehicle, part brand, quality (genuine, OEM, aftermarket, used), stock and price.
- Product pages show the part number, OEM numbers, brand, quality, origin, warranty and a compatible-vehicles table.
- Cart, Zarinpal checkout in whole Toman (IRT), order history and shipment tracking.

### Wholesale (pre-created accounts only)
- **There is no public wholesale signup.** Public signup always creates a retail account, and the server ignores `accountType`, `role` and `wholesaleProfile` in the request.
- Staff with the `wholesale.manage` permission create partner accounts in the admin panel. Each account has a company profile, an optional personal discount (0–50%) and a temporary password that the partner must change at first login.
- Signed-in partners see their own wholesale unit price on listings, product pages and the cart. A product's wholesale price applies from its minimum quantity; below that quantity the retail price applies.
- Partners can order up to 1,000 units per line (retail: 100). A quick-order page accepts part numbers and quantities.
- Every price is computed **on the server** (`backend/lib/pricing.js`). The raw catalogue wholesale price is never sent to any browser. Coupons do not stack on wholesale prices.
- Changing a partner's tier, discount or active status revokes their sessions immediately.

### Admin
- Products: auto-part identity (SKU, OEM numbers, brand, quality, origin, warranty), vehicle fitments, retail and wholesale prices, minimum wholesale quantity, images and stock.
- Categories, inventory alerts, orders and fulfilment (wholesale orders are tagged), coupons, campaigns, shipping, analytics, newsletter, service requests and an audit log.
- Customers: retail and wholesale accounts, wholesale terms, temporary passwords, activation.
- Access control is deny-by-default, with an owner tier and role presets (manager, catalogue editor, fulfilment, support, **sales**, marketing, analyst). See [docs/security/permission-matrix.md](docs/security/permission-matrix.md).

### Security
- HTTP-only, SameSite=Strict, Secure cookies; short-lived access tokens; rotating refresh tokens stored as digests in Redis; token-version revocation.
- Strict input readers (no operator injection), password policy, rate limits that fail closed on authentication endpoints, and audited admin actions.
- Server-side pricing, coupon and inventory checks inside a MongoDB transaction; idempotent Zarinpal verification and reconciliation.
- Strict CSP (scripts and fonts only from `'self'`), CORS limited to exact origins, Fetch-Metadata and origin checks.
- Images are validated by signature and dimensions, stored in Cloudinary or on a local volume (`MEDIA_STORAGE=local`), and served with `nosniff` and a sandboxed CSP.

## Quick start with Docker (recommended)

```bash
./scripts/docker-gen-env.sh http://localhost:5000   # writes .env with random secrets
docker compose up -d --build                         # mongo (replica set + auth), redis, app, worker
docker compose run --rm app node scripts/seed-miba.mjs --demo-products
```

Open <http://localhost:5000>. To create the first owner, register through the storefront, then run:

```bash
docker compose run --rm -e BACKUP_CONFIRMED=yes app node scripts/bootstrap-owner.mjs --email you@example.com --apply
```

For production behind HTTPS with Caddy (automatic certificates):

```bash
./scripts/docker-gen-env.sh https://miba.example.ir
docker compose --profile proxy up -d --build
```

Full guide, including hardening, backups and upgrades: [docs/operations/docker.md](docs/operations/docker.md).

| Service | Role |
| --- | --- |
| `mongo` | MongoDB 7 single-node replica set (needed for transactions), keyFile + users, persistent volumes |
| `redis` | Sessions, rate limits and locks; password-protected, AOF persistence |
| `app` | API + built SPA, non-root, read-only root filesystem, health-checked |
| `worker` | Payment reconciliation every 5 minutes |
| `caddy` | Optional (`--profile proxy`): TLS termination and reverse proxy |

Databases are reachable only on an internal network and are never published on the host.

## Local development

Requires Node.js 20.19+ (22 recommended), a MongoDB **replica set** and Redis.

```bash
npm ci && npm ci --prefix frontend
cp .env.example .env            # fill in the values; for local HTTP add ALLOW_INSECURE_COOKIES=true ALLOW_DEV_ORIGINS=true and NODE_ENV=development
npm run seed -- --demo-products
npm run dev:all                 # API on :5000 + Vite on :5173
```

## Environment

All backend variables are documented in [.env.example](.env.example) (bare metal) and
[.env.docker.example](.env.docker.example) (Compose). Production refuses to start
with missing or weak secrets (`backend/lib/config.js`). Important switches:

| Variable | Purpose |
| --- | --- |
| `IRT_CATALOG_PRICES_CONFIRMED` | Checkout stays disabled until set to `true` after the catalogue prices have been verified in whole Toman. |
| `ZARINPAL_MERCHANT_ID`, `ZARINPAL_SANDBOX` | Payment gateway settings. |
| `MEDIA_STORAGE` | `local` (uploads volume) or `cloudinary`. |
| `CLIENT_URL`, `API_URL`, `APP_URL`, `PUBLIC_SITE_URL` | Public origin(s); never derived from request headers. |
| `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the app. |

## API highlights

All routes are under `/api`. Personalised product responses are sent with `Cache-Control: private, no-store`.

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/products/search` | Public, viewer-priced | `q` (also part numbers), `category`, `make`, `model`, `year`, `partBrand`, `quality`, `inStock`, price range, sort |
| `GET` | `/products/category/:slug` | Public, viewer-priced | Category listing with facets (makes, brands, qualities) |
| `GET` | `/products/vehicles` | Public | Makes and models that have parts (fitment finder) |
| `GET` | `/products/lookup?codes=` | Public, viewer-priced | Resolve SKU/OEM numbers (quick order) |
| `GET` | `/products/:id` | Public, viewer-priced | Product details |
| `POST` | `/auth/signup` | Public | Retail accounts only |
| `POST` | `/auth/change-password` | Authenticated | Change the password; required after a temporary one |
| `GET/POST/PUT/DELETE` | `/cart` | Authenticated | Cart with server-computed unit prices |
| `POST` | `/payments/create-checkout` | Authenticated | Server-priced Zarinpal checkout |
| `GET` | `/orders/mine` | Authenticated | Order history and shipment tracking |
| `POST` | `/admin/customers` | `wholesale.manage` | Create a pre-approved (wholesale) customer account |
| `PATCH` | `/admin/customers/:id/wholesale` | `wholesale.manage` | Edit wholesale terms or activation |
| `POST` | `/admin/customers/:id/password` | `wholesale.manage` | Issue a temporary password |

The full route list is in `backend/routes/`, and the admin permission table is in `backend/middleware/auth.middleware.js`.

## Testing

```bash
# Disposable MongoDB replica set + Redis (as in CI):
docker run -d --name mongo-test -p 27017:27017 mongo:7.0 --replSet rs0 --bind_ip_all
docker exec mongo-test mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
docker run -d --name redis-test -p 6379:6379 redis:7.2-alpine

MONGO_TEST_URI='mongodb://127.0.0.1:27017/shop_test?replicaSet=rs0' REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
npm run lint --prefix frontend && npm test --prefix frontend && npm run build --prefix frontend
MONGO_E2E_URI='mongodb://127.0.0.1:27017/shop_e2e_test?replicaSet=rs0' REDIS_E2E_URL=redis://127.0.0.1:6379/3 node e2e/run.mjs
```

## Project layout

```text
backend/    Express API: controllers, models, lib (pricing, part fields, rbac, payments), middleware, tests
frontend/   React + Vite + Tailwind storefront and admin panel (Zustand stores)
api/, seo/  Server-rendered share previews, sitemap and robots (Vercel functions)
docker/     Mongo entrypoint/healthcheck/user init, Caddyfile
scripts/    Seed, owner bootstrap, migrations, reconciliation worker, backups
docs/       Security, operations and audit documentation
```

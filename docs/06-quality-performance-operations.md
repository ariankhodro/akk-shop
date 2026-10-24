# 06 — Code quality, performance, infrastructure and operations

Legend: VERIFIED = from files/commands in report 09; POTENTIAL = needs a live environment.

## 1. Code quality
| # | Finding | Status |
|---|---|---|
| Q-1 | **Lint fails: 23 errors, 2 warnings** (`npx eslint .`, frontend). 16 are a config gap (no Node globals for `tests/`), 7 are real unused variables/empty block/regex issues. Lint is not run in CI, so it cannot gate merges. | VERIFIED |
| Q-2 | **Test coverage is uneven.** Strong unit tests on pure logic (coupons, inventory, reconciliation helpers, permissions, refresh tokens, password policy, security middleware). **No** tests for the auth/product/category/campaign/cart/newsletter controllers, the checkout/verify/reconcile endpoints, `finalizePaidOrder`, any React component, the cart store, Jalali/commerce helpers. The 10 concurrency tests exist but are skipped in the main CI (no Mongo). | VERIFIED |
| Q-3 | `backend` `build` script is a hand‑maintained list of ~60 `node --check` calls and a *subset* of tests; new files silently drop out of it. | VERIFIED |
| Q-4 | Large multi‑responsibility files: `product.controller.js` 1141 lines, `zarinpal.controller.js` 931, `Navbar.jsx` 1363, `CategoryPage.jsx` 916. Admin pages use dense single‑line JSX (`AdminPage.jsx`, `CustomerManagement.jsx`). No schema‑validation library; validation is hand‑rolled per controller. | VERIFIED |
| Q-5 | Duplicated logic: Persian digit/character normalisation ×4 (FE‑25), fashion category slugs in ~10 places, permission lists in 3 places (rules table, UI tab map, schema enum), two `package.json` dependency lists for the backend. | VERIFIED |
| Q-6 | Dead code/assets: unused `formatIranianTime`, `vite.svg`, `screenshot-for-readme.png`, leftover developer copy in the footer (FE‑19, FE‑32). | VERIFIED (per reviewer) |
| Q-7 | `console.*` used 112 times in backend (non‑test) code; no structured logger, no request IDs in logs (audit log has one). | VERIFIED |

## 2. Performance
- Frontend build (VERIFIED): `dist` 5.7 MB; main chunk 323 kB (102 kB gzip); `AnalyticsTab` (recharts) 379 kB / 106 kB gzip but lazy; framer‑motion chunk 110 kB. Reasonable for an SPA; routes and admin tabs are lazy.
- **Images**: category photos are 0.13–1.76 MB originals in `public/` (shoes.jpg 1.7 MB), no `srcset`/`width`/`height`; product images come from Cloudinary but are requested without a transformation pipeline in the reviewed components (FE‑12).
- **Render‑blocking Google Fonts `@import`** (FE‑5) — also an availability risk from Iran.
- **Re-render hotspots**: whole‑store Zustand subscriptions in every `ProductCard` (FE‑6); **duplicate requests** (e.g., `GET /categories`) (FE‑7); boot blocked on `/auth/profile` + 3 failing calls for anonymous visitors (FE‑2); refresh unmounts the whole app (FE‑1).
- Backend (POTENTIAL, not load tested): per‑request `User.findById` in `protectRoute`; unbounded‑ish public queries and per‑slug cache keys (SEC‑8/13); `/api/ready` does a DB probe on every call and is public (SEC‑11); reconciliation throughput capped at 5 orders per phase per 5‑minute run (BIZ‑9) — about 60 orders/hour.
- Serverless: Mongo pool max 5 per instance (configurable ≤20) – OK for Vercel; checkout transaction retries may exceed the 60 s function limit (BIZ‑12, POTENTIAL).
- Scaling bottlenecks: Redis (rate limit, refresh tokens, locks) and Mongo replica set; the app is otherwise stateless.

## 3. Infrastructure and deployment (Phase 7)
| Area | Finding | Status |
|---|---|---|
| Containers / IaC | **No Dockerfile, compose file, Procfile, process‑manager config or IaC** in the repo. Deployment is Vercel‑only (`vercel.json`, `backend/vercel.json`); the "self‑hosted" path in docs relies on cron + env file by hand. | VERIFIED |
| Environment config | Variables are documented only in README/docs; the repo has **no root/backend `.env.example`** (only `frontend/.env.example`). No startup validation of required variables or of secret strength; wrong `NODE_ENV` silently drops the Secure cookie flag and adds localhost origins (SEC‑14, AUTH‑10). | VERIFIED |
| Secure defaults | Good API headers and CORS; **no headers at all on the storefront HTML** (SEC‑2); no admin MFA. | VERIFIED |
| Health checks | `/api/health` (liveness) and `/api/ready` (DB+Redis) exist and behaved correctly in my runtime probe (503 without DB). `/ready` is public and heavy (SEC‑11). | VERIFIED |
| Graceful shutdown | **None**: `backend/server.js` has no SIGTERM/SIGINT handler, does not close the HTTP server, Mongo or Redis. Irrelevant on Vercel; a gap for any VM/container deployment. | VERIFIED |
| Process supervision | None provided (relies on host). | VERIFIED |
| Logging / monitoring | Plain `console` logs; no log levels, correlation IDs, metrics, tracing or error‑tracking integration; no alerting except "GitHub Actions job fails". Incident diagnosis relies on Vercel logs + the Mongo audit log (no TTL, unbounded). | VERIFIED |
| Scheduled jobs | Payment reconciliation is triggered by a **GitHub Actions cron every 5 minutes** against a public URL with a bearer secret (fail‑closed if secret unset; `timingSafeEqual`). GitHub scheduled runs are best‑effort, can be delayed, and are disabled after inactivity on public repos (a general GitHub behaviour; not verified for this repo). The curl step has a 55 s timeout vs a 60 s function limit. | VERIFIED config / POTENTIAL behaviour |
| CI/CD | Two workflows run tests+build; **no lint, no `npm audit`, no Dependabot, no CodeQL, no deploy workflow**; Node versions differ (20 vs 22); main CI skips integration tests. Third‑party actions are pinned by tag (`@v4`), not SHA. Workflow permissions are least‑privilege (`contents: read`) — good. | VERIFIED |
| Backups / restore | Docs say "take a verified backup and define a rollback plan" (README:242,286; docs/PERSIAN_COMMERCE_SETUP.md:11,134) but **provide no procedure, schedule, retention or restore test**. Orders/payments/stock live in Mongo, so this is a production blocker for a real store. | VERIFIED (absence) |
| Redis persistence | Redis holds refresh tokens, rate‑limit counters, locks, caches. Loss = all users logged out and temporary rate‑limit reset; no data of record. Docs recommend a private Redis but state no persistence requirement. Checkout correctness does not depend on Redis, but reconciliation endpoint fails 503 when Redis is down (BIZ‑10). | VERIFIED |
| Rollback / recovery | Vercel instant rollback is available in principle, but DB migrations (`scripts/migrate-*.mjs`) are one‑way and guarded only by "take a backup"; no down‑migrations. | VERIFIED |
| Resource sizing | Not documented. Needs a MongoDB **replica set** (transactions) — standalone Mongo returns 503 at checkout (documented, BIZ‑12). | VERIFIED |
| Setup/maintenance docs | README, `docs/PERSIAN_COMMERCE_SETUP.md`, `password-recovery.md`, `seo-share-previews.md` are detailed and honest about limits (e.g., refunds are bookkeeping only). Missing: runbooks for incident response, key rotation, restore, admin recovery. | VERIFIED |

## 4. Operational risks to close before launch
1. Payment recovery must demonstrably work (fix BIZ‑1/2/3, then test in Zarinpal sandbox) and must be monitored (alert if the cron fails or the stranded count grows).
2. A tested backup/restore of MongoDB.
3. Startup validation + `.env.example` for backend; security headers for the storefront; auth rate limiting that does not fail open.
4. Error tracking/uptime monitoring and structured logs.

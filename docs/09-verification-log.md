# 09 — Verification log

Everything here was actually executed unless stated otherwise. Dates are from the sandbox clock (2026-10-24).

## Environment
- Sandbox: Linux, Node v22.22.0, npm 10.9.4. No MongoDB, no Docker daemon. `redis-server` available (used on port 6390 for runtime probes, then shut down).
- The repo was **not modified**. Installs/builds ran in a **separate copy** (`scratchpad/run/repo`). The original clone (`/home/user/itswanheda/mern-ecommerce`) has 0 dirty files (`git status --short | wc -l` = 0) at the end of the audit.
- Reports live in `scratchpad/audit/`; raw logs in `scratchpad/audit/_verify/`; per-area working notes in `_parts/`.

## Phase 1 — repository
| Item | Result |
|---|---|
| Remote | https://github.com/ItsWanheda/mern-ecommerce, branch `master` |
| HEAD | `e9993b8c8e4af29a4cf5fd3cbc7c9b461a71284d` (2026-10-23, "Feat/UI ux smoothing") |
| History | Initial clone `--depth 1`; in the working copy I fetched `--depth=2000`: **729 commits**, first 2024-08-28. Authors: ItsWanheda 725, "Burak"/"Burak Orkmez" 4 (indicates a fork/derivative of a public tutorial project — upstream not verified, no API access) |
| Files | 191 tracked files (~47k lines incl. lockfiles/assets) |
| Working tree | clean |

## Phase 2 — commands executed and real results
| # | Command (in copy) | Result |
|---|---|---|
| 1 | `npm ci` (root) | exit 0, 146 packages. Deprecation warning: `q@1.5.1` (transitive). `npm audit` summary at install: 16 vulnerabilities |
| 2 | `npm ci --prefix frontend` | exit 0. 28 vulnerabilities reported |
| 3 | `npm test` (root → `backend: node --test tests/*.test.js`) | **63 tests: 53 pass, 0 fail, 10 skipped** (the 10 are the Mongo-backed integration tests: coupon reservation ×3, inventory recovery ×7; skipped because `MONGO_TEST_URI` is unset). Log: `_verify/backend-test.log` |
| 4 | `npm run build --prefix backend` (syntax checks + subset of tests) | exit 0; 46 tests pass. Note: this script runs only a hand-maintained subset (omits `security.middleware.test.js`, `commerce-currency.test.js`, both integration tests) |
| 5 | `npm test --prefix frontend` | exit 0; **23 tests pass** (refresh-flow, user-error-message, seo-utils, seo-handlers) |
| 6 | `npx eslint .` (frontend) | **exit 1: 25 problems (23 errors, 2 warnings)**. 16 errors are `'process' is not defined` in `frontend/tests/*.test.js` (eslint config lacks Node globals for tests); the rest are unused vars (`ArrowLeft`, `toast`, `escapeHtml`, `canonicalUrlFor`, `user`), one `no-empty`, one `no-misleading-character-class` (StoreInfoPage/CollectionPage). Lint is **not** part of CI |
| 7 | `npm run build --prefix frontend` (runs frontend tests, then `vite build`) | exit 0, built in 6.1 s; `dist` 5.7 MB / 65 files. Largest JS: `AnalyticsTab` 379 kB (106 kB gzip, lazy), `index` 323 kB (102 kB gzip), `motion` 110 kB (36 kB gzip). One CSS file 79 kB |
| 8 | `npm audit --json` root and frontend | Root: 16 (2 critical, 9 high, 1 moderate, 4 low). Frontend: 28 (1 critical, 18 high, 8 moderate, 1 low). `--omit=dev`: root 13, frontend 9. Details in report 07. Advisory data is as of the sandbox's registry response at run time |
| 9 | Dependency license scan (own script over installed `node_modules` `package.json` fields) | No copyleft in installed dependencies; see report 07 |
| 10 | Secret scan of full 729-commit history (regex for DB URIs with passwords, `sk_live`, AWS keys, Resend keys, private keys, Cloudinary URLs, UUIDs) + HEAD assignment scan | No secrets found; only a test fixture string with a fake `redis://username:...@example.invalid`. Only tracked env-like file ever: `frontend/.env.example`. Pattern-based, so not proof of absence |
| 11 | Mongoose cast check (`node castcheck.mjs`, no DB) of `User.findOne({email: <operator object>})` | `{ $ne: null }`, `{ $gt: "" }`, `{ $regex: ... }` all **cast without error** → confirms operator objects reach the query (SEC-1/AUTH-1) |
| 12 | Node snippet reproducing object-spread semantics of `{ $or: [..], ...due }` where `due = { $or: [..] }` | Confirms the later `$or` replaces the earlier one (BIZ-3); the controller code at `zarinpal.controller.js:775-783` and `lib/payment-reconciliation.js:17-23` were read to confirm the same shape |
| 13 | Node snippet `"marine".replace(/[\\r\\n]/g,"_")` | Output `ma_i_e`: confirms the regex typo in `api/share-preview.js:402,488` strips the letters r and n instead of CR/LF |

## Runtime probes (no database)
Harness loaded `backend/app.js` with **dummy env values only**, a local Redis on :6390 and an unreachable Mongo URI; `curl` against localhost. Log: `_verify/runtime-probes.log`.
| Probe | Observed |
|---|---|
| `GET /api/health` | 200; security headers present (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, API CSP `default-src 'none'`) |
| `GET /api/ready` | 503 `{"database":"disconnected","redis":"connected"}` (correct for the setup) |
| Any other `/api/*` without DB | 503 "Service temporarily unavailable" (DB gate precedes routing, body parsing and auth) |
| POST from untrusted `Origin` | 403 |
| POST with `Sec-Fetch-Site: cross-site`, no Origin | 403 |
| POST with allowed Origin | passes CORS (gets the DB 503), `Access-Control-Allow-Origin` + `Allow-Credentials` echoed only for allowed origin |
| POST with no Origin/no Sec-Fetch-Site | allowed through (non-browser clients) |
| Preflight evil origin / allowed origin | 403 / 204 with exact allow-list headers |
| Probes 9–11, 13, 14 (text/plain, malformed JSON, >1 MB body, reconcile endpoint, admin route) | **Not informative**: all returned the DB-gate 503, so body limits, JSON error handling, reconcile auth and admin 401/403 were *not* observed at runtime |

## NOT executed / NOT verified (environmental limits)
- **MongoDB-backed behaviour**: could not obtain a MongoDB binary (sandbox proxy returned 403 for `fastdl.mongodb.org`; no docker daemon; no distro package). Therefore: the 10 integration tests (stock reservation races, coupon redemption/release, transaction rollback) **were not run**; no end-to-end user journey (register/login/refresh, cart, wishlist, checkout, coupons, orders, admin operations) was run; all such conclusions come from code reading.
- **Zarinpal**: no sandbox merchant ID → payment request/verify/callback never exercised. The BIZ-1/BIZ-2 findings depend on Zarinpal's real response shape and code semantics, which I could not check offline.
- **Cloudinary, Resend, Vercel**: not contacted. Proxy/IP behaviour behind Vercel rewrites, HSTS defaults, the 4.5 MB body limit: unverified.
- **Browser rendering**: no pages were rendered; RTL/layout/accessibility/contrast statements are from code only (contrast ratios by inspection of tokens, not measured).
- **Load/performance testing, backup/restore, deployment, rollback**: not performed.
- **Dependency advisories**: reported as listed by `npm audit`; I did not verify exploitability of each against this code (flagged where relevant).
- **Upstream provenance/licence** of the project and image assets: unverifiable offline.

## How the code-review findings were produced
Four read-only review agents covered (a) auth/RBAC/routes, (b) payments/orders/inventory, (c) application security, (d) frontend/RTL/SEO/branding. I spot-checked the load-bearing claims myself against source/by execution: login/signup operator injection (#11), stranded-order query `$or` overwrite (#12), Zarinpal verify reading `payload.data.code` (`zarinpal.controller.js:617,861`) vs the request path reading `payload.errors.code` (`:475`), product Cloudinary upload of raw strings (`product.controller.js:413`), global 10 MB parser order (`app.js:93`), absence of headers in `vercel.json`, the refresh-spinner unmount (`useUserStore.js:77`, `App.jsx:67`), the refresh-exclusion regex (`refresh-coordinator.js:6`), the share-preview regex (#13). Findings not individually re-verified by me are in the area reports with their own VERIFIED/POTENTIAL labels.

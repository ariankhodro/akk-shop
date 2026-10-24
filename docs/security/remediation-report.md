# Remediation report

Branch `fix/comprehensive-security-remediation` (based on `ec66fd0`). Source: audit reports `docs/01`-`09`. Statuses were assigned against the code as it stands after this work. **"Fixed" means implemented and covered by an automated test unless stated otherwise; it does not mean verified against external services.**

## Verification actually executed (2026-10-24, disposable infrastructure only)

| Check | Result |
|---|---|
| Backend tests (`npm test --prefix backend`, MongoDB 7.0 replica set + Redis 7.0.15 in Docker/local) | **225 tests, 225 pass, 0 fail, 0 skipped** (baseline was 63 pass + 10 skipped without Mongo). Five consecutive full runs passed after fixing one timing-dependent assertion (see "Test changes"). |
| Frontend tests | **37 pass, 0 fail** (baseline 23) |
| Frontend lint | **0 errors, 0 warnings** (baseline 23 errors, 2 warnings) |
| Frontend production build / backend build script / `node --check` of SEO functions | pass / pass / pass |
| End-to-end (`e2e/run.mjs`, real backend + built SPA + Chromium, Zarinpal mocked) | **14 journeys pass, 0 fail**: home RTL (no overflow at 390 px), product page, signup (weak password refused), session cookies HttpOnly/SameSite=Strict, cart, address + gateway redirect + callback + success + stock decrement, orders page, replayed callback idempotent, operator-injection login refused, owner console, analyst limited, legacy admin denied, fulfilment role |
| CSP browser check (built SPA served with `vercel.json` headers) | 0 violations on `/`, product, `/login`, `/shop`, `/cart`, light and dark; negative control blocked (agent run, see `http-hardening.md`) |
| `npm audit --omit=dev` | root **0**; frontend **2 moderate** (`react-router`/`react-router-dom` 6.x, fix requires v7) |
| `npm audit` (incl. dev tooling) | root **0**; frontend: `esbuild`/`vite` dev server, `postcss-selector-parser` (tailwind build), `react-router` - all moderate, fixes need major upgrades |
| Secret scan (gitleaks 8.18.4, full history) | no leaks; one false positive (fake constants in an e2e file, replaced by runtime-generated values) is allowlisted by fingerprint in `.gitleaksignore` |
| Backup/restore drill | passed on a disposable Docker MongoDB with **synthetic data**; negative test fails as designed (see `docs/operations/backup-and-restore.md`) |

**Not executed / not verifiable here:** real Zarinpal sandbox (host unreachable, no merchant), Cloudinary, Resend, Vercel deployment behaviour (header application, rewrite IP/`X-Forwarded-For` chain), load testing, restore at production scale, mobile Safari/Firefox rendering, screen-reader testing, accessibility contrast measurement.

## Finding status

Legend: **Fixed** (code + test), **Partial** (what remains stated), **Not done** (deferred, stated), **N/A** (info/verified not applicable), **Unresolved** (needs an external decision).

### Dependencies and licence
| ID | Status |
|---|---|
| DEP-1 (`jws`, `proxy-addr`, `mongoose`, `express`, `cloudinary`, `axios`, `react-router-dom`, `vite`, ...) | **Fixed** for every production-path package (in-range upgrades, no `--force`; backend 0 vulnerabilities). **Partial** for frontend dev tooling and `react-router` 6.x moderates (need Vite 6+/Tailwind 4/React Router 7 major migrations, deliberately deferred; exposure: dev server, build-time CSS parsing, SSR/`Link` backslash issue mitigated by internal-href validation). |
| L-1 licence/provenance | **Unresolved release blocker.** `docs/legal/licensing-status.md`. Nothing was relabelled. |

### Security (SEC)
| ID | Status |
|---|---|
| SEC-1 operator injection login/signup | **Fixed** (strict readers, uniform 401, tests incl. browser). Global `sanitizeFilter` was **not** enabled: the app legitimately builds `$` filters server-side. |
| SEC-2 storefront headers/CSP | **Fixed in config** (`vercel.json` + `seo/security-headers.js`, theme script moved to a file). Application by Vercel unverified; Google Fonts hosts and `style-src 'unsafe-inline'` remain allowed (documented). |
| SEC-3 product image pipeline | **Fixed** |
| SEC-4 parser before auth | **Fixed** |
| SEC-5 rate limiting | **Fixed** (fail closed on auth, per-account + per-address, /64, split buckets, tests for outage/multi-instance/expiry/IPv6). Duplicate limiter on the campaign click route (cosmetic) **not changed**; Vercel client-IP chain **unverified**; `TRUST_PROXY_HOPS` configurable. |
| SEC-6 newsletter | **Fixed** (double opt-in, HMAC unsubscribe). Needs a mail transport and frontend copy/route updates. |
| SEC-7 campaign href | **Fixed** |
| SEC-8 cache keys | **Fixed** |
| SEC-9 image lifecycle | **Fixed** |
| SEC-10 public data exposure | **Partial**: sales counters, `__v` removed; exact stock stays (cart UI needs it); campaign view counting on GET reduced (bots/prefetch skipped), POST beacon added, full switch needs a frontend call. |
| SEC-11 `/api/ready` | **Fixed** (token-gated detail) |
| SEC-12 SEO functions | **Fixed** |
| SEC-13 expensive queries | **Partial**: page cap; no keyset pagination/text index |
| SEC-14 env/secret handling | **Fixed** (startup validation, explicit dev flags, `.gitignore`, `.env.example`) |
| SEC-15 logging/PII | **Partial**: DB host no longer logged, structured logger and request ids added, bodies/queries never logged; the 112 legacy `console.*` calls remain; audit-log retention is a documented operator task (no TTL). |
| SEC-16 misc | **Fixed** (sort keys, 400 for validation, ObjectId strictness, attribute size). Signup duplicate disclosure is inherent without email verification (mitigated by limiter, uniform message); forgot-password timing difference **remains** (low). |

### Authentication / RBAC (AUTH)
| ID | Status |
|---|---|
| AUTH-1 | **Fixed** |
| AUTH-2 legacy full-access admins | **Fixed** (fail-open removed, explicit permissions required, migration script) |
| AUTH-3 owner tier / roles.manage escalation | **Fixed** |
| AUTH-4 PII reads/exports unaudited | **Fixed** (customer list, newsletter list, CSV export; `reports.export` permission) |
| AUTH-5 audit failures swallowed / no before-after | **Fixed** for access changes (transactional), refunds and export (fail the request); **Partial** elsewhere (best-effort, logged). |
| AUTH-6 brute-force controls | **Fixed** |
| AUTH-7 enumeration/flooding | **Partial** (login timing equalised, per-email cooldown, uniform responses; signup 409 and forgot timing remain) |
| AUTH-8 refresh design | **Partial**: hashed storage, reuse detection, concurrent-tab grace, frontend cross-tab fix. Still one session slot per user (second device replaces first). |
| AUTH-9 token revocation | **Fixed** (`tokenVersion`; reset revokes before the password changes) |
| AUTH-10 JWT/cookie hardening | **Fixed** (HS256 pinned, iss/aud/typ, distinct-secret validation, refresh cookie path-scoped, Secure unless explicit opt-out) |
| AUTH-11 UI/backend disagreement | **Fixed** (server-computed `effectivePermissions`, per-widget gating, editors hidden, deny while loading) |
| AUTH-12 permission naming | **Fixed** for inventory writes, `refunds.manage`, `reports.export`; `customers.manage` is still read-only by nature |
| AUTH-13 matcher/route drift | **Fixed** (no backslash rewriting; test enumerates routers vs rules) |
| AUTH-14 MFA / email verification | **Not done** (P3 in the roadmap). Admin accounts are password-only; this is a remaining risk. |
| AUTH-15 | **Fixed** (DB errors in `protectRoute` return 503, not 401) |

### Payments, inventory, coupons (BIZ) - all **not sandbox-verified**
| ID | Status |
|---|---|
| BIZ-1 error field parsing, `Status=NOK` | **Fixed** (both shapes; NOK is a hint). The Zarinpal contract is reconstructed from memory/fixtures labelled as such. |
| BIZ-2 terminal code set | **Fixed in code** (only -51/-54 definitive; -50 manual review; others hold). **Needs sandbox confirmation.** A definitive code on HTTP 4xx is also trusted (one-line change to tighten). |
| BIZ-3 stranded query | **Fixed** (query-shape test + Mongo test) |
| BIZ-3b re-verify failed/expired | **Fixed** (`paid_after_expiry`, manual review flag, dashboard counter, customer label) |
| BIZ-4 pending-order cap/dedupe | **Fixed** (cap 2, identical cart reuses order). Releasing an older pending order was not implemented. |
| BIZ-5 admin stock overwrites | **Fixed** (delta + conditional writes; frontend sends baselines) |
| BIZ-6 release routing | **Fixed** |
| BIZ-7 per-user coupon limit | **Fixed** (`perUserLimit` default 1; validate endpoint limited to 10/min) |
| BIZ-8 refund double counting | **Fixed** (partial unique index + cumulative cap in a transaction and model hook) |
| BIZ-9 throughput | **Fixed** (adaptive batch up to 50, 40 s budget) |
| BIZ-10 Redis dependency of reconciler | **Fixed** (Mongo lease fallback) |
| BIZ-11 finalization robustness | **Fixed** |
| BIZ-12 replica set / retry time | **Partial** (documented; no overall transaction deadline added) |
| BIZ-13 bookkeeping | **Fixed** (unique sparse ref id, masked card/fee stored) |
| BIZ-14 scheduler | **Partial**: `CRON_SECRET` >= 32 enforced, timeouts aligned; second scheduler trigger **not added** |
| BIZ-15 | N/A (design notes) |

### Frontend (FE) and quality (Q)
**Fixed:** FE-1, FE-2, FE-9 (session UX), FE-15, FE-17, FE-19, FE-23, FE-25, Q-1 (lint), Q-3 (CI runs every test file).
**Partial:** FE-4 (dialogs for filters, product edit, date popover; mobile search dialog not), FE-20 (price filters; admin number inputs not), FE-21 (login/signup arrows only), FE-13 (HTML 503 and last-good shell; private routes still depend on the shell), Q-2 (coverage greatly extended; no React component tests), Q-5/Q-6/Q-7 (digit normalisation deduplicated; rest remains).
**Not done:** FE-3 RTL `!important` inversion, FE-5 fonts self-hosting, FE-6/7/8/10/11/12 performance and cart architecture, FE-14 hard-coded API host in `vercel.json` (cannot read env vars), FE-16 contrast tokens, FE-18 dark theme layer, FE-22, FE-24, FE-29, FE-30-34 (incl. robots rules), Q-4 large-file refactors, branding items (out of scope).
**N/A:** FE-26..28, FE-35.

### Operations
| Area | Status |
|---|---|
| Startup validation / `.env.example` | **Fixed** |
| Graceful shutdown | **Fixed** (`backend/server.js`) |
| Structured logging, request ids | **Fixed** for new code; error-tracking/metrics integration **not added** (alert events listed in `deployment-and-recovery.md`) |
| CI (Mongo replica set, Redis, lint, audit gate, gitleaks, e2e, Dependabot, pinned Node) | **Fixed** (workflow not yet executed on GitHub; actions are pinned by major tag, not SHA) |
| Backup/restore | **Tooling + synthetic drill done**; production restore **not verified** |
| Redis persistence | Documented as not required |
| Dockerfile / process supervision | **Not done** |

## Test changes (justified)
- `admin-permissions.test.js`: removed four tests of `hasAdministratorManagementAccess`/`canPreserveAdministratorManagement`, the helpers that granted legacy admins management access; they were deleted together with the fail-open behaviour and replaced by `rbac.test.js`.
- `refresh-token.test.js`: rotation test rewritten for digest storage, grace window and reuse revocation (old plaintext single-slot semantics were removed on purpose).
- `inventory-recovery.integration.test.js` ("failed transaction keeps the stock recoverable"): relied on the missing-variant throw that BIZ-6 intentionally removed; it now injects a save failure; rollback assertions unchanged.
- `frontend/tests/seo-handlers.test.js`: mock shell served the request host; it now serves the configured origin (Host header is no longer trusted).
- `payment-callback.integration.test.js` (concurrent callbacks): the assertion `calls.length === 12` failed intermittently (1 run in 3) because a callback arriving after finalization legitimately skips the provider; now `1..12` while all finalization invariants stay exact.
- `product-images.test.js`: stubs updated to the conditional `findOneAndUpdate` write path; assertions unchanged.

## Remaining risks (summary)
1. Payment recovery logic is verified against constructed fixtures only. **Do not take real payments before a Zarinpal sandbox run** confirms code semantics, HTTP status behaviour and whether verify echoes the amount.
2. Licence/provenance unresolved (blocker for redistribution).
3. No MFA/email verification for admin or customer accounts.
4. Frontend dev-tooling and `react-router` 6.x moderate advisories; RTL/performance/accessibility debts listed above.
5. Vercel-specific behaviour (header application, client IP in the rewrite chain, body-size limits) unverified.
6. Operational recovery proven only on synthetic data.

## Production-readiness verdict
**Not production-ready for real payments yet.** The application-security, authorization, session, inventory and coupon invariants are now implemented with regression coverage and passed a broad automated and browser verification run. Release is still gated by: (a) a Zarinpal sandbox verification and fixture re-recording, (b) a licence/image-provenance decision, (c) a staging deployment that checks headers, client-IP handling, mail transport and the migrations below, and (d) a restore drill on real infrastructure. After those, remaining items are hardening and maintainability rather than blockers.

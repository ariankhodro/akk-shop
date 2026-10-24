# 08 — Remediation roadmap

Effort is in **ideal engineer‑days for one developer familiar with Node/React**, based on file sizes and the number of touch points I saw. Uncertainty is high where Zarinpal behaviour or deployment topology must first be confirmed. IDs refer to reports 03–07. Nothing here was implemented.

## Dependency graph (what blocks what)
`L-1 (licence decision)` → independent, do first (blocks redistribution/rebrand decisions only).
`D-1 (dependency upgrades)` → `T-1 (CI with Mongo, lint, audit)` makes every later change safer; do D‑1 and T‑1 first.
`Z-0 (get Zarinpal sandbox + fixtures)` → `P-1 (BIZ‑1/2/3)` → `P-2 (BIZ‑3b/4/6)`.
`A-1 (input hardening)` ∥ `A-2 (admin migration)` → `R-1 (named roles)` → `R-2 (UI alignment)`.
`B-1 (brand config)` → `B-2 (rebrand assets/content)`; `FE-1..` are independent.

## P0 — critical security / data‑integrity (do before taking real money)
| ID | Task | Findings | Effort | Acceptance criteria |
|---|---|---|---|---|
| L-1 | Establish provenance and licence of the project and images; fix README badge/`package.json`; add copyright notice; decide GPL‑2.0 vs. relicense with copyright holders; replace unlicensed images | §1–2 of report 07 | 0.5–1 (+ legal) | One consistent licence statement; written confirmation or replacement for every image |
| D-1 | Upgrade vulnerable dependencies within current majors (`jsonwebtoken`→9.0.3/`jws`≥3.2.3, `mongoose`≥8.24.x, `express`≥4.22.x incl. `proxy-addr`≥2.0.8, `cloudinary`≥2.7, `cookie-parser`, `axios`, `react-router-dom`, `vite`, `postcss`); regenerate locks | DEP‑1 | 1–2 | `npm audit --omit=dev` shows no high/critical in root and frontend (or documented exceptions); all tests + builds green |
| Z-0 | Obtain a Zarinpal sandbox merchant; record real request/verify/error responses as test fixtures; confirm where error codes live and what −11/−12/−21/−22/−42/−51/−54 mean | BIZ‑1/2 | 0.5–1 | Fixture files in repo; written mapping of code → paid / unpaid‑terminal / transient |
| P-1 | Fix payment recovery: read verify errors from the correct field; correct terminal‑unpaid set; fix the `$or` override in the stranded‑order query (use `$and`); handle callback `Status=NOK`; add a max‑age fallback to expire abandoned pending orders | BIZ‑1,2,3 | 3–5 | Sandbox: abandoned/cancelled/expired payments release stock & coupon within one reconcile cycle; a paid‑after‑expiry order is recovered; query‑shape unit test; integration test with Mongo; no paid order is ever marked failed |
| A-1 | Reject non‑string `email`/`password` (400), validate email format/name length on signup; enable `sanitizeFilter`; add a shared validation helper for all body inputs | SEC‑1/AUTH‑1 | 1 | `{"email":{"$ne":null}}` and numeric password return 400 (tested); no 500/400 oracle |
| A-2 | Admin hardening: migrate existing "legacy" admins to explicit permissions; require `permissions` when promoting; remove the fail‑open branch; add owner tier (only owner grants `*`/`roles.manage`) | AUTH‑2,3 | 2 | Test: admin without permissions array gets 403 everywhere; delegated `roles.manage` user cannot grant `*` or modify/disable an owner; migration script has dry‑run |
| A-3 | Make auth limiting fail closed and per‑account: separate buckets for login/signup/forgot/reset; second key on email; tight in‑memory/global limit when Redis is down | SEC‑5/AUTH‑6 | 1–2 | Redis‑down test shows requests limited or rejected, not unlimited; 6th failed login for one email in the window is throttled regardless of IP |

## P1 — important production blockers
| ID | Task | Findings | Effort | Acceptance |
|---|---|---|---|---|
| P-2 | Stock/coupon integrity: pending‑order cap/dedupe per user; stock edits as deltas (not absolute `$set`); release routing via `hasVariant`; per‑user coupon limit; refund cumulative cap + dedupe; re‑verify failed/expired orders on callback | BIZ‑3b,4,5,6,7,8 | 4–6 | Each has a failing‑first integration test: double checkout holds one reservation; admin stock edit preserves reservations; renamed variant doesn't wedge release; 2nd use of one‑per‑user coupon rejected |
| T-1 | CI: run Mongo replica set for all tests in main CI; add lint (fix the 23 errors, add Node globals for tests), `npm audit --omit=dev` gate, Dependabot, Node version pinned (`engines`, `.nvmrc`); make `test` the single entry (drop hand‑listed build subsets) | Q‑1..3 | 1–2 | PR CI runs the 10 integration tests (0 skipped) and lint; red on high advisories |
| S-1 | Add security headers for SPA/SEO HTML (CSP, frame‑ancestors, Referrer‑Policy, HSTS) in `vercel.json` and in SEO function responses; test CSP against the app (fonts, Cloudinary, Zarinpal redirects) | SEC‑2 | 1–2 | Headers present on `/`, `/product/:id`; no CSP violations on main journeys |
| S-2 | Admin upload path: route product images through the hardened `resolveImageReference` (HTTPS Cloudinary/data‑URL allowlist, size, MIME, no SVG); move JSON parser after auth for large routes | SEC‑3,4 | 1–2 | Non‑HTTPS strings / local paths / remote URLs rejected by tests; anonymous request with 9 MB body returns 401 without parsing |
| O-1 | Backups and restore: managed Mongo backups or `mongodump` schedule, retention, written restore runbook, **a restore test**; Redis persistence decision | §3 report 06 | 1–2 | Documented RPO/RTO; one successful restore into a fresh cluster |
| O-2 | Startup validation of env (secrets present, ≥32 chars, access≠refresh, `NODE_ENV`), backend `.env.example`, graceful shutdown for non‑Vercel runs, structured logging + error tracking, uptime/alert on reconcile cron | SEC‑14, AUTH‑10 | 2–3 | App refuses to start with bad config; SIGTERM drains; alert fires when reconcile job fails |
| Z-1 | Reconciliation robustness: larger/adaptive batch, no Redis hard‑fail (lock only as overlap guard), scheduler redundancy (second trigger such as Vercel Cron) | BIZ‑9,10,14 | 1–2 | 500 stranded orders processed within an hour in a test; reconciler works with Redis down |
| FE-1 | Session UX: stop unmounting the app on refresh; stop boot blocking & failing triple request; fix cross‑tab refresh logout | FE‑1,2, AUTH‑8 | 2 | Form state survives a token refresh; anonymous visit makes no failing calls; two tabs don't log each other out |
| A-4 | Audit improvements: audit PII exports/lists and auth events, store before/after, fail the request (or alert) for role/refund changes; retention policy | AUTH‑4,5 | 1–2 | Export produces an audit row; role change row contains old and new values |
| X-1 | Newsletter double opt‑in and signed unsubscribe links; stop overriding opt‑out | SEC‑6 | 1–2 | Subscribe sends confirmation; unsubscribe requires token |
| X-2 | Fix SEO regex bug (CR/LF) and soft‑failure paths (page‑shell dependence on `/index.html`) | FE‑15,13,14 | 0.5–1 | Filter values with "r"/"n" preserved; fallback shell served if self‑fetch fails |

## P2 — maintainability and performance
| ID | Task | Findings | Effort |
|---|---|---|---|
| R-1 | Named roles as server‑side presets (owner, manager, catalogue, fulfillment, support, marketing, analyst), simplify permissions to ~8, attach permission at route (`requirePermission`) and test routers vs rules; add `reports.export`/`refunds.manage` | AUTH‑12,13, report 05 §4 | 3–5 |
| R-2 | Align admin UI with backend permissions: per‑widget dashboard gating, hide editors without `roles.manage`, marketing product picker endpoint, packing badge gating | AUTH‑11 | 1–2 |
| B-1 | Central brand config (name fa/en, tagline, domain, colours, contact, social, storage keys) consumed by frontend, SEO functions and tests; remove the hard‑coded API host from `vercel.json` (env‑driven) | report 04 §D | 2–3 |
| B-2 | Rebrand content: logo/favicon/OG image, palette tokens (remove `[class~=…]` overrides), copy, policies, category slugs/attributes (if not fashion), seed imagery | report 04 §D | 2–6 depending on category change |
| FE-2 | RTL cleanup: replace the global `!important` inversion with logical utilities (ms/me/ps/pe/start/end), fix arrows, `<bdi>`, Persian digit input handling, Persian validation messages, self‑host Vazirmatn | FE‑3,5,20–23 | 4–6 |
| FE-3 | Accessibility: dialog focus/Escape/scroll lock components, combobox ARIA, contrast tokens, admin nav roles | FE‑4,16,17,29 | 2–3 |
| FE-4 | Performance: selector‑based Zustand subscriptions, request dedupe, responsive images + Cloudinary transforms, compress `public/` photos | FE‑6,7,12 | 2–3 |
| FE-5 | Cart/wishlist: serialise cart updates, server‑side wishlist, store ids not snapshots | FE‑8–10 | 2–3 |
| Q-1 | Refactor largest controllers/components; shared validation layer (e.g., zod); dedupe Persian normalisation; delete dead code | Q‑4..6 | 5–8 |
| M-1 | Pin GitHub Actions by SHA; add CodeQL; backend lockfile/manifest consolidation | report 06 | 0.5–1 |
| E-1 | Take major upgrades later (Express 5, Mongoose 9, React 19, Tailwind 4, Vite 8) after tests are strong | report 07 §5 | 5–10 |

## P3 — optional enhancements
Admin MFA (TOTP) and email verification (AUTH‑14); order‑confirmation emails; stock movement history; per‑variant thresholds and alert notifications; tax/VAT handling if required by your accounting; automatic Zarinpal refund API integration; PWA/offline; load testing and capacity plan; i18n is **not** needed (single locale).

## Suggested sequencing and total effort
1. Week 1: L‑1, D‑1, T‑1, A‑1, A‑3, Z‑0 (≈6–9 days)
2. Week 2–3: P‑1, A‑2, P‑2, S‑1, S‑2 (≈11–17 days)
3. Week 3–4: O‑1, O‑2, Z‑1, FE‑1, A‑4, X‑1/2 (≈9–14 days)
4. Rebrand (B‑1/B‑2) can run in parallel after D‑1/T‑1; RBAC roles (R‑1/R‑2) after A‑2.
**Total ≈ 6–9 engineer‑weeks for P0+P1 plus roles/rebrand (P2) of ≈ 3–5 more weeks.** These are rough estimates (±40%); the largest unknown is how Zarinpal's real responses differ from the code's assumptions (Z‑0), and I could not run the application end to end.

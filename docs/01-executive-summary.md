# 01 — Executive summary

**Repository:** ItsWanheda/mern-ecommerce, `master` @ `e9993b8` (729 commits). **Audit date:** 2026-10-24. **Method:** full code read (backend, frontend, SEO functions, scripts, CI, docs) by four parallel read-only reviewers plus my own execution of installs, tests, lint, builds, `npm audit`, licence and secret scans, and no-database runtime probes. The repo was not modified.

## Verdict: **Adopt after remediation — not production-ready today**
The codebase is well above tutorial grade: server-authoritative integer-Toman pricing, atomic stock reservation, idempotent payment finalization design, a fail-closed admin permission table, solid CSRF/CORS defences, no XSS sinks and no secrets in history. But it should not take real payments until the payment-recovery defects, vulnerable dependencies and licence question below are resolved, and the behaviour has been proven against a MongoDB replica set and the Zarinpal sandbox — neither of which I could do here.

## Top five findings
1. **Payment recovery is likely broken (High, BIZ‑1/2/3).** Zarinpal verify errors are read from `payload.data.code` (`zarinpal.controller.js:617,861`) while the request path reads `payload.errors.code` (`:475`), so "not paid" branches appear unreachable and abandoned/cancelled payments can stay `pending` holding stock and coupons. The "terminal unpaid" code set (`:702`) looks like legacy codes. A query bug (`...due` overwrites `$or`, verified by execution) makes the stranded‑order sweep process the wrong orders. *Provider response shape needs sandbox confirmation.*
2. **Vulnerable dependencies in the auth and request path (High, DEP‑1).** `jws` 3.2.2 (HMAC verification advisory, used by every login token), `proxy-addr` (critical IP‑spoofing advisory; rate limits key on `req.ip`), `mongoose` 8.5.3, `express` 4.19.2, `cloudinary` 2.4.0. In‑range fixes exist for most. Exploitability was not reproduced.
3. **Licence is unresolved (High for commercial/redistribution use, L‑1).** `LICENSE` is GPL‑2.0 (no copyright holder), the README badge says MIT, `package.json` says ISC; the history shows a derivative of an earlier project (upstream not verified); image assets have no provenance.
4. **Login/signup accept NoSQL operator objects (Medium, SEC‑1/AUTH‑1, verified by execution)** — `{"email":{"$ne":null}}` targets the oldest account (usually the owner) and creates a 400‑vs‑500 enumeration oracle; combined with weak, Redis‑dependent, per‑IP‑only brute‑force limits that fail open (AUTH‑6).
5. **Admin privilege model fails open (Medium, AUTH‑2/3).** Admins without a `permissions` array ("legacy") pass all 33 admin endpoints (effectively full access) and can be created by API; `roles.manage` is equivalent to owner and can lock out the owner. The engine is otherwise sound (all 33 routes have exactly one rule).

Also important: no security headers on the storefront HTML (SEC‑2); no tested backups, Dockerfile, graceful shutdown or monitoring; no per‑user coupon limit (BIZ‑7); admin stock edits erase reservations (BIZ‑5); frontend refresh unmounts the whole app (FE‑1) and RTL relies on a global `!important` inversion hack (FE‑3).

## Business impact
- **Money/inventory:** until BIZ‑1/2/3 are fixed, stock can be locked by abandoned checkouts and operators must reconcile by hand; unlimited free orders are possible with a 100 % coupon (BIZ‑7). There is no evidence of price tampering or double fulfilment in the design.
- **Security:** no unauthenticated takeover found; main risks are account targeting/brute force, insider/legacy admin over‑privilege and known‑CVE dependencies.
- **Legal:** commercial use is permitted under GPL‑2.0, but redistribution/closed customisation and image rights need a decision.

## Test/build status (actually executed)
| Check | Result |
|---|---|
| Backend tests | 53 pass, 0 fail, **10 skipped** (need MongoDB) |
| Frontend tests | 23 pass |
| Backend build script | pass |
| Frontend production build | pass (6 s; 5.7 MB dist) |
| Frontend lint | **fail — 23 errors, 2 warnings** (not in CI) |
| `npm audit` | root 16 vulns (2 critical, 9 high); frontend 28 (1 critical, 18 high); prod‑only 13 / 9 |
| Runtime probes | health/ready/CORS/CSRF behaved as designed; everything behind the DB gate unverified |

## Production blockers
P0: payment recovery (P‑1, after Zarinpal sandbox fixtures Z‑0), dependency upgrades (D‑1), licence/provenance (L‑1), input hardening (A‑1), admin fail‑open and owner tier (A‑2), fail‑closed auth limiter (A‑3).
P1: stock/coupon integrity (P‑2), CI with Mongo + lint + audit (T‑1), security headers (S‑1), upload/parse hardening (S‑2), backup/restore + env validation + monitoring (O‑1/O‑2), reconciler robustness (Z‑1), session UX (FE‑1).

## Effort
Roughly **6–9 engineer‑weeks** for P0+P1, **+3–5 weeks** for named roles, RTL cleanup, performance and the rebrand (rebranding itself is ~1 week: one brand config plus ~30 files; longer if you change product category). ±40 %.

## What this audit did NOT verify
No MongoDB (sandbox blocked the binary) → integration tests, concurrency behaviour and all end‑to‑end journeys were **not run**; no Zarinpal, Cloudinary, Resend or Vercel contact; no browser rendering (RTL/a11y/contrast judged from code); no load, backup/restore or deployment testing; dependency advisories not individually exploit‑tested; upstream project/licence/image provenance unverifiable offline. See report 09.

## Report index
01 summary · 02 architecture · 03 security · 04 functional/business/frontend · 05 admin RBAC (route→permission matrix, role model) · 06 quality/performance/operations · 07 dependencies & licensing · 08 roadmap · 09 verification log.

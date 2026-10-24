# 03 — Security audit

**How to read this.** Status labels: **VERIFIED** = confirmed by reading the cited code (and by execution where report 09 says so); **POTENTIAL** = depends on deployment or runtime behaviour I could not observe; **NOT VERIFIABLE** = needs a live environment. Nothing was exploited; no external system was contacted.

## Overall security posture
No Critical or unauthenticated-remote-takeover issue was found in the code. The fundamentals are good (HTTP‑only SameSite=Strict cookies, Origin/Fetch‑Metadata CSRF checks, exact‑match CORS, fail‑closed admin permission table, hashed single‑use reset tokens, server‑side pricing, no XSS sinks, no secrets in 729 commits). The weaknesses cluster in: **NoSQL operator injection on login/signup**, **dependency vulnerabilities including `jws`/HMAC and `proxy-addr`**, **legacy "fail‑open" admin permissions**, **weak brute‑force controls that fail open when Redis is down**, **no browser security headers on the storefront HTML**, and **a payment reconciliation bug set (see §B)**.

## Findings index (de‑duplicated)
| ID | Sev | Status | Title | Source |
|---|---|---|---|---|
| SEC-1 = AUTH-1 | Medium | VERIFIED | NoSQL operator injection / type confusion in login & signup; 400 vs 500 enumeration oracle | §A, §C |
| DEP-1 | High | VERIFIED version, exploitability not reproduced | `jws` 3.2.2 HMAC verification advisory; `proxy-addr`, `mongoose`, `cloudinary`, `express` advisories | report 07 |
| AUTH-2 | Medium | VERIFIED | API promotion to admin without `permissions` creates a full legacy admin | §C |
| AUTH-3 | Medium | VERIFIED | `roles.manage` ≈ owner; no owner tier | §C |
| SEC-5 = AUTH-6 | Medium | VERIFIED / topology POTENTIAL | Auth rate limits: per‑IP only, shared bucket, memory fallback when Redis fails, no per‑account throttle | §A, §C |
| SEC-2 | Medium | VERIFIED | No CSP/frame/HSTS/Referrer headers on SPA & SEO HTML (`vercel.json` has no `headers`) | §A |
| SEC-3 | Medium | VERIFIED | Product create/update send non‑HTTPS strings to Cloudinary (server file path / remote fetch), no size/type checks (admin‑only) | §A |
| SEC-4 | Medium | VERIFIED | 10 MB JSON parser runs before authentication | §A |
| SEC-6 | Medium | VERIFIED | Newsletter subscribe/unsubscribe unauthenticated and unverified; subscribe overrides opt‑out | §A |
| AUTH-4/5 | Medium | VERIFIED | PII exports unaudited; audit failures swallowed; no before/after state | §C |
| BIZ-1/2/3 … | High | see §B | Payment reconciliation correctness (financial integrity) | report 04 |
| SEC-7…SEC-16, AUTH-7…AUTH-15 | Low/Info | mostly VERIFIED | see sections below | §A, §C |

Duplicate issues were merged (e.g., login operator injection was found independently by two reviewers).

## B. Security‑relevant business‑logic findings (full detail in report 04)
- **BIZ-1/BIZ-2/BIZ-3 (High)** payment verify/reconcile logic: unpaid detection reads the wrong response field; terminal‑code set questionable; a query bug starves recovery of stranded stock. Financial/inventory integrity impact, not an attacker‑exploitable hole.
- **BIZ-7 (Medium)** no per‑user coupon limit → repeated use of a 100% coupon (abuse).
- **BIZ-5 (Medium)** admin stock edits overwrite live reservations → oversell.

## A. Application security findings (SEC-*)
### Summary table

| ID | Sev | Status | Title |
|----|-----|--------|-------|
| SEC-1 | Medium | VERIFIED | NoSQL operator injection in login/signup `email` (object accepted) |
| SEC-2 | Medium | VERIFIED | No CSP / frame protection / security headers for the SPA and SEO HTML (vercel.json has no `headers`) |
| SEC-3 | Medium | VERIFIED | `createProduct`/`updateProduct` bypass the hardened image pipeline (local-file read, remote fetch, no validation) |
| SEC-4 | Medium | VERIFIED | Unauthenticated requests are parsed with a 10 MB JSON limit before auth |
| SEC-5 | Medium | VERIFIED + POTENTIAL | Rate limiting: fail-open memory fallback, IP key derivation, shared auth bucket, double counting |
| SEC-6 | Medium | VERIFIED | Newsletter: no double opt-in; anyone can subscribe/unsubscribe any address and override an opt-out |
| SEC-7 | Low | VERIFIED | Campaign `href` check accepts `/\host` and `/<TAB>/host` (open-redirect shape) |
| SEC-8 | Low | VERIFIED | Unbounded Redis cache keys + uncached aggregation per arbitrary category slug |
| SEC-9 | Low | VERIFIED | Product image lifecycle: orphaned assets, naive public-id parsing on delete |
| SEC-10 | Low | VERIFIED | Public endpoints expose sales/engagement/stock data; GET mutates counters |
| SEC-11 | Low | VERIFIED | `/api/ready` is public, does work on every call, and discloses dependency state |
| SEC-12 | Low | VERIFIED / POTENTIAL | SEO functions: Host-derived self-fetch, unhandled rejection, broken CR/LF regex |
| SEC-13 | Low | VERIFIED | Deep pagination and unanchored regex scans on public search endpoints |
| SEC-14 | Info | VERIFIED | Env/secret handling: no startup validation, dev-origin switch, gitignore gaps |
| SEC-15 | Info | VERIFIED | Logging / PII retention (audit log IP+UA without TTL, DB host logged) |
| SEC-16 | Info | VERIFIED | Misc hardening: `sortMap[...]` prototype keys, signup enumeration, validation errors surfaced as 500 |

No hard-coded secrets were found (details at the end).

---

### SEC-1 (Medium, VERIFIED): NoSQL operator injection in login and signup

- File: backend/controllers/auth.controller.js:78-79 (login), :46 and :50 (signup), :55 (create). `forgotPassword` (:352) and `resetPassword` (:385) type-check their inputs; login/signup do not.
- Evidence:
  - `const { email, password } = req.body;` then `const user = await User.findOne({ email });` (:78-79)
  - `const { email, password, name } = req.body;` ... `User.findOne({ email })` (:46, :50)
  - Mongoose has no `sanitizeFilter` set anywhere in the repo, and `express.json()` yields nested objects.
  - Offline check: `User.findOne({email:{$ne:null}})` casts to `{"email":{"$ne":null}}` and `{"$regex":"^adm"}` is preserved as-is.
- Impact:
  1. Login: `{"email":{"$ne":null},"password":"<guess>"}` matches the first user in natural order (commonly the oldest account, i.e. often the admin). The attacker no longer needs to know any email; one password guess is tested against whichever account matches. `$regex`/`$gt` can steer the match (for example `^admin`).
  2. Signup: an object `email` that matches an existing user returns 400 "User already exists", while a non-matching object makes `User.create` throw a CastError, which returns 500. This is a prefix-enumeration oracle for registered emails via `$regex`.
  3. Signup also has no email-format validation (the schema has none), so garbage emails can be registered.
- Exploitability: needs only the public auth endpoints. Throttled by `authRateLimit` (10 per 15 min per IP), but see SEC-5 for how weak that limit is. Password still has to be correct for takeover, so this is Medium rather than High.
- Safe verification: unit-level only. Run `User.findOne({email:{$ne:null}})._castConditions(); q.getFilter()` against the schema (no DB). A supertest-style test posting `{"email":{"$ne":null},"password":"x"}` to `login` with a stubbed `User.findOne` should assert the argument is a string. Never run against a real deployment.
- Remediation: in login/signup require `typeof email === "string"` and `typeof password === "string"`, then `email = email.trim().toLowerCase()` and validate its format and length (<= 254), as `forgotPassword` already does. Defence in depth: `mongoose.set("sanitizeFilter", true)`, or add `express-mongo-sanitize`-style stripping of `$`-prefixed keys. Add a per-account failed-login counter (see SEC-5).

### SEC-2 (Medium, VERIFIED): No CSP, frame protection or other headers on the storefront

- Files: vercel.json (whole file: only `buildCommand`, `outputDirectory`, `rewrites`; there is no `headers` block). backend/middleware/security.middleware.js:41-53 sets headers for the API only. seo/server-utils.js:145-152 (`sendHtml`) sets only `X-Content-Type-Options` and cache headers. frontend/index.html:18 has an inline `<script>`.
- Evidence: `grep -n headers vercel.json` returns nothing. The API CSP (`default-src 'none'; ... frame-ancestors 'none'`, security.middleware.js:47) never reaches HTML pages, because HTML is served by Vercel static hosting or the /api/page-shell and /api/share-preview functions.
- Impact:
  - No `X-Frame-Options` / `frame-ancestors` on the SPA means clickjacking of /cart, the checkout button, /profile and /secret-dashboard (the admin panel). Cookies are SameSite=Strict, which blunts cross-site framing only partly: a framed page inside an attacker page is cross-site, so the cookies are not sent and the user would have to be logged in and the frame would show a logged-out view. The practical risk is therefore mostly UI-redress on same-site contexts and the loss of defence-in-depth.
  - No CSP means any future XSS (none found today; see "XSS review" below) has no second line of defence. No `Referrer-Policy` or `Permissions-Policy` on HTML. The password-reset token travels in the URL query (`/reset-password?token=`, backend/lib/password-reset-email.js), so Referer leakage to third-party images/links is possible without a Referrer-Policy.
  - HSTS: the API emits `max-age=15552000` only (security.middleware.js:52), with no `includeSubDomains`/`preload`. For the storefront HSTS depends on the Vercel platform default. NOT VERIFIABLE from code.
- Exploitability: clickjacking is theoretical given SameSite=Strict (low). The value is defence in depth.
- Safe verification: `curl -sI https://<storefront>/` and `/login` against your own deployment, and check for the headers. Locally, `vercel dev` or inspecting the build output.
- Remediation: add to root vercel.json:
  `"headers":[{"source":"/(.*)","headers":[{"key":"X-Frame-Options","value":"DENY"},{"key":"Referrer-Policy","value":"strict-origin-when-cross-origin"},{"key":"Permissions-Policy","value":"camera=(), microphone=(), geolocation=()"},{"key":"Strict-Transport-Security","value":"max-age=63072000; includeSubDomains"},{"key":"Content-Security-Policy","value":"default-src 'self'; script-src 'self' 'sha256-<hash of inline theme script>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://res.cloudinary.com https://trustseal.enamad.ir; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://www.zarinpal.com"}]}]`.
  The inline theme script in index.html:18 needs a hash (or move it to a file). The JSON-LD blocks are `type="application/ld+json"` and are not executed, so they do not need a hash. Product image hosts are arbitrary HTTPS (SEC-3), so `img-src` must either allow `https:` or product image URLs must be restricted to Cloudinary.

### SEC-3 (Medium, VERIFIED): createProduct / updateProduct bypass the hardened image pipeline

- File: backend/controllers/product.controller.js:405-416 (create), :565-579 (update). Compare backend/lib/image-upload.js (used by category and campaign controllers).
- Evidence:
  - create (:410-414): `if (/^https:\/\//i.test(imageInput)) {...} else { const response = await cloudinary.uploader.upload(imageInput, { folder: "products" }); ...}`. There is no format check at all in create (only `typeof === "string"`).
  - update (:568) only regex-checks the data-URL prefix and never calls `validateImageDataUrl` (no signature check, no size cap, no dimension/pixel cap). The effective cap is the 10 MB body limit (app.js:93).
  - Offline check against the installed cloudinary 2.4.0: `isRemoteUrl` is true for `http:`, `ftp:`, `s3:`, `gs:` and any `data:` URI, including `data:image/svg+xml;base64,...`. For anything else, uploader.js:55 and :73 take the `fs.createReadStream(path)` branch, so a string such as `/some/local/path.png` makes the server read a local file.
- Impact (all require an admin with `catalogue.manage`):
  1. Local file read and upload: the server reads an arbitrary local file path and sends it to Cloudinary. If it is a valid image it becomes public; the content of any other file is still transmitted to a third party before Cloudinary rejects it.
  2. Server-side fetch by Cloudinary of `http://`/`ftp://`/`s3://`/`gs://` URLs. This is Cloudinary-side SSRF (not your network), and it can be abused for blind probing or hotlinked content.
  3. Unvalidated data URLs on create, including SVG, which is stored on res.cloudinary.com. Not same-origin with the shop, so low risk, but it is inconsistent with the "JPG/PNG/WebP/GIF only" policy tested in tests/image-upload.test.js.
  4. Any `https://` URL (any host) is stored verbatim in `images` (:410-411, :573-574) and rendered in `<img src>`, OG tags and JSON-LD: tracking pixels / hotlinking and the CSP issue in SEC-2.
- Exploitability: requires a compromised or malicious admin account; it is a privilege-escalation-like path from "catalogue editor" to "server file read". Low likelihood, moderate impact.
- Safe verification: unit-level. Stub `cloudinary.uploader.upload` and call `createProduct` with `images:["/etc/hostname"]`, `["http://127.0.0.1/x"]` and an SVG data URL, then assert the stub is invoked (it will be). A real run against Cloudinary is not needed and should be avoided.
- Remediation: route product images through `resolveImageReference(value, { folder: "products", maxBytes })` exactly as category/campaign do (it rejects non-`data:`/non-HTTPS/non-local-path input, runs signature and dimension checks, and returns a Cloudinary HTTPS URL). Optionally restrict stored HTTPS URLs to `res.cloudinary.com/<cloud>/` or an allowlist. Add pending-upload cleanup on failure like the category controller (category.controller.js:209-213).

### SEC-4 (Medium, VERIFIED): 10 MB JSON parsing happens before authentication

- File: backend/app.js:86-94 (`largeJsonRequest`, `express.json({limit:"10mb"})`), routes mounted afterwards at :97-109, so `protectRoute`/`adminRoute` run after parsing.
- Evidence: `app.use("/api", express.json({ limit: "10mb", type: largeJsonRequest }));` is a global middleware; `POST /api/products|categories|campaigns` and `PUT|PATCH /api/{products,categories,campaigns}/<24hex>` match without any credentials.
- Impact: any anonymous client can make the function buffer and `JSON.parse` up to 10 MB per request before getting a 401/403. At the 600 req/min/IP limit (app.js:42-45, rate-limit.middleware.js:68) that is a cheap memory and CPU amplification on a 1-2 GB serverless instance. On Vercel the platform request-body cap (4.5 MB for Functions, per Vercel documentation; NOT VERIFIABLE here) may reduce this, but it also means admin base64 uploads over ~3.3 MB of binary fail with a platform 413 that the code does not anticipate.
- Safe verification: unit-level. Mount `app` with a stubbed DB and POST a 9 MB JSON body with no cookie to `/api/products`. Observe that the body is fully parsed (spy on `JSON.parse`) before the 401. Do not do this against a live deployment.
- Remediation: mount the large parser inside the routes after `protectRoute, adminRoute` (for example `router.post("/", protectRoute, adminRoute, express.json({limit:"6mb"}), createProduct)`). Leave the 1 MB global parser. Because `adminRoute` needs no body, the order works. Consider moving image upload to signed direct-to-Cloudinary uploads so no base64 transits the API at all.

### SEC-5 (Medium, VERIFIED + POTENTIAL): Rate limiting weaknesses

Files: backend/middleware/rate-limit.middleware.js, backend/app.js:37, backend/lib/redis.js, backend/routes/campaign.route.js:18, vercel.json:4-8.

a) Fail-open on Redis failure (VERIFIED). rate-limit.middleware.js:47-55: on any Redis error the limiter silently switches to the in-process `memoryWindows` Map. On serverless every cold instance has its own map, so the effective limit is `limit x instances`. The 10 auth attempts per 15 minutes (:72) become effectively unlimited whenever Redis is down, slow (`commandTimeout: 2000`, redis.js) or unconfigured (`redis.eval` throws "REDIS_URL ... not configured" and the code falls through to memory, redis.js:6-17). An attacker who can degrade Redis (or simply wait for an outage) can brute-force logins. Note SEC-1 makes each guess more valuable. A single warning is logged once per instance (`redisFallbackWarningLogged`), so outages are easy to miss.
b) Key derivation (VERIFIED code, POTENTIAL deployment): the key is `req.ip` (:41) with `trust proxy = 1` (app.js:37). There are no per-account counters at all (no lockout on `email`).
   - If the API is ever reachable directly without exactly one trusted proxy in front (the docs describe Nginx/self-hosting, docs/PERSIAN_COMMERCE_SETUP.md:60), `X-Forwarded-For` is attacker-controlled and every limit is bypassable with a rotating header.
   - On Vercel, the storefront forwards `/api/*` through a rewrite to a second Vercel project (vercel.json:4-8, `mern-ecommerce-api-tau.vercel.app`). Whether `req.ip` in the API function is then the real client or the first project's egress address depends on how Vercel populates `x-forwarded-for` for external rewrites. If it is the proxy address, all users share one bucket and 10 auth attempts per 15 minutes is a site-wide login lockout (self-DoS). NOT VERIFIABLE from code; check by logging `req.ip` / `req.ips` in a staging deployment.
   - IPv6 clients: the full address is hashed (:15-18), so an attacker with a /64 can rotate addresses to evade limits. Normalise to /64.
   - Mobile carrier CGNAT is common (relevant to Iranian operators): one shared `auth` bucket (login, signup, forgot-password, reset-password all use `authRateLimit`, routes/auth.route.js:10-13) lets one noisy user lock out others behind the same IP.
c) Double counting (VERIFIED): `trackCampaignClick` re-applies `apiRateLimit` (campaign.route.js:18), which is the same `name: "api"` counter already incremented by app.js:42-45, so click calls consume 2 units each. Cosmetic.
d) `/api/health` is excluded from the limiter (app.js:43); `/api/ready` is limited (see SEC-11).
- Safe verification: unit tests with a stubbed `redis.eval` that throws, calling the limiter 11 times across fresh `memoryWindows` (simulating separate instances); and a test that sets `req.ip` via `app.set("trust proxy",1)` plus a spoofed XFF when no proxy exists. For (b), only observe headers in your own staging environment.
- Remediation: fail closed (or at least much stricter, for example limit 3 per window) for the `auth` limiter when Redis is unavailable; add a per-account (hashed email) failed-login counter in Redis and exponential back-off; normalise IPv6 to /64; split buckets (login vs forgot/reset vs signup); confirm the effective client IP in the Vercel rewrite chain and, if needed, key on `x-vercel-forwarded-for` / `x-real-ip` explicitly; remove the duplicate limiter on the click route. Add alerting on the "degraded" log line.

### SEC-6 (Medium, VERIFIED): Newsletter subscribe/unsubscribe is unauthenticated and unverified

- Files: backend/controllers/newsletter.controller.js:23 (resubscribe sets `isSubscribed: true, unsubscribedAt: null`), :51 (unsubscribe), routes/newsletter.route.js:37-38; model backend/models/newsletter-subscriber.model.js.
- Evidence: `subscribeToNewsletter` accepts any email plus `consent:true` and upserts; `unsubscribeFromNewsletter` flips any address by email alone. There is no token, no confirmation mail and no HMAC. Responses are uniform, so there is no enumeration oracle (good).
- Impact:
  - Third-party consent forgery: anyone can subscribe someone else's address (spam-law / privacy exposure once email delivery is wired up; the code currently states delivery is not connected).
  - Opt-out override: a user who unsubscribed can be silently re-subscribed by anyone, because the upsert resets `unsubscribedAt` to null. This is a compliance issue (it defeats the opt-out).
  - Griefing: anyone can unsubscribe any known address (for example a competitor's, or a customer's).
  - Per-IP limit only (10 per minute, rate-limit.middleware.js:80-83), so list poisoning from many IPs is feasible.
- Safe verification: unit-level with a stubbed model, calling both handlers with an arbitrary email and asserting the update is applied with no token.
- Remediation: double opt-in (send a signed confirmation link with a random token stored hashed, activate only after confirmation); unsubscribe via signed per-subscriber token (HMAC of email + secret, or random token stored hashed) embedded in every mail; never reset `isSubscribed` to true for an address with `unsubscribedAt` set unless the confirmation flow completes. Frontend page /newsletter-unsubscribe currently only needs an email, which should become a token link.

### SEC-7 (Low, VERIFIED): Campaign `href` validation is bypassable with `/\host`

- Files: backend/controllers/campaign.controller.js:41-42 (`href.startsWith("/") && !href.startsWith("//")`), backend/models/campaign.model.js:17 (same check), api/share-preview.js (`renderCampaignContent`, same check), frontend/src/pages/HomePage.jsx:94 and frontend/src/pages/CampaignPage.jsx:108 (`<Link to={campaign.href}>`).
- Evidence: offline `new URL("/\\evil.example","https://shop.example").origin` returns `https://evil.example`, and `"/\t/evil.example"` also resolves to `https://evil.example`.
- Impact: an admin (or a compromised admin session) can store a campaign link that browsers resolve to an external host. React Router will normally intercept a normal click and fail with a pushState SecurityError, but ctrl/middle-click, the server-rendered link in share-preview HTML, and crawlers follow the real href. Open-redirect shape on a trusted domain (phishing). Admin-only, hence Low.
- Safe verification: unit test of `isValidCampaignInput({ href: "/\\evil.example", ... })` expecting rejection; `node -e` check as above.
- Remediation: validate with `new URL(href, "https://x.invalid")` and require `url.origin === "https://x.invalid"`, plus reject backslashes and control characters (`/[\\\u0000-\u001f]/`); apply the same function in the model validator and in share-preview.

### SEC-8 (Low, VERIFIED): Unbounded cache keys and uncached aggregation per category slug

- File: backend/controllers/product.controller.js:813 and :964-1035.
- Evidence: `const slug = String(req.params.category||"").trim().slice(0,96)` is used verbatim in `const facetCacheKey = "category_filter_facets_v2:" + slug;`. The slug need not exist (`getCategoryProductScope` returns null and the code falls back to `category: slug`). Each new slug runs the `$facet` aggregation (maxTimeMS 2500) and then `SET ... EX 120`.
- Impact: an anonymous client can create many Redis keys (up to 96 chars each, 2 min TTL) and force an aggregation for each (cache miss every time), bounded only by the 600 req/min/IP limit (SEC-5). Memory growth on a small managed Redis plan and DB load.
- Safe verification: unit test with a stubbed `redis.set` counting distinct keys across 1000 random slugs.
- Remediation: only cache when the slug resolves to a known category (scope non-null) or matches the legacy allowlist; validate slug with the same regex as the model (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`); return 404 early for unknown slugs; consider a hash of the full filter set rather than the raw slug.

### SEC-9 (Low, VERIFIED): Product image lifecycle and deletion

- File: backend/controllers/product.controller.js:750-757 (delete), :600-604 (update), :413 / :576 (uploads).
- Evidence: delete derives the public id with `product.image.split("/").pop().split(".")[0]` and calls `cloudinary.uploader.destroy("products/" + publicId)`. Only the primary image is destroyed. Update replaces `product.images` without removing replaced assets; create has no cleanup if `Product.create` fails after upload.
- Impact: (a) storage leak and stale public images remaining reachable after deletion; (b) public ids containing dots are truncated; (c) because `images` can contain any HTTPS URL (SEC-3), deleting a product whose `image` is `https://anywhere/x/abc.jpg` destroys `products/abc` belonging to a different product. Admin-only, hence Low.
- Remediation: reuse `deleteManagedCloudinaryImage(url, { folder: "products" })` (image-upload.js:158) for every URL in `images` on delete and for removed URLs on update, and after failed create. It already validates host, cloud name, folder and traversal (covered by tests/image-upload.test.js).

### SEC-10 (Low, VERIFIED): Over-exposed public data and state-changing GET

- Files: backend/controllers/product.controller.js:1103-1141 (bestsellers returns `soldQuantity`, `orderCount` via `$mergeObjects`, lines 1114/1131), :168-177 and :99-166 (full lean product documents incl. `stock`, per-variant `stock`, `isActive`, `__v`); backend/controllers/campaign.controller.js:83 (`$inc: { views: 1 }` on `GET /api/campaigns/:id`, returns `views`/`clicks`), :96-111 (public click counter); backend/controllers/category.controller.js:117 (returns whole category document).
- Impact: competitors can read exact sales quantities, order counts, exact inventory per variant and campaign performance. `GET /campaigns/:id` mutates data, so crawlers/prefetch/CSRF-style image tags can inflate `views` without any user action (no auth needed); `POST /campaigns/:id/click` is also unauthenticated and can be inflated within the rate limit. No credentials or emails are exposed on public routes; inactive products are correctly filtered (`isActive: { $ne: false }`) on every public product route, including the bestseller `$lookup` (:1125) and campaign population.
- Safe verification: unit-level; call the handlers with stubbed models and diff the JSON keys.
- Remediation: project public fields explicitly (drop `soldQuantity`, `orderCount`, exact stock beyond a boolean/"low" bucket, `views`, `clicks`, `__v`); count views via a non-GET endpoint or a separate beacon with de-duplication; keep analytics counters server-side only.

### SEC-11 (Low, VERIFIED): `/api/ready` is public and does work on every call

- File: backend/app.js:51-67, backend/lib/readiness.js:11-75 (`waitForRedisReady` at :11, called at :50).
- Evidence: unauthenticated `GET /api/ready` calls `connectDB()` and then waits up to 6 s (`waitForRedisReady(redisClient, 6000)`, readiness.js:11, called at :50) and returns `{status, database, redis}` with HTTP 503 when either dependency is down.
- Impact: low-grade information disclosure (dependency state, useful for timing attacks on outages) and a cheap amplification (each hit can hold a connection up to 6 s and triggers a Mongo reconnect attempt, bounded by the 600/min/IP limit). Error text is not leaked (good: only name/code are logged).
- Remediation: protect `/api/ready` with a shared secret header or Vercel cron/monitor only; keep `/api/health` public and trivial.

### SEC-12 (Low, VERIFIED / POTENTIAL): SEO function robustness

Files: seo/server-utils.js:12-20 and :68-81, api/share-preview.js:339 / :402 / :488, api/page-shell.js.
a) Host-derived self-fetch (POTENTIAL): `getRequestOrigin` builds the origin from the `Host` header and `x-forwarded-proto` (server-utils.js:12-20), and `fetchAppShell` does `fetch(new URL("/index.html", requestOrigin))` (:69), then injects the response into the HTML it serves (`renderHtmlShell`). On Vercel the Host must match a project domain, so this is not exploitable today. If the functions are ever run behind a proxy that forwards arbitrary Host values, this is an SSRF plus HTML-injection primitive (the fetched HTML is only checked for an empty `<div id="root">`). Remediation: build the shell URL from a configured origin (`PUBLIC_SITE_URL`) or from `VERCEL_URL`, never from request headers; keep the Host regex but also require it to match an allowlist.
b) Unhandled rejection (VERIFIED code path, reliability): share-preview.js:339 starts `shellPromise = fetchAppShell(...)` outside any try/catch and only awaits it later (:509, :533, :551). If the shell fetch fails before the API calls finish, Node reports an unhandled rejection, which on Node 15+ terminates the invocation (default `--unhandled-rejections=throw`). An attacker cannot force this directly, but any transient shell failure turns into a function crash instead of the intended 503 page. Remediation: `shellPromise.catch(() => null)` immediately, or await it inside the try.
c) Broken CR/LF filter (VERIFIED): `!/[\\r\\n]/.test(value)` (lines 402 and 488) is a regex that matches a literal backslash, `r` or `n`, not CR/LF. Any filter value containing the letter "r" or "n" (for example `brand`, `jeans`) is silently dropped from the preview API query, while real CR/LF would pass (harmless because `URLSearchParams` percent-encodes them). Functionality/SEO bug, no security impact. Fix: `/[\r\n]/`.
d) Output encoding review (VERIFIED, no issue): every interpolated value in share-preview.js and server-utils.js `renderHtmlShell` goes through `escapeHtml` (title, description, meta content, canonical, image, alt, href, labels), `encodeURIComponent` (ids/slugs in paths), `xmlEscape` (sitemaps) or `safeJson` (JSON-LD, escaping `<`, `>`, `&` so `</script>` cannot terminate the block). `absoluteUrlFor` only returns http/https URLs, so `javascript:`/`data:` in image or link fields are dropped. See "XSS review" below.
e) Cache-busting amplification (Info): SEO pages are cached (`s-maxage=60`) but a random query string bypasses the CDN entry, and each miss triggers one self-fetch of /index.html plus up to 3 backend calls (category pages forward filters, share-preview.js:397-407). Bounded by the global limiter only, and the SEO functions are outside `/api` rate limiting (they are separate Vercel functions without the Express limiter). Consider ignoring unknown query keys when building the cache key.

### SEC-13 (Low, VERIFIED): Expensive public queries

- File: backend/controllers/product.controller.js:101 (admin list, page <= 100000), :244 (search page <= 5000, limit <= 48), :948 (category page <= 100000, limit <= 60); regexes at :116-123, :272-283, :834-849.
- Evidence: a public category request with `page=100000&limit=60` makes Mongo skip 6,000,000 documents; search runs 4 case-insensitive unanchored regexes per token (up to 8 tokens) including on `description` (5000 chars).
- Impact: CPU-heavy queries; `maxTimeMS(1500)` converts overruns into 500s, so it degrades rather than hangs. All user input is passed through `escapeSearchRegex` (persian-search.js:32) so there is no ReDoS and no regex injection (see NoSQL review). Admin list page bound is also generous.
- Remediation: cap public `page` (for example 200) or move to keyset pagination (`_id`/`createdAt` cursor); use a text index or the already-computed `searchTextNormalized` only (drop raw `description` regex once backfill is complete); index `searchTextNormalized`.

### SEC-14 (Info, VERIFIED): Environment and secret handling

- No startup validation: `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` are read ad hoc (auth.controller.js:15, :19; auth.middleware.js:13). If unset, `jwt.sign` throws (login returns 500) and `jwt.verify` throws (every protected route returns 401). This fails closed (good) but is only discovered at request time. `MONGO_URI` missing throws in `connectDB` (db.js:17-18) giving 503s; Redis missing yields the fail-open limiter (SEC-5a) and failing sessions. Add a boot-time check that required vars exist and that the two JWT secrets differ and are >= 32 random bytes.
- `NODE_ENV !== "production"` adds `http://localhost:5173` and `http://127.0.0.1:5173` to the credentialed CORS allowlist (security.middleware.js:12-14) and disables the `secure` cookie flag (auth.controller.js:33, :39). Any non-Vercel deployment that forgets `NODE_ENV=production` silently gets both. Prefer an explicit `ALLOW_DEV_ORIGINS=true` flag.
- `RATE_LIMIT_KEY_SALT` defaults to a constant (rate-limit.middleware.js:16); the salt is only for privacy of Redis keys. Set it in production.
- `.gitignore:15` ignores `.env` only (matches at any depth); `.env.production`, `.env.local` (covered by `*.local`), `.vercel/` are not all covered. Add `.env.*` (except `.env.example`) and `.vercel`.
- Secrets in repo: none found (see below). CI uses GitHub secrets (`CRON_SECRET`, `PAYMENTS_API_URL`) correctly; the reconcile endpoint compares with `timingSafeEqual` and returns 503 when `CRON_SECRET` is unset (zarinpal.controller.js:729-735, outside this review's scope).
- Body-size: ordinary JSON limit 1 MB (app.js:94), content-management 10 MB (SEC-4). URL-encoded bodies are not parsed at all, so classic form-post CSRF payloads (text/plain, urlencoded) never populate `req.body`.

### SEC-15 (Info, VERIFIED): Logging and PII

- Audit log stores `ip`, `userAgent`, `requestHost`, referer path and full before/after snapshots with no TTL index (models/audit-log.model.js:25-27 only index `createdAt`, `action`, `actor`; lib/audit-log.js:89 stores `req.ip`). Define a retention period (for example a TTL index) and document it in the privacy policy.
- `console.log("MongoDB connected: <host>")` (db.js:40) prints the cluster hostname on every cold start; harmless but avoid in production logs. Error logging elsewhere is disciplined (messages only, connection strings never logged; `safeErrorMetadata` in app.js:27-34).
- Newsletter and auth logs contain no email or token values.

### SEC-16 (Info, VERIFIED): Misc

- `getSearchedProducts` uses `sortMap[req.query.sort] || sortMap.newest` (product.controller.js:298). `sort=__proto__` resolves to `Object.prototype` (truthy) and `sort=constructor` to a function; the first yields no sort, the second likely throws inside Mongoose and returns 500. No injection, but use `Object.hasOwn(sortMap, key)` (the by-category handler already uses explicit comparisons, :957-962).
- `createProduct` relies on the schema for max lengths (`name` 160, `description` 5000) while `updateProduct` checks them explicitly (:530); schema violations in create surface as a generic 500 (:462-465) instead of 400.
- Signup returns "User already exists" (auth.controller.js:52): classic account-enumeration oracle, independent of SEC-1. Login and forgot-password responses are uniform in text, but `forgotPassword` performs a DB write and an outbound email only when the account exists (:360-373), a timing oracle.
- `campaign.controller.js:50` accepts `mongoose.isValidObjectId` for `productIds`; this accepts numbers and 12-char strings, which later throw a CastError in `Product.find` (500) instead of a 400.
- Product `attributes` (no category selected) is stored as arbitrary nested `Mixed` with no size/depth limit (product.controller.js:327, :491; model line 61). Rendering is safe (React escapes) but the object is also copied into audit-log metadata; apply a size cap.

---

### Review of requested topics (no finding unless listed above)

#### NoSQL injection / mass assignment (excluding SEC-1)
- Product, category, campaign, newsletter, coupon, order, admin and service-case handlers coerce query/body fields to primitives before building filters (`typeof ... === "string"`, regex-validated ObjectIds, whitelisted enums). `req.query.q`, `category`, `stock`, `status`, `sort` are type-checked. `attributes` (category page) is JSON-parsed, length capped (2400), keys restricted to `^[a-zA-Z0-9_-]{1,64}$`, values restricted to string/number/boolean/array-of-strings (product.controller.js:916-945), so no operator object can reach Mongo. The only `$expr`/`$where` usage is static (:139-145). No `$where` anywhere.
- Regexes from user input: all pass through `escapeSearchRegex` (persian-search.js:32) before `new RegExp`, input is capped at 80/120 characters, so no regex injection or ReDoS. Verified the escape set covers `| \ { } ( ) [ ] ^ $ + * ? .`.
- Mass assignment: `createProduct`/`updateProduct` destructure a fixed field list and normalise every field (product.controller.js:312-315, :473-477). Category uses `validateCategoryInput` returning a whitelisted `value` object applied with `Object.assign` (category.controller.js:272). Campaign create copies named fields; update builds `next = {...current.toObject(), ...req.body}` (:209) but writes only named fields back (:236-244), so `views`, `clicks`, `slug`, `createdBy` cannot be set. `User.create({ name, email, password })` is explicit, so `role`/`permissions` cannot be injected at signup.
- Prototype pollution: no recursive merge, `lodash.merge`, or `Object.assign` of raw bodies onto shared objects. `JSON.parse` own `__proto__` keys are harmless in the spread/regex-keyed paths used.

#### XSS review
- React: `grep` for `dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document.write|eval(|new Function|srcdoc` over frontend/src returns no matches. JSON-LD is injected client-side with `script.textContent = JSON.stringify(...)` (PageMeta.jsx), which is safe. `window.location.assign(redirectUrl)` (OrderSummary.jsx:236) is guarded by `startsWith("https://")`; the URL comes from the backend. All `target="_blank"` links carry `rel="noopener noreferrer"` or `rel="noreferrer"` (StoreFooter.jsx:63/78, ProductEditForm.jsx:384, ProductsList.jsx:180).
- Footer social/eNAMAD URLs come from build-time `VITE_*` env vars and are rendered as `href`/`src`; operator-controlled, but add a protocol check (`https:` only) to prevent a `javascript:` value from reaching the DOM.
- Server HTML (share-preview, page-shell, server-utils): see SEC-12d; no unescaped interpolation found. Stored-content fields (product name/description/category/colors/sizes/fit, category name/description, campaign title/description/href/image) are escaped in text, attribute and JSON contexts.
- localStorage use is limited to cart/wishlist ids, theme and recently viewed products (useCartStore.js, useWishlistStore.js, Navbar.jsx, ProductDetailsPage.jsx); no tokens or PII. Tokens are httpOnly cookies. The guest cart/wishlist data is parsed with try/catch.

### CSRF / CORS
- Cookies: `httpOnly`, `secure` in production, `sameSite: "strict"` (auth.controller.js:31-42). State-changing methods are POST/PUT/PATCH/DELETE only (apart from SEC-10's counter and the payment gateway callback `GET /api/payments/zarinpal/verify`, covered by the payments reviewer).
- Origin middleware (security.middleware.js:70-90): write requests with an `Origin` outside the exact allowlist get 403; the string `"null"` normalises to empty and so is rejected; with no `Origin`, only `Sec-Fetch-Site: cross-site` is rejected. Residual bypass shapes I looked for and did not find as exploitable: (1) no-Origin writes from non-browser clients are allowed by design and carry no ambient cookies; (2) `same-site` sibling subdomains: browsers send `Origin` on those writes, which is not in the allowlist, so they are blocked; (3) `text/plain`/form posts are not parsed because only `express.json()` is mounted (app.js:93-94), and the CORS preflight handler only permits `Content-Type, X-Requested-With`.
- CORS: exact-origin Set match after `new URL().origin` normalisation (security.middleware.js:5-40); `Access-Control-Allow-Credentials` is set only for allowed origins (:68); `Vary: Origin` is set (:65); wildcard strings are rejected because `new URL("*")` throws. Disallowed-origin preflights get 403 (:73-75). OPTIONS responses bypass the rate limiter (middleware runs first), which is harmless.
- Theoretical gap: SameSite=Strict plus allowlist is solid; if the storefront and API ever move to sibling subdomains the Strict cookie would still be sent same-site, so keep relying on the Origin allowlist and do not loosen it to `*.example.com`.

### SSRF / open redirect
- Server-side fetches: `getApiJson` (base from `API_BASE_URL`/`VITE_API_URL`, path built with `encodeURIComponent`), `fetchAppShell` (SEC-12a), the Resend call in password-reset-email.js (fixed host), Zarinpal calls (payments reviewer). No user-supplied URL is fetched by the app itself. Cloudinary remote-URL fetch is the only user-influenced fetch (SEC-3).
- Redirects: no server-side `res.redirect` on user input found; frontend navigation uses router paths; only SEC-7.

### Headers
- API: nosniff, `X-Frame-Options: DENY`, strict-origin-when-cross-origin, permissions policy, restrictive CSP, HSTS only on `req.secure` in production (security.middleware.js:41-54). `x-powered-by` disabled (app.js:36). Covered by tests/security.middleware.test.js. The SPA gap is SEC-2.

### Upload validation (good controls)
- `validateImageDataUrl` (image-upload.js:95-117): strict data-URL regex limited to jpeg/png/webp/gif, canonical base64 round-trip, size cap, magic-byte check, parsed width/height with 8192 px and 40 MP caps. Cloudinary upload uses a fixed folder, `allowed_formats`, `unique_filename`, `overwrite:false`. Returned URL is re-checked for HTTPS. `getManagedCloudinaryPublicId` is strict (host, cloud, folder, decoded traversal checks). Tests cover these. The weakness is only that products do not use it (SEC-3).

### Public endpoint leakage
- Inactive/archived products, categories and campaigns are filtered on all public reads. No user data on public routes. Findings: SEC-10, SEC-11.

### Serverless/DB
- db.js caches the connection promise, resets it on `disconnected`, uses `maxPoolSize` 5 (1-20 override), `minPoolSize 0`, `maxIdleTimeMS 30000`, short selection timeouts; `connectDB` is awaited in the `/api` middleware (app.js:71-81) after the rate limiter, which is the right order. With many cold instances the total Atlas connections scale as instances x 5; keep an eye on the Atlas connection cap and consider lowering the pool to 1-2 on Vercel. Redis uses `enableOfflineQueue:false` and short timeouts so requests fail fast (and, per SEC-5a, the limiter fails open).

### Secrets in repo
- `git ls-files` shows only frontend/.env.example (placeholders). A regex sweep (Mongo/Redis URIs with credentials, AWS/Stripe-style keys, PEM blocks, JWTs, `*_SECRET=` assignments) over tracked files found matches only in README.md:165-166, docs/PERSIAN_COMMERCE_SETUP.md:29-30 (documentation placeholders; confirmed they contain "username/password/your/example/<..>" style text), backend/tests/readiness.test.js:78 (fake URL used to prove it is not logged) and backend/tests/refresh-token.test.js:17 (test fixture). No real secret values were observed; none were printed in this report. Git history contains no `.env` file (`git log --all --diff-filter=A` shows only frontend/.env.example).

### Good controls worth keeping
Strict type narrowing and bounded `clampInteger` pagination on nearly all list endpoints; consistent `maxTimeMS`; escaped regex search; whitelisted write fields; hardened image validation and Cloudinary asset-ownership checks (category/campaign); uniform error bodies (no stack traces, `error.message` only in server logs); generic 500 handler (app.js:112-122) with 413/400 JSON handling; cookie flags; Origin/Fetch-Metadata gate and exact CORS allowlist; JSON-LD and HTML escaping (`safeJson`, `escapeHtml`, `xmlEscape`); canonical-origin handling that never trusts the Host header for canonicals (server-utils.js:30-34); `timingSafeEqual` on the cron secret; HSTS emitted only for verified HTTPS.

## Suggested fix order
1. SEC-1 (type-check/sanitise login and signup input) and SEC-5a (fail-closed auth limiter + per-account counter).
2. SEC-3 and SEC-4 (route product images through `resolveImageReference`; move the 10 MB parser behind auth).
3. SEC-2 (headers/CSP in vercel.json) and SEC-6 (double opt-in and tokenised unsubscribe).
4. SEC-7 to SEC-13 as hygiene; SEC-14 to SEC-16 as backlog.

## C. Authentication / session findings (AUTH-*)

_The full AUTH write‑up, route matrix and role proposal are in report 05. Summary:_

### AUTH-1 (Medium, VERIFIED by reading; runtime POTENTIAL) - Login/signup accept operator objects and non-string passwords: targeting and enumeration oracle
- File: backend/controllers/auth.controller.js:46-50 (signup), 78-81 (login). No sanitiser anywhere (`grep sanitizeFilter|mongo-sanitize` = no hits).
- Evidence: `const { email, password } = req.body; const user = await User.findOne({ email });` then `user && (await user.comparePassword(password))`.
- Impact: (1) `email` can be `{"$gt":""}` / `{"$regex":...}`; the query matches the first/oldest user (typically the owner) without knowing the address, so the attacker only needs to guess a password. (2) If `password` is a non-string (e.g. number), bcryptjs rejects with "Illegal arguments" only when a user was found; a missing user short-circuits to 400. The catch returns 500 "Unable to sign in" (line 99-101), so 500 vs 400 is an account-existence oracle independent of the signup message. (3) Signup email has no format validation and `name` no length/type validation.
- Exploitability: any unauthenticated client, subject to AUTH-6 limits.
- Remediation: require `typeof email === "string"` and `typeof password === "string"` (400 otherwise), lowercase/trim, validate format and length on signup (name 2-100); optionally `mongoose.set("sanitizeFilter", true)`.

### AUTH-2 (Medium, VERIFIED) - Promoting a user to admin via the API without `permissions` creates a full "legacy" admin; re-promotion of a former admin does the same
- File: backend/controllers/admin.controller.js:129-131, 157-158; backend/middleware/auth.middleware.js:126-128; backend/models/user.model.js:71-74.
- Evidence: `const nextPermissions = permissions ?? target.permissions;` ... `if (nextRole === "customer") target.permissions = undefined; else if (permissions !== undefined) target.permissions = permissions;` and adminRoute: `if (!Array.isArray(granted)) return next();`.
- What a legacy admin (permissions undefined) gets: `next()` for every route that has a rule, i.e. all 33 admin endpoints, including PATCH /api/admin/customers/:id/access (roles.manage), audit-logs, operations, shipping PUT, CSV export. Only unmapped admin routes are denied (line 124, covered by a test). They also count as management-capable in the last-admin math (admin-permissions.js:3-6). Effectively identical to `["*"]`. Frontend: AdminPage.jsx:33-35 treats non-array as full access.
- Trigger: PATCH `{ "role": "admin" }` with no `permissions` key (the shipped UI always sends an array so the UI path is safe: CustomerManagement.jsx:50-53, draft permissions `[]` for non-admins at line 40). Demotion wipes permissions to undefined (line 157), so a later API-only re-promotion silently yields full access.
- Exploitability: needs roles.manage (or being a legacy admin); outcome is accidental over-privilege (fail-open default).
- Remediation: when `nextRole === "admin"` and the stored permissions are not an array, require `permissions` in the request (400) or default to `[]`; run a one-off migration converting existing legacy admins to explicit `["*"]` (or proper role sets), then delete the `!Array.isArray(granted)` branch and the legacy branches in `hasAdministratorManagementAccess`.

### AUTH-3 (Medium, VERIFIED) - `roles.manage` is equivalent to owner/`*`; no owner tier or hierarchy; a delegated admin can disable the owner
- File: backend/controllers/admin.controller.js:118-123, 132-149; lib/admin-permissions.js:3-16.
- Evidence: allowed set includes `"*"` and any value (line 86-90, 120); the only self guard is "cannot remove own management access" (132); nothing stops a roles.manage holder granting themselves or others `["*"]`, or demoting/deactivating an admin who holds `"*"` as long as the actor (counted in `otherActiveAdmins`, line 138-141) retains management access.
- Impact: a manager given roles.manage for "access administration" can escalate to every permission and can lock out the store owner. The UI lists roles.manage as an ordinary checkbox (CustomerManagement.jsx:11), which hides this.
- Exploitability: requires an existing roles.manage holder (insider/compromised delegate).
- Remediation: introduce an owner marker (e.g. `permissions` contains `"*"` only assignable by an existing owner; or `isOwner`), forbid non-owners from granting `*`/`roles.manage`/modifying owners, forbid roles.manage holders from editing their own permissions, and keep "at least one active owner".
- Lock analysis (checked): `withAdministratorAccessLock` fails CLOSED. Missing/unsupported client throws (admin-permissions.js:44-46), `redis.set` error throws `AdministratorAccessLockError` (53-57), timeout after 8 s throws (60), caught as 503 (admin.controller.js:178-181). When REDIS_URL is unset the stub `redis.set` throws (redis.js:9-12,28-35) so access changes return 503. Release is token-checked via Lua; release failure is only warned. Residual (Info): fixed 60 s TTL with no fencing token, so an operation exceeding 60 s could overlap; Vercel maxDuration is also 60 s. The lock protects only this endpoint (no DB-level invariant).

### AUTH-4 (Medium, VERIFIED) - Bulk PII read/exports are gated by broad permissions and are not audited; audit coverage gaps
- Files: backend/controllers/analytics.controller.js:86-101 (CSV with `customer_name`, `customer_email`, up to 10,000 orders, perm reports.view); newsletter.controller.js:62-69 (500 emails, marketing.manage); admin.controller.js:92-113 (customers list); order.controller.js:93-120; none call `recordAuditEvent` (audit calls exist only in admin.controller.js:170,258; shipping, coupon, product x7, category x3, campaign x3, order:187).
- Impact: an "analyst" (reports.view) can exfiltrate the customer email list with no trace; likewise marketing, customers.manage and orders.manage reads. Auth events (login success/failure for admins, password reset requests/completions, logout, refresh anomalies) are not recorded at all.
- Coverage verdict: write coverage of catalogue/marketing/settings/order/access/service-case = good; read-of-PII and security events = missing.
- Remediation: audit `analytics.export`, `newsletter.list`, `customers.list` (with search term and count only), `audit.view`; add admin login/failed login/password reset events (store IP, not password data); split a `reports.export` permission from `reports.view`.

### AUTH-5 (Medium, VERIFIED) - Audit logging failure is swallowed after the change is committed; access-change events lack before-state and target identity
- File: backend/lib/audit-log.js:98-100; backend/controllers/admin.controller.js:159-174.
- Evidence: `} catch (error) { console.error("Failed to record admin audit event:", error.message); }` and the call comes AFTER `await target.save()`.
- Impact: any privileged action (role grant, refund status, shipment) succeeds with no audit record if Mongo write fails/times out; there is no alert. `customer.access_updated` metadata is `{role,isActive,permissions}` only (admin.controller.js:173): no previous values, no target email, so a forensic reader cannot tell what was granted or removed (buildChangeSet only diffs when `before`/`after` are passed). Service-case update (258-262) likewise stores only post-state.
- Data stored (checked): actor id/name/role, action, target id, summary, free-form metadata, IP (`req.ip`), User-Agent, host, origin, referer origin+path (query stripped, audit-log.js:47-56), request id. No passwords/tokens/cookies are stored by the current callers; IP and UA are personal data (retention: no TTL index, audit-log.model.js:25-27, unbounded growth, no tamper-resistance beyond DB access).
- Remediation: for roles.manage and refund actions write the audit record first (or in the same transaction / outbox) and fail the request, or at least raise an alert; pass `before`/`after` so the diff is stored; add a retention policy.

### AUTH-6 (Medium, VERIFIED design; topology POTENTIAL) - Auth brute-force controls are weak: one shared per-IP bucket, no per-account limit, per-instance memory fallback
- Files: backend/routes/auth.route.js:10-13; backend/middleware/rate-limit.middleware.js:47-55, 71-74; backend/app.js:37.
- Evidence: signup, login, forgot-password and reset-password all use the same `authRateLimit` (`name:"auth", limit:10, windowSeconds:900`), key = hash(req.ip) only. On Redis error: "Keeps the storefront serving ... per-instance fallback ... does not provide global coordination".
- Impact: (a) distributed guessing against one account is never throttled (no account/email lockout or backoff); (b) mobile CGNAT users share one 10-requests/15-min budget across all four endpoints; (c) when Redis is degraded the limiter fails open to per-instance memory, which on serverless/Vercel multiplies the allowance; and in that state a correct password makes login return 500 (storeRefreshToken throws, line 87) vs 400 for wrong passwords, a success oracle; (d) `trust proxy 1` is correct only with exactly one proxy hop; with CDN + Vercel all users share the proxy IP (global lockout) and with zero proxies `X-Forwarded-For` is spoofable (POTENTIAL, deployment-dependent).
- Remediation: separate buckets per endpoint; add a second key on normalized email (e.g. 5 failures / 15 min) with incremental delay; fail closed (or tight global limit) for auth routes when Redis is down; log/alert on fallback; confirm hop count.

### AUTH-7 (Low, VERIFIED) - Account enumeration and email flooding
- Signup: auth.controller.js:52-54 `return res.status(400).json({ message: "User already exists" })`.
- Login timing: auth.controller.js:81 short-circuits when no user, skipping bcrypt (cost 10, user.model.js:87), so unknown emails respond measurably faster. Inactive-account message (82-84) is only returned after a correct password (checked, acceptable).
- Forgot-password: response text is generic (105, 377) and mail failure is hidden (366-375), but the existing-user path does `user.save()` plus an outbound Resend call (361-367) while unknown emails return immediately, a timing oracle; 503 for unconfigured mail (356-358) leaks config state only. No per-email throttle: each request overwrites the stored token (invalidating a legitimate pending link) and sends mail, limited only by AUTH-6's per-IP budget.
- Remediation: uniform signup message with email-based completion, or accept signup enumeration with rate limits; compare against a dummy hash for unknown emails; send the email asynchronously/after responding; per-email cooldown (e.g. 1 mail / 60 s, reuse a valid unexpired token).

### AUTH-8 (Low, VERIFIED) - Refresh-token design: no reuse detection, single global slot, multi-tab race, token stored in plaintext
- Files: auth.controller.js:26-28, 474-484; lib/refresh-token.js:18-31.
- Rotation (checked): atomic Lua compare-and-set on `refresh_token:<userId>`, TTL 7 d, signature + expiry verified first, `isActive` re-checked from DB (455-471), Redis down -> 503 (fail closed), deactivation deletes the key (admin.controller.js:153,162).
- Gaps: (1) mismatch just returns 401 and clears cookies (480-484); a replayed old token is not treated as theft (no family revocation, no audit/alert). If an attacker uses a stolen current token first, the victim is silently logged out and the attacker's session persists. (2) One key per user: logging in on a second device overwrites the first device's token (line 87-88), killing that session on its next refresh. (3) Two tabs refreshing concurrently with the same cookie: the loser gets 401 and the frontend interceptor calls `logout()` (useUserStore.js: `void useUserStore.getState().logout()`), which deletes the winner's token too. The in-tab coordinator (refresh-coordinator.js) does not cover multiple tabs. (4) Stored value is the raw JWT, readable by anyone with Redis read access; store a SHA-256 or a random jti.
- Remediation: key by `userId:jti` (set of sessions) or keep one but on valid-signature mismatch delete the key and log an event; add a short (e.g. 10-30 s) grace window for the previous token; store hashes.

### AUTH-9 (Low, VERIFIED) - Access tokens survive logout/password reset for up to 15 min; reset revocation is not atomic with the password change
- Files: auth.middleware.js:13-20; auth.controller.js:397-404, 411-424.
- Evidence: protectRoute checks signature, then loads the user and checks `isActive` only; there is no token-version / `passwordChangedAt` comparison. `resetPassword` saves the password (400) and then `await redis.del(...)` (401); if Redis throws, the catch returns 500 but the password is already changed and the old refresh token stays valid for up to 7 d. Reset token consume is find-then-save (non-atomic), so two simultaneous requests with the same token can both succeed (negligible impact).
- Checked, no issue: reset token = 32 random bytes (362), only SHA-256 stored (363), 30 min expiry enforced in the query (394), cleared on use (398-399), strict `^[a-f0-9]{64}$` format check (387), link host from env APP_URL/FRONTEND_URL not from the Host header (password-reset-email.js:10), token left in the page URL by the frontend (ResetPasswordPage.jsx:10, no `replaceState`) is minor (Info).
- Permission/role/deactivation changes DO take effect immediately: protectRoute reloads the user per request (auth.middleware.js:14) and adminRoute reads `req.user.role/permissions` from that fresh document; deactivation yields 401 on the next request.
- Remediation: add `tokenVersion` (or `passwordChangedAt`) to the user and put it in the access JWT; do the Redis delete before/with the save and treat failure as an error that rolls back or retries.

### AUTH-10 (Low, VERIFIED code / env POTENTIAL) - JWT and cookie hardening gaps
- File: auth.controller.js:14-24, 30-43; auth.middleware.js:13; auth.controller.js:416, refresh-token.js:9.
- JWT: `jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET)` without `{ algorithms: ["HS256"] }` (jsonwebtoken ^9 restricts to HMAC for string secrets and rejects `none`, so currently safe but unpinned); no `iss/aud/jti`; access and refresh payloads are identical `{userId}`, and there is no startup check that both secrets exist, are long, and differ. If an operator sets them equal (README only says "different"), a 7-day refresh JWT is accepted as an access cookie. Missing secrets fail closed (sign/verify throw).
- Cookies (checked): `httpOnly: true`, `sameSite: "strict"`, `secure: NODE_ENV === "production"` (POTENTIAL: if NODE_ENV is not "production" in a deployed env the Secure flag is dropped), maxAge 15 min / 7 d, host-only (no Domain). Gap: no `path` scoping, so the refresh cookie is sent on every request; scope it to `/api/auth`. `clearCookie` without matching options works because path/domain are default.
- Remediation: pin algorithms, add issuer/audience, validate env at boot (length >= 32, distinct), set refresh cookie `path: "/api/auth"`, force `secure` unless explicitly local.

### AUTH-11 (Medium, VERIFIED) - Frontend vs backend permission disagreements
Files: frontend/src/pages/AdminPage.jsx:36-37,40,45,51,90; components/DashboardOverview.jsx:11-15; CampaignManager.jsx:39; CustomerManagement.jsx:37-41,50.
1. Dashboard tab is gated by `reports.view` (AdminPage.jsx:36) but DashboardOverview fans out to four endpoints with four different permissions: `/analytics` (reports.view), `/orders/admin` (orders.manage), `/products?stock=out_of_stock` (catalogue.manage), `/admin/operations` (system.view). A reports.view-only analyst sees three error cards; an orders-only user cannot see the dashboard at all.
2. Customers tab visible to `customers.manage` or `roles.manage` (line 37) matches the dynamic GET rule, but the component always renders role/active/permission editors and a Save button; for customers.manage-only users the PATCH returns 403 (rule line 73 = roles.manage). Also GET /customers returns every admin's `permissions` array to customers.manage holders (admin.controller.js:104).
3. CampaignManager (marketing.manage) loads the product picker from `GET /products` (CampaignManager.jsx:39), which needs catalogue.manage; marketing-only staff cannot attach products.
4. AdminPage fetches `/orders/admin` on mount for every admin (lines 45, 51) to show the packing badge; admins without orders.manage generate a 403 on every page load.
5. For an admin with zero matching permissions `tabs` is empty, `initialTab` falls back to "dashboard" (line 40) and DashboardOverview still renders (line 90); UI shows errors, backend still blocks. While the profile is loading (`adminPermissions === null`) all tabs are shown (line 35).
6. Client-side `user.role === "admin"` route guard (App.jsx:58) is cosmetic; backend is authoritative (checked, no issue). `/secret-dashboard` obscurity is not a control.
7. Legacy admins: frontend maps undefined permissions to full access in both AdminPage (35) and CustomerManagement.draftFor (40); consistent with backend (AUTH-2).
- Remediation: give the dashboard per-widget permission checks (hide widgets lacking the permission), hide the editors unless roles.manage, add a read-only product list endpoint for marketing or allow marketing.manage on a narrow catalogue read, gate the packing badge on orders.manage.

### AUTH-12 (Low, VERIFIED) - Permission names do not match what they grant
- `inventory.manage` only unlocks the read-only alerts list (rule line 76) while stock writes need `catalogue.manage` (rules 44, 47): a "fulfilment/inventory" user can see low stock but cannot fix it.
- `customers.manage` grants only the customer list (and admins' permission arrays), nothing to "manage".
- `system.view` and `audit.view` are read-only (naming consistent) but `audit.view` reveals IP/UA of all admins.
- `support.manage` includes approving/processing refunds (admin.controller.js:241-247, 251-256) with no separation of duties; `refundAmount` is capped to `order.totalAmount` only when an order exists (line 238), no cumulative cap across multiple updates, and `processed` needs only a non-empty free-text reference.
- `reports.view` includes the PII CSV export (AUTH-4).
- Remediation: see section 4 (rename/merge), add `refunds.manage` (or owner-only) for `refundStatus` changes.

### AUTH-13 (Info, VERIFIED) - Permission matcher normalises differently from Express; no router-vs-rules test
- File: auth.middleware.js:81-96. `normalizeRoutePath` converts `\` to `/` and drops empty segments, which Express does not. Today no exploitable divergence exists (each mounted method pair that could be confused shares the same permission, or falls through to "no rule" -> 403), but it is a latent footgun if two same-method routes under one base ever have different permissions. Tests (admin-permissions.test.js) do not walk `app._router` to assert each adminRoute route resolves a rule.
- Remediation: do not rewrite backslashes; add a test enumerating the real routers and failing on unmapped adminRoute routes; better, attach the permission at the route (`requirePermission("orders.manage")`) so route and rule cannot drift.

### AUTH-14 (Info, VERIFIED) - No second factor or step-up for privileged accounts; no email verification
- Admin accounts authenticate by password only; account recovery is email-link only (docs/password-recovery.md:21 says email verification is deliberately not enabled). With refund and role powers, an admin mailbox compromise equals store compromise. Also, a squatter can pre-register someone else's email (no verification) until the owner uses reset. Recommend TOTP for `role=admin` and email verification before checkout/refund eligibility. Password policy (password-policy.js) is solid: 12+ chars, 72-byte bcrypt cap enforced, common-pattern block; bcryptjs cost 10 is the minimum acceptable (raise to 12).

### AUTH-15 (Info, VERIFIED) - Minor
- protectRoute maps any exception, including a database failure on `User.findById`, to 401 "Invalid access token" (auth.middleware.js:29-32), which makes the frontend refresh/logout on a transient DB error.
- POST /api/newsletter/unsubscribe has no ownership proof (anyone can unsubscribe any address). Customer service-case creation with `type: "support"` has no per-user cap (service-case.controller.js:47) beyond the 600/min global limiter.


# 05 — Admin panel, RBAC and authentication audit

> Evidence: code review of auth/RBAC files by a read-only reviewer; the matrix (§1) was derived by enumerating every router file. I re-verified AUTH-1 by execution (Mongoose casts operator objects, see report 09 #11). Runtime behaviour of the rest is **POTENTIAL** — there was no database to run against. The admin UI was not rendered.

Repo: /home/user/itswanheda/mern-ecommerce. All paths below are relative to it. Line numbers verified against `cat -n`. No secret values were read or printed. Runtime behaviour (Mongoose casting, Redis outages, proxy topology) was NOT executed; those are marked POTENTIAL.

## 0. Summary
- 6 Medium, 6 Low, 3 Info findings. No Critical/High: the permission engine itself is sound (every adminRoute route has a rule, 1:1, fail-closed on unknown routes, user reloaded from DB on every request).
- Biggest practical risks: (a) API-created admins without `permissions` become full "legacy" admins (AUTH-2); (b) `roles.manage` is equivalent to owner/`*` and nothing protects the owner (AUTH-3); (c) login accepts operator objects / non-string password, giving an enumeration oracle (AUTH-1); (d) sensitive PII exports and privileged changes are weakly audited and audit failure is swallowed (AUTH-4/5); (e) auth rate limiting is per-IP, one shared bucket, and falls back to per-instance memory (AUTH-6).

## 1. Endpoint-to-permission matrix (from real code)
Mounts: `backend/app.js:97-109`. Global before routes: `apiRateLimit` 600/min/IP on `/api/*` (app.js:42-45), JSON parsers, cookieParser. "PR" = protectRoute, "AR" = adminRoute. Permission = result of `resolveAdminPermission(req.baseUrl, req.method, req.path)` against `ADMIN_PERMISSION_RULES` (auth.middleware.js:35-79), where baseUrl is the mount path and path is the router-relative path.

### 1.1 Admin routes (PR + AR). All 33 have a rule; all 33 rules map to a route (bijection, no orphan, no missing)
| Method | Full path | Middleware chain | Permission (rule line) | Ownership/other |
|---|---|---|---|---|
| GET | /api/analytics/ | PR, AR | reports.view (36) | none |
| GET | /api/analytics/export | PR, AR | reports.view (37) | none (exports customer name+email, see AUTH-4) |
| GET | /api/orders/admin | PR, AR | orders.manage (38) | none |
| PATCH | /api/orders/:id/shipment | PR, AR | orders.manage (39) | none; status state machine in controller |
| GET | /api/products/ | PR, AR | catalogue.manage (42) | none |
| POST | /api/products/ | PR, AR | catalogue.manage (43) | |
| PATCH | /api/products/:id/stock | PR, AR | catalogue.manage (44) | |
| PUT | /api/products/:id | PR, AR | catalogue.manage (45) | |
| PATCH | /api/products/:id/active | PR, AR | catalogue.manage (46) | |
| PATCH | /api/products/:id/variant-stock | PR, AR | catalogue.manage (47) | |
| PATCH | /api/products/:id | PR, AR | catalogue.manage (48) | toggleFeatured |
| DELETE | /api/products/:id | PR, AR | catalogue.manage (49) | |
| GET | /api/categories/admin | PR, AR | catalogue.manage (50) | |
| POST | /api/categories/ | PR, AR | catalogue.manage (51) | |
| PATCH | /api/categories/:id | PR, AR | catalogue.manage (52) | |
| DELETE | /api/categories/:id | PR, AR | catalogue.manage (53) | |
| GET | /api/campaigns/admin | PR, AR | marketing.manage (55) | |
| POST | /api/campaigns/ | PR, AR | marketing.manage (56) | |
| PATCH | /api/campaigns/:id | PR, AR | marketing.manage (57) | |
| DELETE | /api/campaigns/:id | PR, AR | marketing.manage (58) | |
| GET | /api/coupons/admin | PR, AR | marketing.manage (59) | |
| POST | /api/coupons/ | PR, AR | marketing.manage (60) | |
| PATCH | /api/coupons/:id | PR, AR | marketing.manage (61) | |
| DELETE | /api/coupons/:id | PR, AR | marketing.manage (62) | |
| GET | /api/newsletter/admin | PR, AR | marketing.manage (63) | lists subscriber emails (limit 500) |
| PUT | /api/shipping/ | PR, AR | settings.manage (64) | |
| GET | /api/admin/customers | PR, AR | dynamic: roles.manage if held else customers.manage (66-72) | lists all users incl. admins' `permissions` |
| PATCH | /api/admin/customers/:id/access | PR, AR | roles.manage (73) | Redis lock + self/last-admin guards |
| GET | /api/admin/service-cases | PR, AR | support.manage (74) | |
| PATCH | /api/admin/service-cases/:id | PR, AR | support.manage (75) | refund fields, see AUTH-12 |
| GET | /api/admin/inventory | PR, AR | inventory.manage (76) | |
| GET | /api/admin/audit-logs | PR, AR | audit.view (77) | |
| GET | /api/admin/operations | PR, AR | system.view (78) | |
(33 routes, 33 rules, verified one by one.)

### 1.2 Authenticated, non-admin routes (PR only)
| Method | Full path | Chain | Perm | Ownership check |
|---|---|---|---|---|
| GET | /api/auth/profile | PR | none | req.user._id (auth.controller.js:495) |
| PATCH | /api/auth/profile | PR | none | req.user._id; only `name` accepted (209-217) |
| PATCH | /api/auth/profile/default-address | PR | none | req.user._id, normalized fields only |
| POST | /api/auth/profile/addresses | PR | none | req.user._id, max 10 |
| PATCH | /api/auth/profile/addresses/:addressId | PR | none | subdoc `.id()` on own user (295) |
| PATCH | /api/auth/profile/addresses/:addressId/default | PR | none | own subdoc (315) |
| DELETE | /api/auth/profile/addresses/:addressId | PR | none | own subdoc (333) |
| GET | /api/cart/ | PR | none | req.user.cartItems |
| POST | /api/cart/merge | PR | none | req.user |
| POST | /api/cart/ | PR | none | req.user |
| DELETE | /api/cart/ | PR | none | req.user |
| PUT | /api/cart/:id | PR | none | :id is a product id inside req.user.cartItems |
| POST | /api/coupons/validate | PR | none | computed from req.user cart |
| GET | /api/orders/mine | PR | none | filter `user: req.user._id` (order.controller.js:75) |
| GET | /api/payments/zarinpal/order/:orderId | PR | none | `Order.findOne({_id, user: req.user._id})` (zarinpal.controller.js:680-685) |
| POST | /api/payments/create-checkout | checkoutRateLimit(12/min), PR | none | req.user cart |
| GET | /api/service-cases/ | router.use(PR) | none | filter `user: req.user._id` (service-case.controller.js:14) |
| POST | /api/service-cases/ | PR | none | `Order.findOne({_id, user: req.user._id,...})` (38) |

### 1.3 Public / special-auth routes
| Method | Full path | Chain | Note |
|---|---|---|---|
| POST | /api/auth/signup | authRateLimit | role cannot be supplied (AUTH ok); see AUTH-1/7 |
| POST | /api/auth/login | authRateLimit | AUTH-1/6/7 |
| POST | /api/auth/forgot-password | authRateLimit | AUTH-7 |
| POST | /api/auth/reset-password | authRateLimit | AUTH-9 |
| POST | /api/auth/logout | none (global only) | clears cookies, deletes refresh key if token valid |
| POST | /api/auth/refresh-token | refreshTokenRateLimit 60/min | AUTH-8 |
| GET | /api/payments/provider | none | public config |
| GET | /api/payments/zarinpal/verify | none | gateway callback (SameSite=Strict cookies not sent cross-site; route does not use them) |
| GET | /api/payments/reconcile-pending | none; CRON_SECRET bearer, timingSafeEqual, 503 if unset (zarinpal.controller.js:728-737), Redis lock | checked, no issue (length-leak only) |
| GET | /api/campaigns/, /api/campaigns/:id | none | :id only returns active, in-window campaigns (campaign.controller.js:78-82) |
| POST | /api/campaigns/:id/click | apiRateLimit | |
| GET | /api/categories/, /api/categories/:slug | none | |
| GET | /api/products/{price-bounds,search,bestsellers,newest,featured,category/:category,recommendations,:id} | none | :id filters `isActive != false` (product.controller.js:170) |
| GET | /api/shipping/ | none | quote |
| POST | /api/newsletter/subscribe, /unsubscribe | newsletterRateLimit | unsubscribe has no ownership token (anyone can unsubscribe any email; Info, same generic response) |
| GET | /api/health, /api/ready | none | |

### 1.4 Matrix checks
- Admin-ish route lacking adminRoute: none found. Every `/admin` suffixed route and every mutating catalogue/marketing/shipping/order/admin route has `protectRoute, adminRoute`. `/api/payments/reconcile-pending` is intentionally cron-secret protected.
- adminRoute route with no rule (would 403 even for owner): none. Verified each of the 33 chain entries against rules table by method + base + segment-wise template match (auth.middleware.js:87-96). Trailing slash is normalised; `:param` matches any non-empty segment.
- Rule with no route: none.
- Rule/route mismatch: none in the table; semantic mismatches are in AUTH-11/12.
- Matching semantics: `req.baseUrl` is case-preserving, so `/API/PRODUCTS/...` or `/api/Products/..` fail the exact-string base compare and get 403 (fail closed; no bypass). Router-relative `req.path` excludes the query string.
- Tests: `backend/tests/admin-permissions.test.js` covers adminRoute with synthetic requests only; no test iterates the real router stacks against the rules, so drift (a new route lacking a rule) is only caught at runtime as a 403 (AUTH-13).

## 2. Findings

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

## 3. Checklist results
| Item | Result |
|---|---|
| JWT secret handling, expiry | access 15 m, refresh 7 d; secrets only from env, fail closed if missing; no boot validation (AUTH-10) |
| Algorithm pinning | not pinned, safe by library default (AUTH-10) |
| Cookie flags | httpOnly, SameSite=Strict, Secure in production; no path scope (AUTH-10) |
| Refresh storage/rotation/reuse detection | atomic rotation yes; reuse detection no; plaintext; single slot (AUTH-8) |
| Invalidation on reset / deactivation / permission change | reset: refresh deleted, access lives <=15 m (AUTH-9); deactivation: refresh deleted + immediate 401 via DB check; permission change: immediate (user reloaded each request) but no session revocation needed |
| Legacy admins | full access on all 33 mapped routes, denied on unmapped (AUTH-2) |
| Signup can set role | no: only name/email/password destructured (auth.controller.js:46,55); checked, no issue |
| Mass assignment updateProfile/addresses | only `name` / normalized address fields; checked, no issue (209-217, 118-127) |
| Account enumeration | signup explicit, login timing + 500 oracle, forgot timing (AUTH-1/7) |
| Reset token handling | hashed, 30 min, single use, strict format; minor non-atomic consume (AUTH-9) |
| Rate limits per route | auth 10/15 min shared; refresh 60/min; checkout 12/min; newsletter 10/min; global 600/min; no rate limit on logout/profile beyond global (AUTH-6) |
| IDOR/BOLA orders, addresses, cart, service-cases, payment status | all scoped by `req.user._id` in the query or on the user's own subdocuments; checked, no issue |
| Last-admin/owner protection | present for self and last manager under a Redis lock that fails closed; no owner tier (AUTH-3) |
| Audit coverage / data / failure mode | AUTH-4, AUTH-5 |
| CSRF | SameSite=Strict + Origin allowlist + Sec-Fetch-Site check (security.middleware.js:84-91); checked, no issue |

## 4. Roles proposal
Are named roles needed? Yes as presets, not as a new enforcement layer. A shop with owner + staff will otherwise hand-tick 12 checkboxes, which already produced the legacy/over-grant risks (AUTH-2/3). Keep `permissions[]` as the single source of truth; add a server-side constant `ROLE_PRESETS` and an `adminRole` label stored for display, so changing a preset never silently changes existing admins.

Minimal safe model (permissions after the simplification below):
| Role | Permissions |
|---|---|
| owner | `*` (only role able to grant `*`/`roles.manage` or edit another owner; at least one active owner, replaces the roles.manage last-admin math) |
| manager | catalogue.manage, orders.manage, support.manage, marketing.manage, reports.view, settings.manage, audit.view (no roles.manage, no `*`) |
| catalogue editor | catalogue.manage |
| fulfillment | orders.manage, catalogue.view-stock (see below) |
| support | support.manage, customers.view |
| marketing | marketing.manage, catalogue.view (read) |
| analyst | reports.view (aggregates only; exports need `reports.export`, owner/manager) |

Simplifying the 11 permissions (+ `*`): (1) fold `inventory.manage` into `catalogue.manage` (stock writes already require it, AUTH-12), or keep it only as a read-only `catalogue.view`; (2) rename `customers.manage` to `customers.view` or merge into `support.manage` (it only lists customers) and stop returning admin `permissions` to it; (3) merge `system.view` into `audit.view` (both read-only operations visibility), leaving 8 effective permissions: `catalogue.manage`, `orders.manage`, `support.manage`, `marketing.manage`, `reports.view`, `settings.manage`, `audit.view`, `roles.manage` (owner-only). Add two narrow ones only if needed: `reports.export` (PII CSV) and `refunds.manage`. Then replace the `*` string with the owner flag so "all permissions" cannot be granted by a delegated admin. Also bind permission to routes with `requirePermission()` middleware to remove the separate rules table (AUTH-13).

## 5. Out of scope / not verifiable
- Actual Mongoose casting of operator objects at runtime, Redis outage behavior, proxy hop count and NODE_ENV in production: not executed (marked POTENTIAL).
- CSV formula injection in `csvCell`, product/campaign controller internals beyond auth, and frontend pages other than those listed were not audited here.

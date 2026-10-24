# 04 — Functional, business‑logic and frontend audit

## 1. What was and was not tested
No MongoDB was obtainable in the sandbox (see report 09), so **no user journey was executed end to end**. Test status below is "unit/CI tests I ran" plus "code‑traced by reviewers".

| Journey | Tests run | Code‑traced | Verdict |
|---|---|---|---|
| Browse / search / filter / product detail | persian‑search unit tests pass | yes (product.controller, ShopPage, CategoryPage) | Looks complete; regex/pagination notes SEC‑8/13; **not run** |
| Register / login / logout / session renewal | refresh-token unit tests (backend) + refresh-flow tests (frontend) pass | yes | Works by design; defects: AUTH‑1 (operator injection), AUTH‑8 (multi‑tab refresh logs you out), FE‑1 (refresh unmounts app), FE‑2 (3 failing calls per anonymous visit); **not run** |
| Cart + wishlist | none | yes | Cart is server‑backed + guest merge; wishlist is device‑only (FE‑10); lost‑update risk in cart store (FE‑8); **not run** |
| Checkout, coupons, shipping, inventory | coupon & inventory pure‑logic tests pass; **10 integration tests skipped (need Mongo replica set)** | yes | Pricing/stock reservation design is strong; reconciliation defects BIZ‑1/2/3; no per‑user coupon cap (BIZ‑7); **not run** |
| Zarinpal initiate → callback → finalize | payment‑reconciliation unit tests pass | yes | **Never exercised against Zarinpal sandbox**; see BIZ‑1/2 |
| Order history, account/addresses | none | yes | Ownership checks correct (AUTH checklist); **not run** |
| Admin auth + dashboard + management | admin‑permissions unit tests pass | yes (all 33 admin routes) | Permission engine sound; UI/permission mismatches AUTH‑11; **not run** |
| Error/loading/empty states, interrupted operations | partial (readiness tests) | yes | Reconciler covers crash recovery in design; defects above |

Test suites run: backend 63 tests (53 pass, 10 skipped), frontend 23 pass, backend build‑script subset 46 pass; lint fails (23 errors) and is not in CI. Not covered by any test: checkout, verify callback, reconcile endpoint, `finalizePaidOrder`, coupon races at API level, cart, refunds, auth controller, product/category/campaign controllers, all React components, `iranian-date`, `commerce`, the cart store (reviewers' grep; I confirmed the test file list: 13 backend + 4 frontend test files).
CI note: `.github/workflows/ci.yml` runs `npm test` **without Mongo**, so all 10 integration tests are skipped there; `feature-validation.yml` runs them against a MongoDB 7 replica set on pushes to listed branches. A green main CI therefore does not mean stock/coupon concurrency was tested.

## 2. Feature inventory (from source)
Storefront: home, shop, category (facets, price bounds), collections ("looks", new arrivals, bestsellers, featured), product details with variants (size/colour), recommendations, search suggestions with Persian normalisation, cart, wishlist (localStorage), checkout via Zarinpal, order tracking, profile & up to 10 saved addresses, password reset by email (Resend), newsletter, store‑policy pages, SEO share previews and sitemaps (Vercel functions).
Admin: dashboard, analytics (+CSV export), product/category/campaign/coupon CRUD, stock & variant stock, orders queue with shipment state machine, service cases (support/return/refund bookkeeping), customers & access, inventory alerts, shipping settings, newsletter list, audit log, operations dashboard.
Missing / incomplete: no refund execution via Zarinpal (bookkeeping only — documented), no order‑confirmation email found (the only mail module is `lib/password-reset-email.js`, by grep), no tax/VAT handling found by grep, no stock‑movement history found by grep, no admin MFA, no email verification, no i18n (not needed), no automatic scheduler (GitHub Actions cron every 5 min only).

## 3. Business logic and data integrity (Phase 4)
Reviewer's end‑to‑end trace, verdict table, "done well" and test‑gap lists follow verbatim. I personally verified BIZ‑3 by execution (object‑spread overwrite) and BIZ‑1's code path (`payload.data.code` at `zarinpal.controller.js:617`; request path reads `payload.errors.code` at `:475`). **Whether Zarinpal returns verify errors under `errors.code` must be confirmed in the Zarinpal sandbox** — I could not check.

### Commerce integrity review (payments, inventory, coupons, reconciliation)

Scope: read-only review of `/home/user/itswanheda/mern-ecommerce`. All paths below are relative to that root. Line numbers were checked with grep -n/Read. No secret values were read or printed.

Status legend: VERIFIED = proven from code in repo (or by executing a pure function); POTENTIAL = depends on runtime/provider behaviour; NOT VERIFIABLE = needs live Zarinpal or a replica set.

### 1. Flow as implemented

1. The client never sends prices or quantities. `POST /api/payments/create-checkout` (`backend/routes/payment.route.js:17`: rate limit, then `protectRoute`) reads the server-held `req.user.cartItems` (`zarinpal.controller.js:264`).
2. The cart is validated: integer quantity 1..100, safe-integer price, inventory configured, variant found (`:270-284`).
3. One Mongo transaction (`:310-397`) does all of the following:
   - re-reads products and compares the price snapshot (`:313-327`);
   - reserves the coupon (`:345`);
   - reads shipping settings (`:357`);
   - decrements stock with conditional `findOneAndUpdate` (`:367`, defined at `:187-242`);
   - creates the pending Order with `expiresAt = now+30min` (`:368-387`).
4. After commit, the order is set to `in_flight` and Zarinpal `request.json` is called with `amount = totalToman*10` (`:430-448`). The authority is saved (`:461`) and the client is redirected to a fixed Zarinpal base plus the encoded authority (`:469`).
5. The callback is `GET /api/payments/zarinpal/verify?Authority&order_id` (`:577`), unauthenticated.
   - It looks the order up by `_id` plus the stored unique authority (`:588-593`).
   - It calls `verify.json` with the DB amount (`:606-615`).
   - A compare-and-set `pending -> paid` (`:639-653`) runs, then `finalizePaidOrder` (`:158`).
6. The cron `GET /api/payments/reconcile-pending` (`:728`) runs three phases (stranded failed/expired, unfinalized paid, expired pending), each limited to a batch of 5.

### 2. Findings

#### BIZ-1 HIGH, VERIFIED (code path), provider format to confirm in sandbox: Zarinpal error codes are read from the wrong field, so "not paid" is never recognised and abandoned or cancelled payments keep stock and coupons reserved forever

- Where: `zarinpal.controller.js:617` and `:861` (`const code = payload?.data?.code;`).
- Contrast: the request path correctly reads errors from `payload?.errors?.code` (`:475`).
- Evidence:
  - The terminal-unpaid handling at `:623-637` and `:897-907` only runs when `code` is a finite integer.
  - Zarinpal v4 returns failures as `{"data":[],"errors":{"code":-51,...}}`. On those responses `data.code` is `undefined`, so `!Number.isInteger(code)` is true. The verify callback then redirects to `verification-pending` (`:618-622`), and the reconciler does `deferredForRetry += 1; continue;` (`:863-866`).
  - Orders with an authority are only moved out of `pending` by a 100/101 result. The only other exit is the terminal-code branch, which is unreachable per the above.
  - There is no maximum age or attempt cap. Backoff only caps at 6h (`lib/payment-reconciliation.js:5`).
  - The callback also ignores the gateway's `Status=NOK` query parameter. A customer who clicks "cancel" on the gateway page is therefore only told "verification pending, you may have paid" (`PurchaseCancelPage.jsx:35`).
- Scenario:
  1. A user (or anyone with a free account) adds stock-limited items, runs checkout, and closes the gateway tab.
  2. The order stays `pending` with `stockReserved=true` and `couponReservationStatus=reserved` indefinitely.
  3. A product with 5 units is sold out and a coupon with `usageLimit` is exhausted, with no revenue.
  4. The rate limit is 12/min per IP (`rate-limit.middleware.js:76`) and fails open to a per-instance memory counter on Redis failure (`:47-54`).
- Fix:
  - Parse `payload?.errors?.code ?? payload?.data?.code` (both shapes).
  - Treat `Status=NOK` on the callback as a hint to verify once, not as proof.
  - After `expiresAt + grace` (for example 45 min, Zarinpal authority lifetime) with an authoritative "not paid" code, expire and release.
  - Add a hard fallback: orders older than N hours that verify has never confirmed are expired and released, with a log line and alert.

#### BIZ-2 HIGH, POTENTIAL: the "terminal unpaid" code set looks like legacy v1 codes and includes codes that are transient or merchant-side

- Where: `zarinpal.controller.js:702` (`new Set([-11, -12, -21, -22, -42])`).
- Evidence and risk:
  - In the v4 API as I recall it (confirm against the current Zarinpal docs; I could not fetch them), -11 is merchant not active and -12 is too many attempts. Neither is a statement about the transaction. The codes that mean "this session was not paid" (-51, -54) are absent.
  - Once BIZ-1 is fixed, a rate-limit or merchant-config answer (-12, -11) would mark possibly paid orders `failed`/`expired`, release their stock and coupon (`:627-635`, `:897-906`), and the callback would never re-verify them (see BIZ-3b). The customer is charged and has no order.
- Fix:
  - Terminal set only for definitive "not paid / session invalid" codes, taken from the current docs.
  - Never terminal for 9/10/11/12/15/16 or other auth/limit codes.
  - Pin the mapping in a unit test with recorded sandbox fixtures.
- Status: NOT VERIFIABLE offline, but the current set is suspicious on its face.

#### BIZ-3 HIGH, VERIFIED: `...due` overwrites the `$or` in the stranded-order query, so the "has reserved stock or coupon" condition is silently dropped

- Where: `zarinpal.controller.js:775-784`. The explicit `$or` is at `:779-782`; `...due` at `:783` also contains an `$or` key (`lib/payment-reconciliation.js:17-23`).
- Evidence: I ran `{paymentProvider:"zarinpal",$or:[{a:1},{b:2}],...getDueReconciliationFilter(now)}` in node. Resulting keys: `["paymentProvider","$or"]`, `$or.length === 3`, and the first element is `{reconciliationNextAttemptAt:{$exists:false}}`. The stock/coupon clause is gone.
- Effect:
  - Phase 1 selects every failed/expired order whose retry time is due, whether or not anything is still reserved. Historic, fully released orders are re-queued: `markReconciliationAttempt` bumps `reconciliationAttempts` and a future `reconciliationNextAttemptAt` (`:706-726`). Release is then a no-op but is counted as `stockReservationsRecovered += 1` (`:791`).
  - The batch is 5 per run sorted by next-attempt time. Each historic order re-enters at least every 6h, so about 360 historic failed/expired orders saturate the queue. After that, a genuinely stranded order (release threw earlier) waits behind the backlog and the backlog only grows.
  - The metric is inflated, so operators are misled.
- Fix: combine with `$and: [{ $or: reservedClauses }, due]`, or use differently named keys. Add a test that asserts the built query.

#### BIZ-3b MEDIUM, VERIFIED: the callback never re-verifies `failed`/`expired` orders and shows a definitive "payment not confirmed"

- Where: `zarinpal.controller.js:599-603`.
- Evidence: `failed` and `expired` return `reason=payment-not-confirmed` without contacting Zarinpal. `isConfirmedPaymentFailure` (`frontend/src/lib/payment-result.js:3`) renders that as the confirmed red "not confirmed" screen.
- Scenario: the customer pays at minute 31 (the local order expired at 30), or the order was misclassified (BIZ-2). Money is captured but the order is `expired` and stock is released. There is no recovery path in code. Zarinpal reverses unverified payments automatically, but that policy is outside this repo (confirm).
- Fix:
  - On callback for an expired/failed order that has an authority, call verify once.
  - If it returns 100/101 for an order whose stock is already released, flag the order `paid_after_expiry` (a manual-review status) rather than silently showing failure.

#### BIZ-4 MEDIUM, VERIFIED: stock hoarding. There is no per-user pending-order cap and no idempotency or dedupe on create-checkout

- Where: `zarinpal.controller.js:243-428` (no lookup of existing pending orders). The cart is not cleared until payment (`:165-171`).
- Evidence: each call reserves stock for the whole cart for 30 minutes (and indefinitely given BIZ-1).
- Scenario:
  - A user opens checkout in two tabs, or hits back from the gateway and re-submits. The same units are reserved twice, so the user's own second checkout fails `INSUFFICIENT_STOCK` on low-stock items.
  - A hostile user repeats this at up to 12/min per IP, and the limiter degrades to per-instance memory when Redis fails (`rate-limit.middleware.js:47-54`).
- Fix:
  - Before creating, look up the user's own `pending` order with `expiresAt > now` and reuse or cancel it (release first).
  - Cap pending orders per user (for example 2).
  - Consider a client idempotency key.

#### BIZ-5 MEDIUM, VERIFIED: admin product edit overwrites live stock with form values, so it loses reservations

- Where:
  - `product.controller.js:470` reads the whole document; `:610` and `:613` assign `variants` and `stock` from the request body; `:614` calls `save()`.
  - `:673` and `:716-717` do absolute `$set` of stock.
- Evidence: reservations are `$inc` deltas (`zarinpal.controller.js:208-216`, `:222-225`). An absolute write based on a stale read erases them. There is no "reserved" quantity separate from "on hand".
- Scenario:
  1. The admin opens the edit form (stock 10).
  2. Customers reserve 3 (stock 7).
  3. The admin saves a price or description change (the form re-sends stock 10).
  4. The oversell is 3 units. If any of those orders later fail, the release adds the quantity again (stock becomes 13).
- Fix:
  - On update, do not touch `stock`/`variants[].stock` unless the admin explicitly changes them, and then apply a delta (`$inc`) or a conditional write on the previously read value.
  - Or track `onHand` and `reserved` separately.

#### BIZ-6 MEDIUM, VERIFIED: release routing uses `item.size || item.color` instead of `hasVariant`, and a missing variant aborts the whole release forever

- Where: `zarinpal.controller.js:88` and `:118` (branch condition), `:131` (throw), and the inconsistent `no-op` in the non-transactional path `:89-92`.
- Evidence:
  - Checkout stores `size`/`color` on non-variant order lines if the cart line has them (`:229`, from `:270-283`, which never rejects options on a non-variant product).
  - Release then takes the variant branch, `$elemMatch` finds nothing, `matchedCount === 0`, and the transaction throws `RESERVED_INVENTORY_TARGET_NOT_FOUND`.
  - The same throw happens if an admin renames or removes a variant that has a reservation (the integration test at `inventory-recovery.integration.test.js:155-180` confirms the rollback).
- Scenario: a product with variants is converted to a simple product (or a variant is renamed) while a cart or pending order references the old variant.
  - The failed/expired order can never release any of its lines (the throw rolls back the other lines' increments too).
  - The reconciler retries every run (backoff to 6h), `success=false`, and the workflow fails permanently.
  - In the standalone fallback path the release is silently a no-op, so stock leaks without an error.
- Fix:
  - Decide by `item.hasVariant` only.
  - On a missing target, mark the line `stockReserved=false` with a `releaseSkipped` note and alert, instead of blocking the whole order.
  - Reject options on non-variant products at checkout.

#### BIZ-7 MEDIUM, VERIFIED: no per-user coupon limit

- Where: `models/coupon.model.js:16-23` (only a global `usageLimit`, `usageCount`, `reservedCount`); `lib/coupons.js:17-30` and `:42-63`; `coupon.controller.js:104-131`.
- Evidence: there is no field, index, or check linking a user to a coupon.
- Scenario: a 100% (or large) coupon with `usageLimit: null` can be used by the same account on every order. With a 100% coupon plus a free-shipping threshold, the order total is 0 and the order is marked paid locally (`:415-427`) without any gateway call. A leaked code costs unlimited goods. With a global limit, a single user can exhaust it.
- Also: `POST /api/coupons/validate` has only the global API limiter (600/min per IP, `rate-limit.middleware.js:67`), so codes can be enumerated by any account (low).
- Fix:
  - Add `perUserLimit` and enforce it in the checkout transaction (a `couponRedemptions` collection with a unique `{coupon,user,orderId}`, or a count of the user's non-failed orders with that code).
  - Add a stricter limiter on `/coupons/validate`.

#### BIZ-8 MEDIUM, VERIFIED: refund bookkeeping can double-count; there is no cumulative cap and the duplicate check is racy

- Where:
  - `service-case.controller.js:44-49`: the active-duplicate check runs at `:44` with a non-atomic find-then-create, and `refundAmount = order.totalAmount` is set at `:49`.
  - `models/service-case.model.js:25`: no unique/partial index on `{order,type}`.
  - `admin.controller.js:236-240` bounds a single case's `refundAmount` by `order.totalAmount` only; `:243` only requires approved + reference to mark processed.
- Scenario:
  - Two concurrent POSTs create two active refund cases for one order.
  - After case A is processed (status `resolved`), the customer can file case B for the same order (the check excludes resolved/rejected), so the order can be "refunded" twice in the books.
  - Refund requests are also accepted before delivery and are not linked to shipment status.
  - Returns never restock inventory (`order.controller.js` `returned` only changes a label). This is a design note.
- Fix:
  - Partial unique index `{order:1,type:1}` where `status` is in the active states.
  - On approval, sum already approved/processed refunds for the order and cap at `totalAmount`.
  - Store `refundedTotal` on the Order.

#### BIZ-9 MEDIUM, VERIFIED (config): reconciliation throughput is 5 orders per phase per run

- Where: `lib/payment-reconciliation.js:1` (`BATCH_SIZE = 5`); `zarinpal.controller.js:784`, `:804`, `:824`.
- Evidence: at a 5-minute cadence that is 60 expired-pending orders per hour. Each phase is bounded by a 5s fetch timeout plus transactions, so the 60s function limit allows far more.
- Scenario: a campaign day with a few hundred abandoned checkouts delays stock release by hours; the error is bounded only by BIZ-1/BIZ-3 once fixed.
- Fix: raise the batch (about 15-20) with a wall-clock guard (stop starting items after about 40s), and process verify calls with a small concurrency limit.

#### BIZ-10 MEDIUM, VERIFIED: Redis outage fails reconciliation closed while the lock is only an overlap guard; the rate limiter fails open

- Where:
  - `zarinpal.controller.js:742-755`: any Redis error returns 503 before any work.
  - `lib/redis.js:7-9`, `:22-28`: unset `REDIS_URL` leaves a stub whose methods throw.
  - `rate-limit.middleware.js:47-54`: fail open.
- Evidence: every reconciliation step is a compare-and-set or an idempotent transaction (`:831-845`, `:869-889`, coupons txns). The lock is not required for correctness.
- Scenario: Redis down means stock release, paid-order finalization, and payment recovery all stop (the workflow turns red, but paid-unfinalized orders stay unfinalized). Meanwhile checkout limiting degrades to per-instance memory, which is ineffective on serverless.
- Fix:
  - If the lock cannot be acquired due to a Redis error, proceed with a smaller batch (fail-open for the lock) and log it, or use a Mongo-based lease.
  - The limiter fallback is acceptable only if checkout has a DB-side per-user guard (BIZ-4).

#### BIZ-11 LOW/MEDIUM, VERIFIED: finalization is a multi-step non-atomic sequence and a stale cart save or deleted coupon can leave a paid order unfinalized or wrongly shown as "verification pending"

- Where: `zarinpal.controller.js:158-185`.
- Order of steps: redeem coupon txn (`:160-162`) -> `user.save()` (`:163-171`) -> `finalizedAt` CAS (`:172-184`).
- Evidence and effects:
  - If `user.save()` throws (Mongoose `VersionError`, because the user changed their cart concurrently), the exception reaches the callback's catch (`:664-670`). The paid customer is redirected to the "verification pending, do not pay again" page. The reconciler finalizes on its next run (the callback reset `reconciliationNextAttemptAt` to null at `:647-649`).
  - The coupon redeem is a separate transaction. `deleteCoupon` checks `reservedCount>0` (`coupon.controller.js:188`) and then deletes (`:197`) without atomicity. A reservation created in that window leaves an order whose redeem throws `COUPON_RESERVATION_COUNTER_NOT_REDEEMABLE` (`lib/coupons.js:130`) forever. The paid order never reaches `finalizedAt`/`processing`, fails every reconcile run, and keeps the workflow red.
  - A late finalization after an admin advances shipment can reset `shipmentStatus` to `processing` (`:175`). The guard `finalizedAt: null` limits the window, but the admin PATCH is not blocked while unfinalized (`order.controller.js:85` only checks `paid`).
- Fix:
  - Make the cart cleanup best-effort (`$pull` with `updateOne`) and independent of coupon redemption.
  - Order: `finalizedAt` CAS, then side effects, or record per-step flags.
  - Make `deleteCoupon` a conditional `deleteOne({_id, reservedCount:0, usageCount:0})`.
  - Redeem should tolerate a missing coupon by marking the order `redeemed` with a warning.

#### BIZ-12 LOW, POTENTIAL: checkout hard-requires a replica set; transaction retry time can exceed the function limit

- Where: `zarinpal.controller.js:308-397`; `isTransactionUnsupported` at `:99-100`, used at `:490-492`.
- Evidence and effects:
  - On standalone Mongo, `withTransaction` throws and checkout returns 503 "requires a transactional database" (clear and safe, matches the docs `PERSIAN_COMMERCE_OVERVIEW.md` "Use a replica set").
  - The release fallback for standalone (`:146-155`) is non-atomic (a double increment is possible with concurrent releases) but is unreachable in a working production system, because no order can be created there.
  - Mongoose `withTransaction` retries transient errors for up to 120s. Under heavy contention on a hot product document (every checkout writes the same Product doc), retries can outlive Vercel's 60s `maxDuration` (`backend/vercel.json`). The platform then kills the function: the transaction aborts server-side (no inconsistency), but the user sees a failure.
- Fix: set `maxCommitTimeMS`/an explicit overall deadline; keep the coupon increment last in the transaction to shorten the conflict window; document that local dev needs a single-node replica set.

#### BIZ-13 LOW, VERIFIED: bookkeeping gaps

- `models/order.model.js:70`: `zarinpalRefId` has no unique/sparse index (default `""` prevents a sparse unique). Duplicate ref ids across orders would go unnoticed.
- Card hash/PAN mask/fee from the verify response are not stored (`zarinpal.controller.js:646`). This is useful evidence for disputes.
- `couponReservedWithoutOrder`/`reservedCouponCode` (`:257-258`, `:562-564`) are never set. Dead code, harmless, since the coupon and order are created in the same transaction.
- Ambiguity classification depends on Zarinpal returning HTTP 200 with `errors.code` for rejections (`:475`). If the gateway returns 4xx for validation errors, a definite rejection becomes "ambiguous": a 202 "don't pay again" and stock held until expiry. POTENTIAL; confirm in sandbox.

#### BIZ-14 LOW, VERIFIED: reconciliation scheduler robustness

- `scripts/reconcile-pending-payments.mjs:17` uses a 25s client timeout, but a run can legitimately take longer (up to 15 items, with 5s fetches in phase 3 plus transactions). The self-hosted cron would report false failures. The workflow uses `--max-time 55` (`reconcile-payments.yml:36`) and the job's `timeout-minutes: 2`; Vercel `maxDuration` is 60 (`backend/vercel.json`). If the function is killed at 60s, the lock stays held until its TTL (70s, `payment-reconciliation.js:2`). That is safe because the cadence is 5 minutes.
- The server enforces no minimum `CRON_SECRET` length (`zarinpal.controller.js:729-730`); only the self-hosted script requires 32 characters (`reconcile-pending-payments.mjs:8`); the workflow only checks non-empty (`reconcile-payments.yml:26`).
- GitHub scheduled workflows are best-effort (the docs concede this at `PERSIAN_COMMERCE_SETUP.md`). With BIZ-1/BIZ-9 the reconciler is the only release mechanism for abandoned orders, so a delayed schedule directly means longer stock lock.
- `jq -e '.success == true'` (`:46`) turns the job red when any single order fails (for example BIZ-6/BIZ-11), which is good for alerting but will be permanently red for one stuck order.

#### BIZ-15 INFO: design notes, not bugs

- `calculateShippingFee` is evaluated on the post-coupon subtotal (`zarinpal.controller.js:358-359`), so a coupon can push an order below the free-shipping threshold. This is consistent between preview (`OrderSummary.jsx:74-75`) and server.
- Analytics are gross (`analytics.controller.js:76`, `revenueBasis: "gross-paid-orders"`), bucketed by `createdAt` (not paid time), and not netted for processed refunds/returns. This is labelled, but the dashboard will overstate revenue.
- `IRT_CATALOG_PRICES_CONFIRMED` is a global kill switch for checkout (`:244`, `:18`). Fine.
- The cart accepts untracked-stock products (`cart.controller.js:137`, `:200`: `typeof trackedStock === "number"` guard), then checkout rejects them (`UNTRACKED_INVENTORY`, `:200`, `:505-506`). Fail-closed, but the UX is late.
- The success page does not rely on the URL: it calls the owner-scoped status endpoint (`PurchaseSuccessPage.jsx:22-23`, `zarinpal.controller.js:680-686`). Good.

### 3. Verdicts on the specific checks

| Check | Verdict | Evidence |
|---|---|---|
| Server-side price/discount/shipping | PASS | Prices come from DB inside the transaction (`:313-335`); discount from the reserved coupon (`:345-353`, `lib/coupons.js:8-15`); shipping from settings in the same snapshot (`:357-359`, `lib/shipping.js`). The client sends only `couponCode` (string-checked at `:289`) and the address. `GET /shipping?subtotal=` is a display quote only (`shipping.controller.js:8-18`). |
| Quantity float/negative/huge | PASS | `Number.isInteger && 1..100` at `:276`, `:197` and in the cart (`cart.controller.js:62`, `:182`). Total is checked with `isSafeInteger` (`:336`, `:361`). Note `totalToman*10` (`:442`) is not re-checked, but it only overflows beyond about 9e14 Toman. |
| Variant selection | PASS | Exact trimmed size/color match (`:28-30`); a conditional `$elemMatch` with `stock >= qty` (`:213`); options on non-variant products are not rejected at checkout (see BIZ-6). |
| Currency | PASS | Schema enum IRT only (`order.model.js:55-56`); every query filters `currency: "IRT"`; x10 conversion only at the gateway call. |
| Coupon validation / limits | PARTIAL | Atomic conditional `$inc reservedCount` with `$expr` on `usageLimit` (`coupons.js:42-63`) inside the checkout transaction. Global limit correct. No per-user limit (BIZ-7). |
| Coupon reservation/release/race | PASS with caveats | Release/redeem are transactional with state-machine guards (`coupons.js:77-144`) and integration-tested for double-release. Caveats: BIZ-1/BIZ-3 (never released for abandoned orders) and BIZ-11 (coupon deleted mid-flight). |
| Stock reservation atomicity | PASS | Conditional `findOneAndUpdate` with price, `isActive` and `stock >= qty` in the filter (`:208-226`); null/NaN stock rejected (`inventory-stock.js:17-21`, `:200`). The 12-way concurrency test exists (integration only). Admin writes break it (BIZ-5). |
| Transactions / standalone | PARTIAL | Checkout needs a replica set and returns 503 on standalone (`:490-492`); documented. Standalone release fallback is non-atomic (BIZ-12). |
| Callback idempotency | PASS | Compare-and-set on `paymentStatus: pending` (`:639-641`), `finalizedAt: null` guard (`:173`), unique sparse authority (`order.model.js:69`). Replay, duplicate, and concurrent callbacks converge (loser reads `latest.paid`, `:654-659`). |
| Forged authority / other user | PASS | The lookup requires both `order_id` and the exact stored authority (`:588-593`); verify sends the DB amount, not any client value (`:611`). The callback is intentionally unauthenticated GET; the response only redirects. Order status endpoint is owner-scoped (`:680-686`). |
| Amount check vs verified amount | PASS (by gateway) | Amount is taken from `order.totalAmount*10` and Zarinpal enforces equality at verify. The response's amount is not read or stored (BIZ-13). |
| Status transitions | PARTIAL | All transitions are CAS on `pending`. Failed/expired are terminal with no re-verify (BIZ-3b). |
| Open redirect | PASS | All redirects are `safeClientUrl()` (env) plus fixed paths; `order_id` is `isValidObjectId`-checked or `encodeURIComponent`-ed (`:583`, `:668`). `redirectUrl` is a fixed Zarinpal base plus the encoded authority (`:469`); the client additionally requires `https://` (`OrderSummary.jsx:233`). |
| Crash consistency | MOSTLY PASS | Stock, coupon, and order are one transaction (`:310-397`). Crash after commit/before gateway call: the order expires and releases (no-authority path `:830-848`). Crash after paid CAS/before finalize: found by phase 2 (`:798-815`). Crash after failed CAS/before release: found by phase 1 (but see BIZ-3). |
| Redis outage | MIXED | Rate limit fails open to memory (`rate-limit.middleware.js:47-54`); reconcile fails closed 503 (`:749-755`, BIZ-10). Checkout itself has no Redis dependency. |
| Lock TTL | PASS | 70s TTL > 60s `maxDuration`; token-checked release via Lua (`:704`, `:923`). The TTL can be shorter than a self-hosted run, but all steps are CAS-guarded. |
| Indexes | PARTIAL | Unique sparse `zarinpalAuthority` (`order.model.js:69`), unique `Coupon.code` (`coupon.model.js:7-8`), and compound indexes for reconciliation (`order.model.js:77-83`). `zarinpalRefId` is not unique (BIZ-13). No unique guard against duplicate pending orders per user (BIZ-4). |
| Stale pending cleanup | FAIL for orders with an authority | BIZ-1/BIZ-2/BIZ-3. Orders without an authority expire correctly after 30 minutes. |
| Duplicate fulfillment | PASS | `finalizedAt` CAS plus `$push` event in the same update (`:172-184`). Coupon redeem is state-machine guarded. |
| Cron endpoint auth | PASS | Fail-closed when `CRON_SECRET` is unset (503, `:729-730`); `timingSafeEqual` after a length check (`:733-735`; the length difference is observable, which is acceptable). Auth happens before the Redis lock. Min secret length is not enforced server-side (BIZ-14). |
| Serverless limits | PARTIAL | 5 items per phase keeps it inside 60s; 12s verify timeout in callback, 5s in cron. Throughput low (BIZ-9). |
| Money precision | PASS | Integers only: `isSafeInteger` on price, subtotal, total; coupon discount `Math.round`ed (`coupons.js:12`); shipping must be a safe integer (`shipping.controller.js:33`). Fractional env shipping fee is rejected at checkout (`:361`). |
| NoSQL injection | PASS | `typeof === "string"` guards on `Authority`, `order_id`, `couponCode`, `code`, `productId`, shipment fields (`:578-579`, `:289`, `coupons.js:6`, `cart.controller.js:114`, `order.controller.js:66`). `isValidObjectId` for ids; the service-case `orderId` is not type-checked (`service-case.controller.js:31`, `:37`) but non-ObjectId objects fail `isValidObjectId` and numbers/12-char strings only cast to a non-matching `_id` (not exploitable). |

### 4. Done well (brief)

- Gateway-outcome modelling is careful: `paymentRequestStatus` states, ambiguous requests keep stock reserved (`:508-540`), unknown transaction commit returns 202 without releasing (`:493-504`).
- Price-snapshot check inside the transaction plus the price in the reservation filter (`:321-327`, `:212`, `:223`).
- `unknown stock != unlimited` policy end to end (`inventory-stock.js`, audit script `scripts/audit-untracked-inventory.mjs`).
- Release is idempotent via per-line `stockReserved` flags in a transaction; coupon reserve/release/redeem use explicit state transitions.
- Callback and reconciler both use CAS and never trust browser state; the success page re-checks the server.
- Zero-payable orders are finalized locally rather than sending 0 to the gateway (`:415-427`).
- Redirects never contain user-controlled hosts; security headers and an origin check exist.
- CSV export neutralizes formula injection (`analytics.controller.js:126-131`).

### 5. Test coverage gaps for these paths

- CI split: `.github/workflows/ci.yml` runs `npm test` with no `MONGO_TEST_URI`, so all three `*.integration.test.js` files skip there. They run only in `.github/workflows/feature-validation.yml` (replica set at `MONGO_TEST_URI=...?replicaSet=rs0`, pushes to listed branches). `npm run build --prefix backend` only syntax-checks the integration files.
- Integration tests assert only: concurrent reservation (no oversell), stale-price refusal, partial multi-product rollback, duplicate release restores once, failed txn keeps recoverable state, null stock rejected, txn rollback on order failure, coupon release/redeem exactly once, and the missing-counter retryable state.
- Not tested at all:
  - `createZarinpalCheckout` (no mocked `fetch`; zero-total path; PRICE_CHANGED; unknown commit; ambiguous gateway; coupon rejected).
  - `verifyZarinpalPayment` (replay, concurrent callbacks, wrong authority, Status=NOK, 100 vs 101, error-shape parsing; this is why BIZ-1/BIZ-2 went unnoticed).
  - `reconcilePendingZarinpalOrders`: auth (missing secret/wrong secret/length mismatch), lock contention, Redis failure, and the phase queries (BIZ-3 would be caught by one assertion on the built filter).
  - `finalizePaidOrder`; `releaseReservedInventory` for variant/option mismatch (BIZ-6); `reserveCoupon` concurrency (only release/redeem are covered); per-user coupon limits; cart controller; shipping calc; service-case/refund rules (BIZ-8); admin stock edit vs reservation (BIZ-5); order shipment transitions.
  - Frontend: nothing exercises `OrderSummary`/`PurchaseSuccessPage`/`PurchaseCancelPage` (only `isConfirmedPaymentFailure` has a trivial helper).

### 6. Suggested fix order

1. BIZ-1 + BIZ-2 + BIZ-3 together (one PR with Zarinpal response fixtures and a query-shape test).
2. BIZ-4, BIZ-5, BIZ-6 (stock correctness).
3. BIZ-7, BIZ-8 (coupon and refund abuse).
4. BIZ-9 to BIZ-11, BIZ-14 (operations).

---

# Frontend, Persian RTL, SEO and UX (Phase 6)
Code‑reading only: nothing was rendered in a browser, so layout/visual statements are POTENTIAL unless evident from code. Four spot‑checks by me confirmed the cited lines (FE‑1, FE‑2, FE‑3's `index.css:70-72` inversion rules, FE‑15 regex, FE‑5 `@import`).

**Is the Persian RTL support "complete"?** Mostly functional, but built on a fragile mechanism: `index.css` globally inverts Tailwind *physical* utilities with `!important` (FE‑3) instead of using logical utilities, producing inconsistent results (`left-3` vs `left-0`; `text-right` rendering left in places); direction arrows are wrong in some places (FE‑21); mixed LTR content isn't isolated with `<bdi>` (FE‑22); Persian‑digit input in `type=number` Toman fields is a risk (FE‑20); native validation messages are in the browser language (FE‑23); Vazirmatn is loaded from Google Fonts (FE‑5) and `font-serif` has no Persian font fallback. Jalali dates and Toman math are sound (FE‑26/27).

Repo: `/home/user/itswanheda/mern-ecommerce` (frontend/, api/, seo/, vercel.json). Paths below are relative to that root.
Method: code reading + grep/python counting only. No build, no render, no npm install. Layout/visual statements are POTENTIAL unless the code alone proves them.
Status legend: VERIFIED = proven by reading code; POTENTIAL = depends on runtime/browser/deployment; NOT VERIFIABLE = needs a render or live infra.

Scale facts used throughout: 11,575 LOC in frontend/src; 47 unique arbitrary hex colors used 827 times in JSX; 134 physical left/right Tailwind utilities vs 3 logical ones; 31 whole-store Zustand subscriptions vs 2 selector calls.

---------------------------------------------------------------------
## A. HIGH

### FE-1 (High, VERIFIED) Any token refresh unmounts the whole app and destroys in-progress UI state
- Evidence: `frontend/src/stores/useUserStore.js:78` `refreshToken` does `set({ checkingAuth: true })`; `frontend/src/App.jsx:67` `if (checkingAuth) return <LoadingSpinner />;` replaces Navbar + Routes + Footer with a full-screen spinner. The refresh interceptor (`useUserStore.js` bottom, `shouldAttemptTokenRefresh` in `lib/refresh-coordinator.js:1-9`) calls `refreshToken` for ANY 401 on any API call, not only the boot-time profile check. The test `frontend/tests/refresh-flow.test.js:23` explicitly asserts `checkingAuth` is true during refresh, so this is by design for boot but also fires mid-session.
- Impact: when the access token expires while a user is on checkout (`OrderSummary` address form), the admin product form, or the profile page, the route tree unmounts. Local `useState` (typed address, unsaved admin form, scroll, open dialogs) is lost, then the page remounts and re-fetches. The retried request resolves against unmounted components (stale setState). Also causes a visible full-page flash.
- Fix: keep `checkingAuth` for the initial boot only (rename e.g. `bootstrapping`) and do not touch it in `refreshToken`; render the shell (Navbar/Routes) while refreshing. Update the test accordingly.

### FE-2 (High, VERIFIED) Boot is blocked on /auth/profile, and every anonymous visitor triggers a 3-request failure chain
- Evidence: `useUserStore.js:12` initial `checkingAuth: true`; `App.jsx:57` `checkAuth()` in effect; `App.jsx:67` renders only the spinner until the response. `lib/refresh-coordinator.js:6` excludes only `auth/(refresh-token|logout|login|signup|forgot-password|reset-password)`, NOT `auth/profile`. For a guest: `GET /auth/profile` 401 -> `POST /auth/refresh-token` 401 -> interceptor catch calls `useUserStore.getState().logout()` -> `POST /auth/logout`. All of this goes through the cross-domain Vercel rewrite (`vercel.json:7`) before the first meaningful paint.
- Impact: (1) LCP/FCP of every page for every guest waits on 1-3 serial API round trips with no timeout (Iran-side latency to a vercel.app backend makes this worst case); (2) the server-rendered content from `api/share-preview.js` is replaced by the spinner and then by React output (no hydration, `main.jsx:8` uses `createRoot`), so SSR gives crawlers content but users still see spinner -> content swap; (3) auth endpoints (likely rate limited) are burned by anonymous traffic; (4) console 401 noise.
- Fix: render the shell optimistically (don't block routes on auth; only gate private routes), make the backend return 200 `{user:null}` for anonymous profile or skip refresh when no session hint exists, and exclude `auth/profile` boot probe from the refresh chain when the refresh cookie is absent. Add a request timeout in `lib/axios.js:4`.

### FE-3 (High, VERIFIED by code / POTENTIAL for visual result) RTL implemented by globally inverting Tailwind physical utilities with !important
- Evidence: `frontend/src/index.css:70-88` (inside `@layer base`): `.text-left{text-align:right!important}`, `.text-right{...left}`, `.ml-1..4`/`.mr-1..4` swapped, `.pl-11.pr-4`, `.absolute.left-3/left-4/left-8` -> right, `.absolute.right-3/right-5` -> left. Lines 80 and 89 are an exact duplicate rule. Only these exact tokens are inverted; `mr-auto`, `ml-5+`, `pl-*`/`pr-*` (23 uses), `left-0`/`right-0` (e.g. `Navbar.jsx:478,586,884,1050,1094`), `border-l/r`, `rounded-l/r`, `translate-x-*`, and ALL responsive variants (`md:ml-2` etc.) are NOT inverted. Net semantic: in this codebase `left-3` means physical right, `right-3` means physical left, but `left-0` means physical left. Count: 134 physical utilities across 32 files (worst: Navbar.jsx 29, SignUpPage.jsx 14, AuditLogTab.jsx 11, ProductDetailsPage.jsx 9, LoginPage.jsx 9, AnalyticsTab.jsx 7, ProductCard.jsx 6, LoadingSpinner.jsx 5, CategoryPage.jsx 5) vs 3 logical (`end-3`/`start-3`/`text-end`, only in `ProductDetailsPage.jsx:287-291`).
- Concrete suspicious results (POTENTIAL, cannot render): `text-right` is rendered LEFT-aligned inside RTL lists: `Navbar.jsx:491,513,944,1274` (search suggestion rows, menu items), `ProductDetailsPage.jsx:398` (size table `text-right`), `AdminPage.jsx:67` tab buttons `text-right`, `MyOrdersPage.jsx:128` `<p dir="ltr" className="text-right">` (becomes left). `ProductDetailsPage.jsx:491` close button `absolute right-3` is forced to the left and the lightbox prev/next (`:492,494`) use `right-3`/`left-3` with the flipped meaning, while the inline gallery on `:287-291` uses logical `end-3/start-3` -> prev/next sides differ between inline gallery and lightbox (see FE-17).
- Dead rule: `index.css:88` `.md\\:right-0` has a doubled backslash, so the selector is invalid CSS and is dropped by the parser; also `md:right-0` is used nowhere (grep).
- Impact: every new component must know the inverted convention; copy-pasting Tailwind snippets silently breaks; third-party/portal content is not inverted. This is the root cause of several defects below.
- Fix: delete the overrides, convert the 134 utilities to logical ones (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/e/rounded-s/e`), keep the `dir="rtl"` on `<html>` only (48 redundant `dir="rtl"` attributes exist, see FE-24). A one-time codemod (`ml-`->`ms-`, `mr-`->`me-` after removing the inversion, taking the flipped semantics into account for the ~20 classes listed in index.css 70-88) is feasible.

### FE-4 (High, VERIFIED) Dialog accessibility is inconsistent; one `aria-modal` dialog has no keyboard/focus handling at all
- Good (reference implementations): Navbar menu `Navbar.jsx:348-391` (Esc, focus trap, scroll lock, focus return); product lightbox `ProductDetailsPage.jsx:158-200`; delete confirm `ProfilePage.jsx:52-86`.
- Missing: `CategoryPage.jsx:861-864` mobile filters `role="dialog" aria-modal="true"` - the file has no Escape handler, no `.focus()`, no `document.body.style` scroll lock (grep over CategoryPage returns none) -> keyboard/screen-reader users can tab into the page behind an "modal". `Navbar.jsx:393-408,1303-1306` mobile search dialog: Esc + initial focus + scroll lock but no focus trap and no focus return. `ProductEditForm.jsx:232-233` Esc handled only via `onKeyDown` on the section (works only while focus is inside), no initial focus, no trap, no return. `IranianDateTimeInput.jsx:104-110` `role="dialog"` popover: no Esc, no outside click, no focus movement/return.
- Fix: one shared `useDialog`/`<Modal>` (trap, Esc, scroll lock, focus return, `inert` on siblings) and reuse it in these four places.

---------------------------------------------------------------------
## B. MEDIUM

### FE-5 (Medium, VERIFIED) Google Fonts via CSS @import (render-blocking, third-party, availability/privacy risk for Iranian users)
- Evidence: `frontend/src/index.css:1` `@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap');`. Vite inlines this into the main CSS bundle, so the stylesheet request to fonts.googleapis.com is on the critical render path (display=swap only governs the font file, not the stylesheet fetch); five weights; no preconnect (`index.html` has none), no self-hosting, no `font-display` fallback tuning. Body falls back to `Tahoma, sans-serif` (`index.css:38,48`).
- Impact: Google font hosts are intermittently slow/filtered from Iranian networks; a stalled CSS import delays first paint until the browser times out; user IPs are disclosed to Google (relevant to the privacy-policy text in `StoreInfoPage.jsx`). POTENTIAL in magnitude (network dependent), VERIFIED in design.
- Related: `font-serif` is used 30 times in 14 files (brand logo, h1/h2 headings, e.g. `Navbar.jsx:959`, `StoreFooter.jsx:47`) and `tailwind.config.js:4` has `extend: {}` (no `fontFamily`), so these elements use Tailwind's default serif stack (Georgia/Times) - Persian glyphs in headings fall back to a system serif, not Vazirmatn (POTENTIAL visual inconsistency).
- Fix: self-host Vazirmatn variable woff2 (subset Arabic + Latin) from `public/fonts`, `<link rel="preload" as="font" crossorigin>`, `@font-face{font-display:swap}`, and define `fontFamily.sans/serif` in tailwind.config.js.

### FE-6 (Medium, VERIFIED) Whole-store Zustand subscriptions everywhere; every ProductCard re-renders on any cart/wishlist change
- Evidence: 31 `= useXStore()` destructurings with no selector (list: `ProductCard.jsx:34-35`, `CartItem.jsx:6`, `Navbar.jsx:88-92`, `OrderSummary.jsx:48-49`, `HomePage.jsx:44,59`, `CategoryPage.jsx:141-142`, `ShopPage.jsx:41`, `App.jsx:54-55`, `ProductDetailsPage.jsx:46-47`, `WishlistPage.jsx:7`, ...). Only `ProfilePage.jsx:35-36` uses selectors.
- Impact: each `ProductCard` (a grid of N cards, plus FeaturedProducts/PeopleAlsoBought) subscribes to the entire cart store and entire wishlist store; any `set` (including `calculateTotals`, `isMergingGuestCart` toggles) re-renders all cards. `Navbar.jsx` (1363 lines, 13 `useState`) re-renders on every cart/wishlist/user/category change.
- Fix: `useCartStore((s) => s.addToCart)`, `useWishlistStore((s) => s.items.some(...))` (or `useShallow`), memoize `ProductCard`.

### FE-7 (Medium, VERIFIED) Duplicate / un-deduplicated requests
- `fetchCategories()` is invoked on mount by `Navbar.jsx:146` (always mounted), `HomePage.jsx:64`, `ShopPage.jsx:42`, `CategoryPage.jsx:143`, `CreateProductForm.jsx:71`; `stores/useCategoryStore.js:12-23` has no in-flight guard or TTL -> >=2 identical `GET /categories` on every home/shop/category page load. After any category mutation `useCategoryStore.js:46,62,78` refetches both lists.
- `AdminPage.jsx:33` re-requests `GET /auth/profile` although `checkAuth` already has the profile (and permissions fall back to "show everything" when the call fails, line 33/`setAdminPermissions(null)` - UI-only gating; make sure the API enforces permissions).
- `HomePage.jsx:61-84` issues 5 parallel calls (featured, categories, newest, campaigns, bestsellers) and builds the hero from whichever returns, no abort on unmount except the `active` flag (requests still complete).
- `OrderSummary.jsx:150-159` re-requests `/shipping?subtotal=` on every `total` change (no debounce) and `/payments/provider` on each mount.
- Fix: memoize in-flight promise in the stores or adopt TanStack Query/SWR with a stale time.

### FE-8 (Medium, VERIFIED) Cart store writes computed from a pre-await snapshot (lost updates) and un-serialized quantity updates
- Evidence: `useCartStore.js:254` `removeFromCart` and `:278` `updateQuantity` capture `const state = get()` then `await axios...` and afterwards build the next cart from `state.cart` (`:267`, `:307`) rather than `get().cart`. Two overlapping operations (rapid +/-, remove while quantity request in flight) overwrite each other; the UI may then disagree with the server. There is no per-item request queue or disabled state while pending.
- Fix: use `set((s) => ...)` functional updates or `get()` after the await; disable controls / debounce per line.

### FE-9 (Medium, POTENTIAL) mergeGuestCart re-runs on every `user` object identity change; no in-flight guard
- Evidence: `App.jsx:57-65` effect deps `[user, ...]` calls `mergeGuestCart()` whenever `user` changes identity; `useUserStore.js:70-75` `updateProfile` replaces `user` with a new object -> another `GET /cart` (and `POST /cart/merge` if any guest-only items remain). `isMergingGuestCart` is set (`useCartStore.js:143`) but never checked at entry, so React.StrictMode's double effect in dev (`main.jsx:8`) and quick user changes can run two merges concurrently; `readGuestCart()` is read twice (`:144,:146`) between awaits.
- Fix: key the effect on `user?._id`, and return early if `isMergingGuestCart`.

### FE-10 (Medium, VERIFIED) Guest cart / wishlist / recently-viewed persist whole product snapshots; prices go stale; wishlist never reaches the account
- Evidence: `useCartStore.js:35-39` writes the full `item` objects (price, stock, variants, images) to `localStorage["tik-boutique-guest-cart"]`; guests' totals come from those snapshot prices (`totalsFor`, `:63-73`) and are never revalidated (`getCartItems` for guests just rereads storage, `:101-103`). Wishlist (`useWishlistStore.js:4,21`) is device-only localStorage: not synced on login, not cleared on logout, full product objects, unbounded growth. Recently viewed (`ProductDetailsPage.jsx:135-152`) stores descriptions + variants for 6 products and the effect depends on ~10 product fields.
- Impact: wrong price/stock shown to guests until checkout; wishlist lost across devices; shared-device leakage of browsing interest. Nothing sensitive (no tokens, PII, or addresses) is stored in localStorage; auth is cookie-based (`lib/axios.js:6` `withCredentials`) - OK.
- Fix: store `{productId, size, color, quantity}` only and hydrate from `/products` on load; add `/wishlist` endpoint or document device-only behavior.

### FE-11 (Medium, POTENTIAL) Admin image upload sends base64 data URLs inside JSON; likely exceeds the Vercel 4.5 MB body limit
- Evidence: `CreateProductForm.jsx:150-161`, `ProductEditForm.jsx:150-162`, `CategoryManager.jsx:146-157`, `CampaignManager.jsx:56-64` read files with `FileReader.readAsDataURL` and post them in the JSON body (backend `product.controller.js:413,576` uploads the data URI to Cloudinary). Limits allow 5 MB per image and 6 MB total (+33% base64 = ~8 MB). The API is hosted at `mern-ecommerce-api-tau.vercel.app` (`vercel.json:7`); Vercel serverless request bodies are capped at 4.5 MB.
- Impact: realistic phone photos produce 413 for admins; no client-side resize/compress. Not verifiable without the deployment.
- Fix: downscale/compress on a canvas before upload (max ~1600px, WebP/JPEG q~0.8) or use direct Cloudinary signed uploads; lower advertised limits to match.

### FE-12 (Medium, VERIFIED) No responsive/modern images; originals shipped; no width/height; heavy static assets
- Evidence: 23 `<img>` in src, 0 `srcSet`/`sizes`, 0 with `width`/`height` (e.g. `ProductCard.jsx:70` has `loading=lazy` but no intrinsic size; the aspect ratio is reserved by a wrapper, which limits CLS for cards, but `HomePage.jsx:155` hero, `CartItem.jsx:18`, `CampaignsPage.jsx:48`, `CollectionPage.jsx:97`, `CampaignPage.jsx:68` have none). No Cloudinary URL transformation (`f_auto,q_auto,w_`) anywhere in src (grep `cloudinary` in frontend/src = 0), so product photos are fetched at original size/format. `CartItem.jsx:18`, `CollectionPage.jsx:97`, `CampaignPage.jsx:68`, `HomePage.jsx:155` lack `loading`/`decoding`.
- `frontend/public` sizes (ls -l): shoes.jpg 1,756,313 B; screenshot-for-readme.png 925,029 B (unreferenced by code, shipped in dist); jackets.jpg 545,128 B; bags.jpg 273,495 B; jeans.jpg 260,973 B; glasses.png 237,238 B (PNG photo); suits.jpg 210,248 B; tshirts.jpg 128,340 B; vite.svg 1,497 B (unreferenced, Vite template leftover); favicon.svg 311 B. Home-page category cards load the seven category photos (~3.4 MB) whenever the API returns no categories (`HomePage.jsx:15-21,41-52`), and every category lacking an image falls back to `/tshirts.jpg` (`HomePage.jsx:51`).
- Fix: AVIF/WebP at 2-3 widths, `srcset/sizes`, explicit width/height, Cloudinary transforms, delete `screenshot-for-readme.png` and `vite.svg` from public.

### FE-13 (Medium, POTENTIAL) SEO server shell: every route depends on a self-fetch of /index.html and a serverless function
- Evidence: `vercel.json:54-141` rewrites `/` and the catch-all `/(.*)` (line 138) to `/api/page-shell?path=...`. `seo/server-utils.js:60-72` `fetchAppShell` does an HTTP GET of `<own origin>/index.html` with a 3.5 s timeout on EVERY request; `api/page-shell.js:50-56` returns `503 "Storefront temporarily unavailable"` (plain text, no cache header, no SPA fallback) if that fails. So a cold start, a timeout, or Vercel Deployment Protection on preview URLs (self-fetch would get the auth wall) turns the whole site (home, login, cart, static pages) into 503 even though `dist/index.html` is healthy. Only share-preview degrades gracefully (`MINIMAL_SHELL` fallback, `share-preview.js:22,517-535`).
- Caching: page-shell 200 uses `s-maxage=60, stale-while-revalidate=300` (`api/page-shell.js:83`); product/category HTML via share-preview likewise (`share-preview.js:508`), so price/availability in the SSR HTML and JSON-LD can be up to ~6 minutes stale while the SPA shows live data.
- Fix: serve static `index.html` for non-SEO private routes directly (rewrite only SEO-relevant routes), inline the shell at build time (import `dist/index.html` content or embed via the build) instead of an HTTP self-fetch, and fall back to the static shell on error rather than 503.

### FE-14 (Medium, VERIFIED) `/api/*` rewrite to a hard-coded external backend precedes the function routes; reliance on Vercel filesystem precedence
- Evidence: `vercel.json:5-8` `/api/:path*` -> `https://mern-ecommerce-api-tau.vercel.app/api/:path*` is the first rule, while this repo's own functions live at `/api/page-shell|robots|sitemap*|share-preview`. It works only because Vercel resolves filesystem functions before `rewrites` (POTENTIAL - depends on platform behavior, covered by no test); any future backend route named `robots`, `sitemap`, `page-shell`, `share-preview` is unreachable. The backend host is hard-coded (rebrand/migration item) and every API call pays an extra proxy hop; `lib/axios.js:4` has no timeout.
- `vercel.json` has no `headers` section: no CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/frame-ancestors, and no long-cache headers for hashed assets (Vercel adds immutable caching for static output by default, but there is no explicit policy). `/reset-password?token=...` is rewritten through a function (`vercel.json:78`), so the reset token appears in function/request logs (POTENTIAL; mitigate with `Referrer-Policy: no-referrer` and by excluding the route from the function rewrite).

### FE-15 (Medium, VERIFIED) share-preview drops filter values containing the letters "r" or "n" (regex typo)
- Evidence: `api/share-preview.js:402` and `:488` use `!/[\\r\\n]/.test(value)` inside a regex literal. `[\\r\\n]` is a character class containing backslash, `r`, `n` - not CR/LF. Any `q`, `color`, `brand`, `size`, `attributes` value containing "r" or "n" (Latin) is silently omitted from the upstream API query used to render category/shop HTML (e.g. `brand=nike`, `color=red`). Persian values are unaffected. The same file at `:140` handles real CR/LF elsewhere correctly (`/[\r\n]/`).
- Impact: SSR HTML for filtered URLs differs from the SPA result; filtered pages are `noindex, follow` so SEO damage is small, but it is a logic bug and CR/LF is not actually filtered.
- Fix: `/[\r\n]/`.

### FE-16 (Medium, VERIFIED) Contrast: muted tokens used as small text fail WCAG AA on the light theme
- Computed contrast on #f7f5f0/#fffefa: `#77786f` 4.10:1 (43 uses; e.g. `FeaturedProducts.jsx:46`, `StoreFooter.jsx:142`), `#85867d` 3.38:1 (16 uses incl. `StoreFooter.jsx:94,126`), `#8a8b82` 3.41:1 (8, placeholders/icons `LoginPage.jsx:47`), `#9a9a90` 2.81:1 (4), `#a0a195` 2.40:1 (1); disabled text `#a0a195` on `#f2f0e9` 2.29:1 (`index.css:11`). 70 usages of `text-[10px]`/`text-[11px]`. Accent `#68745f` on canvas is 4.53:1 (passes only barely), white on accent 4.94:1. Dark theme values are fine (muted 8.5:1).
- Fix: darken muted tokens (e.g. #62645c/5.5:1 already exists as `--ui-muted`), and stop using raw hexes for text.

### FE-17 (Medium, VERIFIED) Search combobox exposes ARIA state incorrectly
- Evidence: `Navbar.jsx:1001-1004,1336-1338` input has `aria-autocomplete`, `aria-controls`, `aria-expanded` but no `role="combobox"` and no `aria-activedescendant` (grep count 0); options (`:487,509`) get visual highlight only. Screen reader users cannot perceive the highlighted suggestion from ArrowUp/Down navigation (`:436-468`). Category suggestions are client-filtered substring matches without Persian normalization (`:216-219`).
- Fix: `role="combobox"`, `aria-activedescendant={optionId}`, ids on options, announce result count via the existing `role="status"`.

### FE-18 (Medium, VERIFIED) Dark theme is an attribute-selector !important patch layer over 827 hard-coded hex classes
- Evidence: `index.css:24-27` (light overrides) and `:189-340` (dark): `[class~="bg-[#68745f]"] {... !important}` etc. 47 unique hexes are used 827 times in JSX; 65 distinct hex-class tokens have no dark counterpart (e.g. `focus:ring-[#68745f]` x20, `ring-[#68745f]` x25, `focus:border-[#68745f]` x19, `hover:text-[#68745f]` x9, `border-[#c7c3b9]` x9, `text-[#8a8b82]` x8, `hover:border-[#252722]` x7), plus legacy template classes (`text-gray-300/400`, `bg-gray-800/900` in `CartPage.jsx`, `PurchaseCancelPage.jsx:40`, `IranianDateTimeInput.jsx`, admin forms) that the dark layer re-maps. Two parallel systems coexist: `var(--ui-*)` tokens (newer: Navbar, OrderSummary, Profile) and raw hexes (older: ProductCard, HomePage, StoreFooter, auth pages). The system color-scheme preference is not honored (`index.html:18-27` reads only localStorage).
- Impact: rebranding the palette requires editing `index.css` + 827 usages; dark mode has unthemed leftovers (POTENTIAL visual).
- Fix: map the palette into `tailwind.config.js` `theme.extend.colors` (CSS-variable backed) and codemod hexes to tokens; delete the attribute-selector layer.

### FE-19 (Medium, VERIFIED) Public footer leaks developer copy and shows an unverified trust seal
- Evidence: `StoreFooter.jsx:9,72-96`: when `VITE_ENAMAD_SEAL_LINK_URL` is unset the footer still renders the generic image `https://trustseal.enamad.ir/Content/Images/Star2/81.png` (hot-linked third party), and the caption literally tells customers "لینک اختصاصی اینماد را در VITE_ENAMAD_SEAL_LINK_URL تنظیم کنید." (`:93`). Inactive social icons have tooltips "برای فعال‌سازی، نشانی ... را در تنظیمات سایت وارد کنید." (`:69`) and the text "پیوندهای شبکه‌های اجتماعی از تنظیمات سایت خوانده می‌شوند." (`:76`); the newsletter says emails are not actually sent (`:140`); `StoreInfoPage.jsx:110` and `seo-utils.js:35-37` ship placeholder policy text ("سیاست نهایی مرجوعی باید از طرف فروشگاه تأیید شود") as indexed meta descriptions. Displaying an eNamad seal image without a verification link can read as a false trust claim.
- Fix: render the seal only when both image and link env vars exist; hide unconfigured social/enamad blocks; replace placeholder legal copy before launch.

### FE-20 (Medium, POTENTIAL) Admin/other numeric inputs are `type="number"` for Toman amounts with Persian-digit typists
- Evidence: price/stock/threshold inputs `CreateProductForm.jsx:188,192,291`, `ProductEditForm.jsx:254,258,338`, `ShippingSettings.jsx:55,58`, `CouponManager.jsx:146-162`, navbar price filters `Navbar.jsx:700-730`. Chrome/Firefox number inputs reject non-ASCII digits typed from a Persian keyboard layout (they only localize when the browser UI locale is fa), and there is no thousands separator for values like 1250000 (easy 10x typo with Rial/Toman confusion). Coupon code field normalizes case but not digits (`GiftCouponCard.jsx:50,59` `toUpperCase()` only; "TIK۲۰" typed on a Persian keyboard will not match).
- Fix: `type="text" inputMode="numeric"` + `normalizeDigits` + live `Intl.NumberFormat('fa-IR')` grouping, parse to integer on submit; reuse one normalizer (see FE-26).

---------------------------------------------------------------------
## C. LOW

### FE-21 (Low, VERIFIED) Login/Signup forward arrows point backwards in RTL; inline gallery vs lightbox prev/next sides disagree
- `LoginPage.jsx:67` and `SignUpPage.jsx:100` use `ArrowRight` + `group-hover:translate-x-1` on the submit button (forward in RTL is left); `PurchaseSuccessPage.jsx:69` also `ArrowRight` for "back to home" (acceptable for "back"). Elsewhere arrows are mirrored correctly (ArrowLeft for "view more": `HomePage.jsx:209,213,278`, `FeaturedProducts.jsx:34`; prev=ChevronRight/next=ChevronLeft `FeaturedProducts.jsx:47-48`, `IranianDateTimeInput.jsx:113,117`).
- Gallery inconsistency: inline `ProductDetailsPage.jsx:287-291` puts "previous" at `end-3` (physical left) with ArrowRight and "next" at `start-3` (physical right) with ArrowLeft; the lightbox `:492,494` puts "previous" on `right-3` (which index.css flips to physical LEFT) and "next" on `left-3` (flipped to RIGHT); keyboard `:167-173` ArrowLeft = next. So the same control sits on opposite sides in the two views (POTENTIAL visual). Date picker `IranianDateTimeInput.jsx:112-118` prev=right is correct.

### FE-22 (Low, VERIFIED) Mixed-direction text: `<bdi>` is never used; price presentation differs by container
- 0 uses of `<bdi>`. Latin product names, recipient names and phone numbers are interpolated into Persian sentences (`ProfilePage.jsx:316`, `OrderManagement.jsx:130`, aria-labels like `ProductCard.jsx:98` "ذخیره {product.name} ..."). Emails/phones/IDs are handled with `dir="ltr"` in many places (good: `OrderManagement.jsx:117,130,133,154`, `MyOrdersPage.jsx:95,128,131`, `CategoryManager.jsx:251,297,300`, email inputs via `index.css:64-67,80`).
- Prices: `formatPrice` returns "۱٬۲۰۰٬۰۰۰ تومان" (`lib/commerce.js:12-17`); several places wrap it in `dir="ltr"` (`CartItem.jsx:31`, `OrderSummary.jsx:342-369`, `MyOrdersPage.jsx:113,119`, `OrderManagement.jsx:121`) which puts the number left of "تومان", whereas product cards/details (no `dir`) place the number at the start-of-line (right) -> two visual conventions (POTENTIAL).
- Phone inputs have no `dir="ltr"`/`text-align:left` (`OrderSummary.jsx:301`, `ProfilePage.jsx:296`) unlike email/password.

### FE-23 (Low, VERIFIED) Native browser validation messages are not Persian
- 22 `<form>` elements, only 2 `noValidate` (grep) and 0 `setCustomValidity`; fields rely on `required`, `type="email"`, `minLength`, `pattern` (e.g. `StoreFooter.jsx:131`, `LoginPage.jsx:48`, `SignUpPage.jsx:73,81`, `CouponManager.jsx:141`, `CategoryManager.jsx:300`). Browser tooltips use the browser UI language (English on most Iranian desktops), mixing with Persian custom messages (`OrderSummary.jsx:34-41`, `password-policy.js`). Custom checkout messages are good Persian (mobile 09xxxxxxxxx, postal exactly 10 digits, address >= 10 chars).
- Also: mobile validation accepts only `^09\d{9}$` after normalizing +98/0098/98/9 prefixes (`OrderSummary.jsx:24-30,35`) - landlines rejected (acceptable for e-commerce, but undocumented); postal code accepts any 10 digits (real codes cannot contain 0 or 2 in some positions); recipient/city/address are not normalized for Arabic ي/ك or ZWNJ (names typed with Arabic letters are stored as typed; backend search normalizes, `backend/lib/persian-search.js`).
- `password-policy.js:3-8,25` requires Latin upper/lower for the "traditional" rule or a >=16-char mixed passphrase; the 72-byte limit means ~36 Persian characters (message talks about "UTF-8 bytes", `:35`).

### FE-24 (Low, VERIFIED) Redundant direction attributes
- `<html lang="fa" dir="rtl">` (`index.html:2`) plus `html{direction:rtl}` and `body{direction:rtl}` (`index.css:35,43`) plus 48 `dir="rtl"` attributes on page roots/components. Harmless but noisy, and `index.css:64-67` applies `unicode-bidi: plaintext` to every `[dir="ltr"]` element (affects display of numbers/punctuation inside them). No hreflang exists, which is correct for a single-locale site.

### FE-25 (Low, VERIFIED) Digit/character normalization is duplicated four times and absent where it matters
- Copies: `lib/persian-search.js:1-8` (`normalizeDigits`, used only by `CategoryPage.jsx:11,46`), `components/OrderSummary.jsx:19-23`, `pages/ProfilePage.jsx:22-32`, `lib/iranian-date.js` `toLatinDigits`. Persian-digit tolerance exists for checkout phone/postal and the date field only. Navbar/Shop search sends raw `q` (`Navbar.jsx:287-291`) and relies on the backend normalizer (exists, `backend/lib/persian-search.js`), while client-side category suggestions use plain `toLowerCase().includes` (`Navbar.jsx:216-219`) - mismatch between client suggestions and server results for ي/ك/Persian digits.
- Fix: one `lib/persian-text.js` exporting `normalizeDigits`/`normalizePersianText`, applied in suggestions, coupon, signup name.

### FE-26 (Low, VERIFIED) Jalali date module: correct approach, with limits (no hand-rolled leap rule)
- `lib/iranian-date.js` uses `Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', timeZone:'Asia/Tehran')` for all conversions (`:1-17`), derives year starts by probing +/-4 days (`:26-37`), month lengths 31/30 and Esfand = difference of year starts - 336 (`:39-46`), so leap years come from the engine's ICU calendar, not from a hand-written 33-year formula. Parsing round-trips and rejects invalid dates (`:111-125`). Tehran time is handled by Intl, so Iran's 2022 DST abolition depends on the browser's tzdata: engines older than tzdata 2022b would still apply DST for dates after March 2023 (POTENTIAL on very old browsers/Node builds).
- Limits: `jalaliToGregorian` only accepts years 1200-1600 (`:50`); relies on ICU's arithmetic Persian calendar (matches the official calendar for current years - e.g. 1403 leap per 33-cycle - but diverges in some historical years); `formatIranianTime` is exported and unused (`lib/iranian-date.js:~95`).
- `IranianDateTimeInput.jsx` UX: changing hour/minute after navigating to another month silently resets the day to 1 (`IranianDateTimeInput.jsx:49-52`); the hour/minute `type="number"` boxes coerce empty to 0 (`IranianDateTimeInput.jsx:151,154`); no focus/Esc handling (see FE-4); popover anchored with physical `right-0` (`:108`); remaining dark `bg-gray-*` classes depend on the dark-theme patch layer. No tests exist for any of this (tests cover refresh flow, SEO, error messages only).

### FE-27 (Low, VERIFIED) Toman/Rial handling is sound; minor dead parameter
- `lib/commerce.js:8-11` formats via `Intl.NumberFormat('fa-IR',{maximumFractionDigits:0})` on `Math.round(amount)`; no `toFixed`, no `parseFloat` in src (grep). Admin validates `Number.isSafeInteger(price)` (`ProductEditForm.jsx:176`). JSON-LD converts Toman->IRR with `Math.round(price*10)` (`seo-utils.js:254`) and OG `product:price:amount` is IRR x10 (`share-preview.js` `productPrice`, `server-utils.js:116-118`) - consistent. Coupon math `Math.round(subtotal*pct/100)` (`useCartStore.js:69`) equals the backend (`backend/lib/coupons.js:12`), so no display/charge drift. Dead second argument: ten call sites pass a currency to `formatPrice(value, currency)` but the function ignores it (`commerce.js:8`); `getCurrencyLabel()` takes no argument; the "IRT" check in `OrderSummary.jsx:126-135` is the only guard against a Rial-configured backend. `CouponManager.jsx:146` allows 0.5% steps while `Math.round` is applied (fine).
- Payment provider "zarinpal" is hard-coded in the UI (`OrderSummary.jsx:53,136,140,228`, `PurchaseSuccessPage.jsx:18-22`) - rebrand/provider-swap item, not a defect.

### FE-28 (Low, VERIFIED) Reduced motion and motion library
- `framer-motion` (11.x) animations in 9 files (`AdminPage`, `CartPage` with `x:±20` not RTL-aware, `LoginPage`, `SignUpPage`, `CategoryPage`, `OrderSummary`, `CreateProductForm`, `AnalyticsTab`, `PurchaseCancelPage`) with no `MotionConfig reducedMotion="user"` or `useReducedMotion` (grep 0). CSS side is covered by 9 `motion-reduce:` utilities and `index.css:179-183`. Spinners respect it (`App.jsx:43`).

### FE-29 (Low, VERIFIED) Admin navigation misuses ARIA roles
- `AdminPage.jsx:84` `<nav role="tablist" aria-orientation="vertical">` contains `<section>` and `<h2>` group wrappers (`:85`) - children of a tablist must be tabs; `nav` landmark is overridden by `tablist`. Arrow handling (`:58-62`) treats ArrowLeft/ArrowDown as next in a vertical list. Mobile uses a `<select>` (`:77-79`, fine). `AdminPage.jsx:70` wraps nothing in `<main>`; `CartPage.jsx` and `PurchaseCancelPage.jsx` have no `<main>`, `CartPage` has no `<h1>` (only `<h3>` in `EmptyCartUI`), `CategoryPage` uses `motion.h1` (OK). No skip-to-content link (grep) despite a very tall fixed header (`App.jsx:71` `pt-32 md:pt-44` hard-coded offsets, POTENTIAL CLS/overlap).

### FE-30 (Low, POTENTIAL) `overflow-x-hidden` on the app wrapper disables `position: sticky`
- `App.jsx:70` wrapper has `overflow-x-hidden`; descendants such as `AdminPage.jsx:83` `md:sticky md:top-5` (sidebar) then stick relative to that wrapper, not the viewport, so the sticky sidebar will not stick. Use `overflow-x-clip` instead.

### FE-31 (Low, VERIFIED) Heavy dependencies and import style
- All dependencies are used (grep): `recharts` only in `AnalyticsTab.jsx` (lazy via `AdminPage.jsx:7`, good); `react-confetti` only in `PurchaseSuccessPage.jsx` (page is lazy, good); `framer-motion` is statically imported by 9 files including the eagerly needed pages' chunks (Login/Signup/Cart/Category/Admin) - ~30-40 KB gz each chunk would share it; consider `LazyMotion` + `m`. `lucide-react` named imports in 47 files are tree-shakeable. Route-level `lazy()` is applied to all 20 pages (`App.jsx:13-32`) but `Navbar`, `StoreFooter`, `PageMeta`, `LoadingSpinner` and all of `lib/seo-utils.js` (377 lines, also bundled client-side) are in the main chunk. `vite.config.js` has no `manualChunks`, no `build.target`, no bundle analyzer. Giant components: `Navbar.jsx` 1363 lines/13 `useState`/embeds the product-filter UI that `CategoryPage.jsx` (916 lines, 5 `useState`, 6 effects with URL<->state sync via refs `:148-180`) duplicates; `OrderSummary.jsx` 410; `ProductDetailsPage.jsx` 501; admin files are minified-style one-liners (`AdminPage.jsx`, `DashboardOverview.jsx`, `ServiceCases.jsx`) which hurts maintainability.

### FE-32 (Low, VERIFIED) Dead code / leftovers
- Unused file assets: `public/vite.svg`, `public/screenshot-for-readme.png` (925 KB, referenced nowhere). Unused export: `formatIranianTime` (`lib/iranian-date.js`). Stock Vite README (`frontend/README.md`) is unmodified template text. `useProductStore.js:3` places `let categoryRequestCounter` between imports and the store has no `error` initial field though `set({error})` is called (`:25,:112`). Dead CSS: `index.css:80/89` duplicate, `:88` invalid selector (FE-3). Every component file is imported somewhere (checked by script).
- `frontend/package.json:9` `build` runs `npm test && vite build` so a failing Node test blocks deploys (good gate) but tests do not cover cart store, iranian-date, commerce, persian-search, or any component.

### FE-33 (Low, VERIFIED) PageMeta / head management details
- `PageMeta.jsx:72-155` rewrites ~20 head tags in an effect, and the cleanup resets everything to the default title/description on every dependency change (`:132-151`), causing head flicker; `product`/`itemList` identity in deps. On mount `removeJsonLd` deletes server-injected `seo-jsonld-*`, then re-adds client copies - fine. Default OG: `index.html` has no `og:image`, `twitter:card=summary`, and the home/static routes never pass an image (`api/page-shell.js` has no image) -> no preview image for the home page, `/shop`, policy pages (Medium for sharing quality on Telegram/WhatsApp, which matter for the Iranian market).
- Title rule `title.includes(SITE_NAME)` (`PageMeta.jsx:93`, `server-utils.js:86`) skips the brand suffix when the product title merely contains it; fine.
- JSON-LD: `OnlineStore` + `WebSite` + `Product` (offer in IRR) + `BreadcrumbList` + `CollectionPage/ItemList` are well-formed (`seo-utils.js:228-375`); gaps: no `WebSite.potentialAction` SearchAction, Product has no `brand`, `priceValidUntil`, `itemCondition`, `sku` is the Mongo `_id`.
- Canonicals: query-less except `?page=N` for `/shop` and `/category/*` (`seo-utils.js:128-150`), origin only from `PUBLIC_SITE_URL` or `VERCEL_PROJECT_PRODUCTION_URL` (`server-utils.js:22-36`): if only the Vercel production URL exists, canonicals/sitemap point at `*.vercel.app` instead of the custom domain (POTENTIAL, env dependent); with neither set, sitemap/robots return 404/no Sitemap line and pages are `noindex` (fail-closed, documented by tests).

### FE-34 (Low, VERIFIED) robots.txt and sitemap
- `api/robots.js:20-24` outputs only `User-agent: *`, `Allow: /`, `Sitemap:`. There is no `Disallow` for `/secret-dashboard`, `/cart`, `/profile`, `/orders`, `/wishlist`, `/login`, `/signup`, `/reset-password`, `/purchase-*`, nor for filtered/search URLs (`/shop?*`). Those pages are protected by `noindex` meta/header (private routes: `page-shell.js:67-76`), which is the correct indexing control (a `Disallow` would stop crawlers from seeing it), but crawl budget is wasted and the admin path is advertised in `vercel.json:82` and `seo-utils.js:74` metadata. Consider `Disallow: /*?` patterns for faceted URLs only.
- Sitemap: index at `/sitemap.xml` lists static + one `sitemap-products.xml?page=N` per 48 products (`api/sitemap.js:7,32-38`); capped at 5000 pages (240k URLs) and each file is far below the 50k/50MB limit, good. `PAGE_SIZE=48` relies on `/products/search` honoring `limit=48` and `totalPages`; a failure of the first call yields 503 for the whole index. `sitemap-static.js:10-26` hard-codes `/looks/daily-style|layers|details` and probes 7 hard-coded fashion category slugs with N extra API calls on each regeneration (`:73-89`). Campaign sitemap limited to `limit=100` (`:48`), categories unpaginated.
- Unknown paths: `page-shell.js:58-75` returns a real 404 with `noindex` for any path not in `STATIC_PAGE_META`/`PRIVATE_ROUTE_META`; share-preview returns 404 for unknown/inactive product/category/campaign (`share-preview.js:327-345,512-523`). So soft-404s are avoided for crawlers (VERIFIED), but every real SPA route must be listed in `STATIC_PAGE_META`/`PRIVATE_ROUTE_META` or it will 404 at the edge even though React has a route - e.g. `/looks/:slug` is handled via share-preview, but any new React route (like a future `/brands`) silently 404s on direct load. `NotFoundPage.jsx` is therefore only reachable via client-side navigation.

### FE-35 (Info, VERIFIED) Axios/refresh design is mostly sound
- Single-flight refresh via `createRefreshCoordinator` (`refresh-coordinator.js:11-19`) with `_retry` guard and auth-endpoint exclusion; tested (`refresh-flow.test.js:49,85`). Errors are centralised into Persian user messages (`lib/axios.js:11-26`, `user-error-message.js`), with stores reading `error.response.data.message` (already translated). Weak spots: no request timeout, no cancellation on route change in most pages, `console.error` of raw errors in stores, `Promise.reject(refreshError)` followed by `void logout()` (unawaited but handled), optimistic UI: none (cart/wishlist guest paths are local-first with no rollback needs; authenticated cart is server-first - no rollback problem). Unhandled rejections: `useUserStore.updateProfile` (`:70`) and `createProduct`/`updateProduct` rethrow to callers; callers wrap them (not exhaustively verified).

---------------------------------------------------------------------
## D. BRANDING INVENTORY (what must change to rebrand or change category)

### D1. Store name "تیک بوتیک" / "Tik Boutique" / "tik-boutique" (Persian name 62 occurrences in 26 files)
- Name constants (single source, good): `frontend/src/lib/seo-utils.js:1-3` (`SITE_NAME`, `DEFAULT_SEO_TITLE`, `DEFAULT_SEO_DESCRIPTION`) - but the same literal is duplicated elsewhere:
- Static HTML/PWA: `frontend/index.html:6,9,11,12,30`; `frontend/public/site.webmanifest:2,3` (name, short_name); `frontend/public/favicon.svg:2` (`<title>`, the glyph is a "T" tick mark on #252722 with accent #9baa8e `:3-5`).
- Server-side duplicates (not tied to SITE_NAME): `seo/server-utils.js:84,85,86,105,109`; `api/page-shell.js:15,19`; `api/share-preview.js:22,48,54,60,66,72,183,189,238,246,255,363,421,427,446`.
- Meta descriptions in `frontend/src/lib/seo-utils.js:12,16,44,48,52,59,63,67,71,75,83,103`; per page: `HomePage.jsx:149,157,180,194`, `ShopPage.jsx:115`, `CampaignsPage.jsx:31,33`, `CampaignPage.jsx:39,74`, `CollectionPage.jsx:32,90,108`, `CategoryPage.jsx:647,653`, `ProductDetailsPage.jsx:267,313`, `StoreInfoPage.jsx:23`, `ForgotPasswordPage.jsx:23,25`, `ResetPasswordPage.jsx:35,37`, `NotFoundPage.jsx:28,33`, `ProfilePage.jsx:260`, `LoginPage.jsx:31`, `SignUpPage.jsx:48`.
- UI wordmark/header/footer: `Navbar.jsx:958,961,1103,1137` (logo text, aria-label, drawer title/welcome); `StoreFooter.jsx:47,55,78,126,147` (brand link, aria-labels, newsletter title, copyright + trademark sentence). `LoadingSpinner.jsx:27` uses the generic word "فروشگاه." (already brand-neutral).
- Coupon placeholder "مثلاً TIK20": `GiftCouponCard.jsx:52`.
- Storage / file keys: `localStorage` `tik-boutique-guest-cart` (`useCartStore.js:5`), `tik-boutique-saved-products` (`useWishlistStore.js:4`), `tik-boutique-theme` (`index.html:20`, `Navbar.jsx:79,158`), `tik-boutique-recently-viewed` (`ProductDetailsPage.jsx:135,152`); CSV export filename `tik-boutique-sales-<n>d.csv` (`AnalyticsTab.jsx:51`). Renaming keys orphans existing users' carts/wishlists - migrate or read old keys once.
- Tests encode the brand: `frontend/tests/seo-utils.test.js` (1), `seo-handlers.test.js` (1).
- Must change for rebrand: all of the above; recommended refactor: a single `brand.config.js` (name, tagline, category noun, domain, support email, storage prefix) imported by both the SPA and `api/`/`seo/` (they already import `frontend/src/lib/seo-utils.js`, so putting `SITE_NAME` there and replacing the 20+ copied literals works).

### D2. Domains / URLs / infra
- Backend host hard-coded: `vercel.json:7` `https://mern-ecommerce-api-tau.vercel.app/api/:path*`. Storefront domain is NOT hard-coded anywhere (good): derived from `PUBLIC_SITE_URL`/`VERCEL_PROJECT_PRODUCTION_URL` (`seo/server-utils.js:22-36`) and `VITE_PUBLIC_SITE_URL` (`PageMeta.jsx:82`).
- Env-driven brand/contact items: `VITE_STORE_SUPPORT_EMAIL` (`StoreFooter.jsx:8`, `StoreInfoPage.jsx:8`, `PageMeta.jsx:116`, `server-utils.js:127`), `VITE_STORE_INSTAGRAM_URL|TELEGRAM_URL|X_URL` (`StoreFooter.jsx:12-14`), `VITE_ENAMAD_SEAL_IMAGE_URL|LINK_URL` (`StoreFooter.jsx:9-10`), third-party image `https://trustseal.enamad.ir/Content/Images/Star2/81.png` (`StoreFooter.jsx:9`), `VITE_API_URL` (`lib/axios.js:4`), `API_BASE_URL` (`server-utils.js:38`). No phone number, street address or company/legal-entity name exists in the frontend (contact blocks say "not configured": `StoreInfoPage.jsx:109-110`, `StoreFooter.jsx:141`). Payment provider name "zarinpal": `OrderSummary.jsx:53,136,140,228`, `PurchaseSuccessPage.jsx:18-22`.
- Fonts from Google: `index.css:1` (see FE-5).

### D3. Colors (hex) - palette is "warm paper + sage green"
- Tokens (`frontend/src/index.css:3-17` light, `:189-212` dark): canvas #f7f5f0, surface #fffefa, raised #f2f0e9, text #252722, strong #41443b, muted #62645c, border #e4e0d8/#c7c3b9, hover #e9ede4, accent #68745f (hover #41443b), chart secondary #536b9c, success #356b4a, danger #8b3d34, warning #805b17; dark: #090a0c/#111318/#171a20, accent champagne #d6b779 (#e4c989), etc.
- `!important` attribute overrides: `index.css:24-27` (`[class~="bg-[#68745f]"]`, `hover:bg-[#68745f]`, `hover:bg-[#41443b]`, `text-[#68745f]`, `border-[#68745f]`) and dark remaps `:189-340` for bg/border/text hexes `#f7f5f0 #fffefa #f2f0e9 #e9ede4 #e9e5dc #dce2d4 #dfe5d6 #ebe8df #252722 #41443b #68745f #e4e0d8 #eeeae2 #eeeae1 #dedbd2 #d5d0c5 #e0dcd2 #55574f #62645c #77786f #85867d #9a9a90 #a0a195 #526149 #9aa58e` and `bg/text/border-gray-*`.
- Hex usage in JSX: 827 occurrences, top: #68745f x213, #252722 x120, #41443b x75, #fffefa x48, #62645c x44, #77786f x42, #e4e0d8 x41, #d5d0c5 x39, #e9ede4 x27, #9aa58e x20, #f7f5f0 x19.
- Outside Tailwind: `index.html:7,22-24` theme-color #f7f5f0 / #090a0c; `site.webmanifest:7,8` background/theme #f7f5f0; `favicon.svg:3-5` #252722/#f7f5f0/#9baa8e; `Navbar.jsx:156` theme-color; server-rendered HTML inline styles in `api/share-preview.js` (e.g. `:89-97,121,246`: #252722 #68745f #62645c #e4e0d8 #fffefa #526149) and `api/page-shell.js:18-20`. To rebrand colors: edit tokens in `index.css` + codemod hexes (FE-18) + the 3 non-CSS places + both api/ HTML templates.

### D4. Logo / favicon / imagery
- Logo is plain text in a serif face (`Navbar.jsx:958-961`, `StoreFooter.jsx:47`, `SignUpPage.jsx:48`, `LoginPage.jsx:31`, `ForgotPasswordPage.jsx:25`, `ResetPasswordPage.jsx:37`); favicon/maskable icon is a single SVG (`public/favicon.svg`, used as `purpose: "any maskable"` in the manifest - an SVG of `sizes:any` is not accepted for PWA install criteria; no PNG 192/512 icons exist: POTENTIAL, installability). No apple-touch-icon, no default `og:image`.
- Fashion photos in `public/`: jeans.jpg, tshirts.jpg, shoes.jpg, glasses.png, jackets.jpg, suits.jpg, bags.jpg (3.4 MB total) referenced at `HomePage.jsx:15-21,25-27,51,102`, `CollectionPage.jsx:12,18,24`, `api/share-preview.js:75-100` (`image: "/jeans.jpg"` etc.).

### D5. Fashion-specific copy, categories and attributes (must change to sell another category)
- Hard-coded category slug->label maps (7 legacy slugs jeans, t-shirts, shoes, glasses, jackets, suits, bags) in at least 10 places: `Navbar.jsx:33-39,95-97`; `ProductCard.jsx:10-11`; `ProductsList.jsx:10`; `CreateProductForm.jsx:21-29` (fake `legacy:*` category docs); `ProductDetailsPage.jsx:15`; `CategoryPage.jsx:16-22`; `HomePage.jsx:15-21`; `CollectionPage.jsx:8-27`; `api/share-preview.js:24-42,75-100`; `api/sitemap-static.js:16-18,73`. Dynamic categories already exist (`useCategoryStore`, `CategoryManager.jsx`) and `HomePage.jsx:43-52` prefers them, so the legacy maps are fallbacks that can be deleted once the DB is the source of truth.
- Curated "looks"/collections: routes `App.jsx:80` `/looks/:slug`, `vercel.json:38-41`, `CollectionPage.jsx:8-27`, `HomePage.jsx:24-28,367-376`, `sitemap-static.js:16-18`, `share-preview.js:75-100` with fashion copy "استایل روزمره / لایه‌های ماندگار / جزئیات تکمیل‌کننده".
- Apparel attribute model: size & color variants and "fit/تن‌خور" (true-to-size, oversized...) are first-class: `ProductDetailsPage.jsx:17-21,321-374` (size chips, size guide table `:398`, fit section), `ProductCard.jsx` color swatches/`رنگ`, `CreateProductForm.jsx`/`ProductEditForm.jsx` variant grid, `CategoryPage.jsx` facets (sizes/colors/fits/brands), `seo-utils.js:229-237` JSON-LD `additionalProperty` names "سایز", "رنگ", "توضیحات تن‌خور", `share-preview.js:155-175`, `useCartStore.js` `selectedSize/selectedColor` keys, `OrderSummary`/orders display. Counts: "سایز" 51 lines/12 files, "تن‌خور" 15/6, "رنگ" 31/11.
- Marketing copy: "پوشاک و اکسسوری" in `index.html:6,12,30`, `site.webmanifest:2`, `seo-utils.js:2-3,11`, `server-utils.js:84-85`, `HomePage.jsx:149,204`, `ShopPage.jsx:115`, `share-preview.js:47`; "استایل" `StoreFooter.jsx:48`, `HomePage.jsx:198`, `Navbar.jsx:1138,1284`; "روزهای خنک" seasonal copy `CollectionPage.jsx:21`, `HomePage.jsx:26`.
- Policy / legal text: `StoreInfoPage.jsx` (all six policies are generic and explicitly say the store has not registered final terms), `StoreFooter.jsx:147-148` copyright/trademark paragraph, `seo-utils.js:30-45` meta descriptions; admin dashboard titles `PRIVATE_ROUTE_META["/secret-dashboard"]` (`seo-utils.js:73-76`) and the route name itself `/secret-dashboard` (`App.jsx:87`, `vercel.json:82`).

### D6. i18n verdict: NOT needed
- Evidence: single locale/market everywhere: `<html lang="fa" dir="rtl">` (`index.html:2`), `og:locale=fa_IR` (`PageMeta.jsx:98`, `server-utils.js:107`), `inLanguage: "fa-IR"` (`seo-utils.js:361`), Jalali calendar + Tehran timezone + Toman + 09xx mobile + 10-digit postal code + Zarinpal/eNamad (Iran-only), all UI strings are inline Persian literals (no resource bundle, no i18n library in `frontend/package.json`), the backend error translator maps English->Persian only (`lib/user-error-message.js`). Categories carry `name.fa/name.en` (`HomePage.jsx:49`, `CategoryManager.jsx:297`) but the UI always shows fa first, English is an admin slug aid. Adding an i18n framework would be cost without a requirement. What IS valuable: externalize brand/category strings into one config (D1) and one `lib/persian-text.js` (FE-25), not translation catalogs. Revisit only if a second language/market is planned (then also fix FE-3 first, since logical properties are a prerequisite for LTR support).

---------------------------------------------------------------------
## E. Good practices observed (no action)
- `lang="fa" dir="rtl"` on `<html>`; `aria-hidden` on decorative icons nearly everywhere; labels via `htmlFor`/`sr-only`; password show/hide has aria-label; product lightbox and nav drawer have exemplary focus management; `aria-live`/`role="status"`/`role="alert"` used for loading and errors; skeleton/empty/error states with retry exist on Home, Product, Campaign, Collection, Orders pages; reduced-motion utilities present; route-level code splitting incl. 14 lazy admin tabs; no `dangerouslySetInnerHTML` anywhere in src (SSR HTML escapes via `escapeHtml`/`safeJson`, `seo-utils.js:152-172`); no secrets or tokens in storage; `window.location.assign` for payment only accepts `https://` redirect (`OrderSummary.jsx:233`); `Intl`-based Jalali date handling rather than a hand-rolled leap-year table; integer-only price math.

## F. Summary count
High 4 (FE-1..4), Medium 16 (FE-5..20), Low 14 (FE-21..34), Info 1 (FE-35). Top priorities: FE-1/FE-2 (auth gating of the whole UI), FE-3 (RTL inversion layer), FE-5 (Google Fonts), FE-13 (page-shell single point of failure), FE-19 (public dev/placeholder copy and unverified eNamad seal), D1 (brand config).

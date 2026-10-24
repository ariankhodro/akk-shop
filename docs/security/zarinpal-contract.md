# Zarinpal v4 response contract used by this shop

STATUS: **NOT sandbox-verified.** The official docs (docs.zarinpal.com / www.zarinpal.com/docs) were
unreachable from the environment that produced this file (DNS failure), and no sandbox merchant
credentials were available. What is below is reconstructed from the author's recollection of the
official v4 docs plus public search snippets that confirmed only: the verify endpoint path, code `100`
= verified, code `101` = already verified. Every other code meaning is **unconfirmed** and must be
checked against the current docs / a sandbox before relying on it (roadmap item Z-0). The fixture files
in `backend/tests/fixtures/zarinpal/` carry the label "CONSTRUCTED FROM OFFICIAL DOCS AS RECALLED - NOT
RECORDED FROM A LIVE SANDBOX", and a test enforces that label.

The mapping is implemented in exactly one module: `backend/lib/zarinpal-codes.js`
(unit test: `backend/tests/zarinpal-codes.test.js`).

## Endpoints (base `https://api.zarinpal.com/pg/v4/payment`, sandbox `https://sandbox.zarinpal.com/pg/v4/payment`)

| Call | Method + path | Body |
|---|---|---|
| Payment request | `POST /request.json` | `merchant_id, amount (Rial), callback_url, description, metadata` |
| Verify | `POST /verify.json` | `merchant_id, amount (Rial), authority` |
| Inquiry (not used yet) | `POST /inquiry.json` | `merchant_id, authority` - returns a session status |
| Unverified list (not used yet) | `POST /unVerified.json` | `merchant_id` |

Amounts are Rial; this shop stores Toman and multiplies by 10 at the gateway boundary only.
Callback: `GET callback_url?Authority=...&Status=OK|NOK`. `Status` is a browser-supplied hint and is
never trusted; the shop always verifies server-side.

## Response shapes

Success: `{"data":{"code":100,"message":"Verified","card_hash":"...","card_pan":"502229******5995","ref_id":201,"fee_type":"Merchant","fee":0},"errors":[]}`
(`code` 101 = already verified, same shape; request success carries `data.authority`).

Failure: `{"data":[],"errors":{"code":-51,"message":"...","validations":[]}}` - note `data` is an empty
**array** and `errors` is an object. On success `errors` is an empty array. Legacy / older shapes put the
code under `data.code`; the parser reads `errors.code` first and then `data.code`. A success code is
accepted only from `data.code` with HTTP 2xx.

## Code semantics used for decisions

| Code | Meaning (unconfirmed unless marked) | Shop decision |
|---|---|---|
| 100 | verified (confirmed) | paid (only with matching amount, see below) |
| 101 | already verified (confirmed) | paid (idempotent re-verify) |
| -51 | payment failed / not paid | **definitive unpaid** - may fail/expire and release |
| -54 | invalid authority | **definitive unpaid** (unknown, or lifetime passed without payment) |
| -50 | paid amount differs from verify amount | **hold + manual review**; never failed, never paid |
| -9 | request validation error | uncertain on verify; on `request.json` = request rejected |
| -10 | invalid IP / merchant id (merchant-side) | uncertain |
| -11 | merchant inactive (merchant-side) | uncertain |
| -12 | too many attempts (rate limit) | uncertain / retry later |
| -15 | terminal suspended | uncertain |
| -16 | merchant access level too low | uncertain |
| -52 | unexpected provider error | uncertain |
| -53 | authority does not belong to merchant | uncertain (config problem) |
| -55 | transaction not found (unsure) | uncertain (conservative) |
| -21, -22, -42 | legacy v1 codes | uncertain (not part of v4) |
| anything else, HTTP 5xx, timeouts, unparseable body | - | uncertain: keep stock/coupon reserved, retry with backoff |

The previous terminal set `{-11,-12,-21,-22,-42}` (BIZ-2) was wrong: -11/-12 are merchant/rate-limit
answers that say nothing about the transaction.

## Rules enforced in code

1. Never mark `paid` without verify code 100/101 under `data.code`, HTTP 2xx, and (if the provider echoes
   `data.amount`) an amount equal to `order.totalAmount * 10`. Otherwise amount mismatch => hold + flag.
2. Only the codes in `ZARINPAL_UNPAID_TERMINAL_CODES` may fail/expire an order. A structured terminal code
   is trusted on HTTP 4xx as well (deliberate deviation from "all 4xx are uncertain"; reason: if Zarinpal
   reports -51/-54 with a 4xx status, strict handling would hold abandoned stock forever. This is safe
   because a failed/expired order is re-verified on the next callback and recovered as
   `paid_after_expiry`). Confirm in sandbox; tighten by editing `classifyVerifyResponse` if the provider
   always uses HTTP 200.
3. A request is "rejected" (stock released) only when a negative code is present and HTTP < 500.
4. Orders with an authority are expired only after `expiresAt + 15 min` grace AND a final verify that
   returns a definitive unpaid code. If the provider stays unreachable the order keeps holding stock
   and the reconciler logs `PAYMENT_HOLD_ALERT` once the order is older than 24 h.

## Items needing sandbox confirmation

- Exact HTTP status used for -51 / -54 / -50 on verify (200 vs 4xx).
- Meaning of -55 and -53 on verify; whether `-54` can occur for a paid-then-reversed session.
- Whether verify echoes `amount`; whether `unVerified.json` / `inquiry.json` should become the
  authoritative pre-expiry check (not implemented; verify is used).
- Authority lifetime (the shop assumes it is over 45 min after order creation).

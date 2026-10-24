import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExpiredPendingFilter,
  buildStrandedOrdersFilter,
  isCronSecretAcceptable,
  mapWithConcurrency,
  PAYMENT_AUTHORITY_GRACE_MS,
  getDueReconciliationFilter,
  getNextReconciliationDelayMs,
  PAYMENT_RECONCILIATION_BATCH_SIZE,
  PAYMENT_RECONCILIATION_LOCK_TTL_MS,
} from "../lib/payment-reconciliation.js";

test("reconciliation retries use bounded exponential backoff with jitter", () => {
  const minute = 60 * 1000;
  assert.equal(getNextReconciliationDelayMs(1, () => 0), 4 * minute);
  assert.equal(getNextReconciliationDelayMs(1, () => 1), 6 * minute);
  assert.equal(getNextReconciliationDelayMs(2, () => 0.5), 10 * minute);
  assert.equal(getNextReconciliationDelayMs(20, () => 1), 6 * 60 * minute);
  assert.equal(getNextReconciliationDelayMs(0, () => 0.5), 5 * minute);
});

test("reconciliation batch and lock limits stay within the scheduled function budget", () => {
  assert.equal(PAYMENT_RECONCILIATION_BATCH_SIZE, 5);
  assert.ok(PAYMENT_RECONCILIATION_LOCK_TTL_MS > 60_000);
  assert.ok(PAYMENT_RECONCILIATION_BATCH_SIZE <= 10);
});

test("due filter selects legacy orders without retry metadata and retries whose backoff elapsed", () => {
  const now = new Date("2026-10-22T12:00:00.000Z");
  const due = getDueReconciliationFilter(now);
  assert.equal(due.$or.length, 3);
  assert.deepEqual(due.$or[0], { reconciliationNextAttemptAt: { $exists: false } });
  assert.deepEqual(due.$or[1], { reconciliationNextAttemptAt: null });
  assert.deepEqual(due.$or[2], { reconciliationNextAttemptAt: { $lte: now } });
});

test("stranded-order query keeps both the reserved clause and the due clause (BIZ-3)", () => {
  const now = new Date("2026-10-22T12:00:00.000Z");
  const filter = buildStrandedOrdersFilter(now);
  assert.equal(filter.$or, undefined, "a top-level $or would be overwritten by the due filter's $or");
  assert.equal(filter.$and.length, 2);
  assert.deepEqual(filter.$and[0].$or, [
    { products: { $elemMatch: { stockReserved: true } } },
    { couponReservationStatus: "reserved" },
  ]);
  assert.deepEqual(filter.$and[1], getDueReconciliationFilter(now));
  assert.deepEqual(filter.paymentStatus, { $in: ["failed", "expired"] });
  // The old buggy composition, for contrast:
  const buggy = { $or: [{ a: 1 }], ...getDueReconciliationFilter(now) };
  assert.equal(buggy.$or.length, 3);
});

test("expired-pending query waits the authority grace window only for orders holding an authority", () => {
  const now = new Date("2026-10-22T12:00:00.000Z");
  const filter = buildExpiredPendingFilter(now);
  const [lifetime, due] = filter.$and;
  assert.deepEqual(due, getDueReconciliationFilter(now));
  assert.deepEqual(lifetime.$or[0].expiresAt, { $lte: now });
  assert.deepEqual(lifetime.$or[1].expiresAt, { $lte: new Date(now.getTime() - PAYMENT_AUTHORITY_GRACE_MS) });
});

test("CRON_SECRET must be at least 32 characters", () => {
  assert.equal(isCronSecretAcceptable("x".repeat(31)), false);
  assert.equal(isCronSecretAcceptable("x".repeat(32)), true);
  assert.equal(isCronSecretAcceptable(undefined), false);
});

test("mapWithConcurrency never exceeds its limit and keeps result order", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3);
});

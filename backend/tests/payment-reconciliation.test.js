import test from "node:test";
import assert from "node:assert/strict";
import {
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

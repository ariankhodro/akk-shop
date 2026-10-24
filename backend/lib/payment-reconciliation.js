// Adaptive batching (BIZ-9): a phase starts with BATCH_SIZE items and doubles the batch
// (up to MAX_BATCH_SIZE) while work remains, the per-phase cap is not reached and the
// wall-clock budget is not spent.
export const PAYMENT_RECONCILIATION_BATCH_SIZE = 5;
export const PAYMENT_RECONCILIATION_MAX_BATCH_SIZE = 50;
export const PAYMENT_RECONCILIATION_MAX_ITEMS_PER_PHASE = 250;
export const PAYMENT_RECONCILIATION_VERIFY_CONCURRENCY = 5;
// Stop starting new items after this long (Vercel maxDuration is 60 s).
export const PAYMENT_RECONCILIATION_TIME_BUDGET_MS = 40_000;
export const PAYMENT_RECONCILIATION_LOCK_TTL_MS = 70_000;
// Authority lifetime is assumed to be well over the 30 min order lifetime; an order
// holding an authority is only verified-for-expiry this long after expiresAt.
export const PAYMENT_AUTHORITY_GRACE_MS = 15 * 60 * 1000;
// A pending order the provider never answered definitively for this long raises an alert.
export const PAYMENT_HOLD_ALERT_AGE_MS = 24 * 60 * 60 * 1000;
export const CRON_SECRET_MIN_LENGTH = 32;

const BASE_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

// Spread retries to avoid a thundering herd. The cap applies after jitter, so
// repeated failures are never delayed by more than six hours.
export const getNextReconciliationDelayMs = (attemptNumber, random = Math.random) => {
  const attempt = Number.isSafeInteger(attemptNumber) && attemptNumber > 0 ? attemptNumber : 1;
  const base = Math.min(BASE_RETRY_DELAY_MS * (2 ** Math.min(attempt - 1, 16)), MAX_RETRY_DELAY_MS);
  const randomValue = Number(random());
  const normalizedRandom = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0.5;
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base * (0.8 + normalizedRandom * 0.4)));
};

export const getDueReconciliationFilter = (now = new Date()) => ({
  $or: [
    { reconciliationNextAttemptAt: { $exists: false } },
    { reconciliationNextAttemptAt: null },
    { reconciliationNextAttemptAt: { $lte: now } },
  ],
});

export const buildStrandedOrdersFilter = (now = new Date()) => ({
  paymentProvider: "zarinpal",
  currency: "IRT",
  paymentStatus: { $in: ["failed", "expired"] },
  // $and, not a spread: getDueReconciliationFilter() also returns an $or and would
  // silently replace the reserved-stock/coupon condition (BIZ-3).
  $and: [
    { $or: [{ products: { $elemMatch: { stockReserved: true } } }, { couponReservationStatus: "reserved" }] },
    getDueReconciliationFilter(now),
  ],
});

export const buildExpiredPendingFilter = (now = new Date()) => ({
  paymentProvider: "zarinpal",
  currency: "IRT",
  paymentStatus: "pending",
  $and: [
    {
      $or: [
        { zarinpalAuthority: { $in: [null, ""] }, expiresAt: { $lte: now } },
        { zarinpalAuthority: { $nin: [null, ""] }, expiresAt: { $lte: new Date(now.getTime() - PAYMENT_AUTHORITY_GRACE_MS) } },
      ],
    },
    getDueReconciliationFilter(now),
  ],
});

export const isCronSecretAcceptable = (secret) => typeof secret === "string" && secret.length >= CRON_SECRET_MIN_LENGTH;

export const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

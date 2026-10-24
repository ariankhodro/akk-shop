export const PAYMENT_RECONCILIATION_BATCH_SIZE = 5;
export const PAYMENT_RECONCILIATION_LOCK_TTL_MS = 70_000;

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

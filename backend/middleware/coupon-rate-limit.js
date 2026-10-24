import { createRateLimiter } from "./rate-limit.middleware.js";

// POST /api/coupons/validate lets any account probe codes; keep it far below the
// global API limit (BIZ-7). Per-IP, shared Redis window with a per-instance fallback.
export const couponValidateRateLimit = createRateLimiter({
  name: "coupon-validate",
  limit: 10,
  windowSeconds: 60,
  message: "درخواست‌های بررسی کد تخفیف زیاد است؛ کمی بعد دوباره تلاش کنید.",
});

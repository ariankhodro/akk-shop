import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCouponDiscount,
  couponEligibilityError,
  normalizeCouponCode,
} from "../lib/coupons.js";

const now = new Date("2026-10-15T12:00:00.000Z");
const activeCoupon = (overrides = {}) => ({
  code: "TIK20",
  isActive: true,
  discountPercentage: 20,
  startsAt: new Date("2026-10-01T00:00:00.000Z"),
  expiresAt: new Date("2026-11-01T00:00:00.000Z"),
  minOrderAmount: 0,
  maxDiscountAmount: null,
  usageLimit: null,
  usageCount: 0,
  reservedCount: 0,
  ...overrides,
});

test("coupon codes are normalized without accepting non-text input", () => {
  assert.equal(normalizeCouponCode("  tik20 "), "TIK20");
  assert.equal(normalizeCouponCode(null), "");
});

test("percentage discounts use whole Toman and respect the optional cap", () => {
  assert.equal(calculateCouponDiscount(activeCoupon(), 1001), 200);
  assert.equal(calculateCouponDiscount(activeCoupon({ discountPercentage: 12.5 }), 1001), 125);
  assert.equal(calculateCouponDiscount(activeCoupon({ maxDiscountAmount: 90 }), 1001), 90);
  assert.equal(calculateCouponDiscount(activeCoupon({ discountPercentage: 100 }), 1001), 1001);
  assert.equal(calculateCouponDiscount(activeCoupon(), -1), 0);
});

test("invalid, inactive, not-yet-started, and expired coupons are rejected", () => {
  assert.match(couponEligibilityError(null, 500, now), /معتبر نیست/);
  assert.match(couponEligibilityError(activeCoupon({ isActive: false }), 500, now), /غیرفعال/);
  assert.match(couponEligibilityError(activeCoupon({ startsAt: new Date("2026-10-16T00:00:00.000Z") }), 500, now), /هنوز/);
  assert.match(couponEligibilityError(activeCoupon({ expiresAt: now }), 500, now), /منقضی/);
});

test("minimum order and total usage limits include reserved checkouts", () => {
  assert.match(couponEligibilityError(activeCoupon({ minOrderAmount: 2000 }), 1999, now), /کافی نیست/);
  assert.match(couponEligibilityError(activeCoupon({ usageLimit: 5, usageCount: 3, reservedCount: 2 }), 500, now), /تکمیل شده/);
  assert.equal(couponEligibilityError(activeCoupon({ usageLimit: 5, usageCount: 3, reservedCount: 1 }), 500, now), "");
});

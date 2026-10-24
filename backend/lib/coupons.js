import mongoose from "mongoose";
import Coupon, { CouponRedemption, CouponUserUsage } from "../models/coupon.model.js";
import Order from "../models/order.model.js";

export const normalizeCouponCode = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

export const DEFAULT_PER_USER_LIMIT = 1;

// null = unlimited (explicit admin choice); anything else invalid/missing falls back to 1.
export const effectivePerUserLimit = (coupon) => {
  if (coupon?.perUserLimit === null) return null;
  const limit = Number(coupon?.perUserLimit);
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : DEFAULT_PER_USER_LIMIT;
};

export const COUPON_PER_USER_LIMIT_MESSAGE = "شما حداکثر دفعات مجاز استفاده از این کد تخفیف را مصرف کرده‌اید.";

// Informational (non-atomic) check used by the validate endpoint and as a pre-check.
export const couponUserLimitError = async (coupon, userId, { session } = {}) => {
  const limit = effectivePerUserLimit(coupon);
  if (limit === null || !userId || !coupon?._id) return "";
  let query = CouponUserUsage.findOne({ coupon: coupon._id, user: userId }).select("count");
  if (session) query = query.session(session);
  const usage = await query.lean();
  return (usage?.count || 0) >= limit ? COUPON_PER_USER_LIMIT_MESSAGE : "";
};

export const calculateCouponDiscount = (coupon, subtotal) => {
  const base = Number(subtotal);
  const percentage = Number(coupon?.discountPercentage);
  if (!Number.isSafeInteger(base) || base < 0 || !Number.isFinite(percentage) || percentage <= 0) return 0;
  const rawDiscount = Math.round(base * percentage / 100);
  const cap = coupon?.maxDiscountAmount == null ? null : Number(coupon.maxDiscountAmount);
  return Math.min(rawDiscount, Number.isSafeInteger(cap) && cap >= 0 ? cap : Number.MAX_SAFE_INTEGER, base);
};

export const couponEligibilityError = (coupon, subtotal, now = new Date()) => {
  if (!coupon) return "کد تخفیف معتبر نیست.";
  if (!coupon.isActive) return "این کد تخفیف غیرفعال است.";
  const startsAt = coupon.startsAt ? new Date(coupon.startsAt) : null;
  const expiresAt = coupon.expiresAt ? new Date(coupon.expiresAt) : null;
  if (startsAt && startsAt > now) return "زمان استفاده از این کد تخفیف هنوز نرسیده است.";
  if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt <= now) return "این کد تخفیف منقضی شده است.";
  if (Number(coupon.minOrderAmount || 0) > Number(subtotal)) return "مبلغ سبد خرید برای استفاده از این کد تخفیف کافی نیست.";
  const limit = coupon.usageLimit == null ? null : Number(coupon.usageLimit);
  const used = Math.max(0, Number(coupon.usageCount) || 0);
  const reserved = Math.max(0, Number(coupon.reservedCount) || 0);
  if (limit !== null && used + reserved >= limit) return "ظرفیت استفاده از این کد تخفیف تکمیل شده است.";
  return "";
};

export const reserveCoupon = async (codeInput, subtotal, now = new Date(), { session, userId = null, orderId = null } = {}) => {
  const code = normalizeCouponCode(codeInput);
  if (!code) return { coupon: null, discountAmount: 0, error: "" };

  let lookup = Coupon.findOne({ code });
  if (session) lookup = lookup.session(session);
  let coupon = await lookup.lean();
  const error = couponEligibilityError(coupon, subtotal, now);
  if (error) return { coupon: null, discountAmount: 0, error };

  const filter = {
    code,
    isActive: true,
    startsAt: { $lte: now },
    expiresAt: { $gt: now },
    minOrderAmount: { $lte: subtotal },
  };
  filter.$expr = {
    $or: [
      { $eq: [{ $ifNull: ["$usageLimit", null] }, null] },
      {
        $lt: [
          { $add: [{ $ifNull: ["$usageCount", 0] }, { $ifNull: ["$reservedCount", 0] }] },
          "$usageLimit",
        ],
      },
    ],
  };

  const updateOptions = { new: true };
  if (session) updateOptions.session = session;
  coupon = await Coupon.findOneAndUpdate(filter, { $inc: { reservedCount: 1 } }, updateOptions);
  if (!coupon) {
    let currentQuery = Coupon.findOne({ code });
    if (session) currentQuery = currentQuery.session(session);
    const current = await currentQuery.lean();
    return {
      coupon: null,
      discountAmount: 0,
      error: couponEligibilityError(current, subtotal, now) || "امکان رزرو این کد تخفیف وجود ندارد؛ دوباره تلاش کنید.",
    };
  }

  if (userId) {
    // Per-user gate, atomic with the global counter when a session is supplied. The
    // caller aborts its transaction on error, which also rolls the global increment back.
    const rollback = async () => { if (!session) await releaseCouponReservationByCode(code); };
    const limit = effectivePerUserLimit(coupon);
    if (limit !== null) {
      const preCheck = await couponUserLimitError(coupon, userId, { session });
      if (preCheck) { await rollback(); return { coupon: null, discountAmount: 0, error: preCheck }; }
      try {
        await CouponUserUsage.findOneAndUpdate(
          { coupon: coupon._id, user: userId, count: { $lt: limit } },
          { $inc: { count: 1 } },
          session ? { upsert: true, session } : { upsert: true }
        );
      } catch (error) {
        if (error?.code !== 11000) throw error;
        await rollback();
        return { coupon: null, discountAmount: 0, error: COUPON_PER_USER_LIMIT_MESSAGE };
      }
    }
    if (orderId) {
      await CouponRedemption.create(
        [{ coupon: coupon._id, code, user: userId, order: orderId, status: "reserved" }],
        session ? { session } : {}
      );
    }
  }
  return { coupon, discountAmount: calculateCouponDiscount(coupon, subtotal), error: "" };
};

// Counter bookkeeping shared by release and redeem. Both are no-ops for reservations
// made before per-user tracking existed (no redemption record).
const settleRedemption = async (orderId, nextStatus, session) => {
  const redemption = await CouponRedemption.findOneAndUpdate(
    { order: orderId, status: "reserved" },
    { $set: { status: nextStatus } },
    { session }
  );
  if (redemption && nextStatus === "released") {
    await CouponUserUsage.updateOne(
      { coupon: redemption.coupon, user: redemption.user, count: { $gt: 0 } },
      { $inc: { count: -1 } },
      { session }
    );
  }
};

// A deleted coupon cannot be decremented; settle the order instead of failing forever.
const couponMissing = async (code, session) => !(await Coupon.exists({ code }).session(session));

export const releaseCouponReservationForOrder = async (orderId) => {
  const session = await mongoose.startSession();
  let released = false;
  try {
    await session.withTransaction(async () => {
      released = false;
      const order = await Order.findOne({
        _id: orderId,
        couponReservationStatus: "reserved",
      }).session(session).lean();
      if (!order) return;
      if (!order.couponCode) throw new Error("COUPON_RESERVATION_CODE_MISSING");

      const couponResult = await Coupon.updateOne(
        { code: order.couponCode, reservedCount: { $gt: 0 } },
        { $inc: { reservedCount: -1 } },
        { session }
      );
      if (!couponResult.modifiedCount) {
        if (!(await couponMissing(order.couponCode, session))) throw new Error("COUPON_RESERVATION_COUNTER_NOT_RELEASABLE");
        console.warn("Coupon was deleted before its reservation was released", String(orderId), order.couponCode);
      }
      await settleRedemption(orderId, "released", session);

      const orderResult = await Order.updateOne(
        { _id: orderId, couponReservationStatus: "reserved" },
        { $set: { couponReservationStatus: "released" } },
        { session }
      );
      if (!orderResult.modifiedCount) throw new Error("COUPON_RESERVATION_STATE_CHANGED");
      released = true;
    });
    return released;
  } finally {
    await session.endSession();
  }
};

export const redeemCouponReservationForOrder = async (orderId) => {
  const session = await mongoose.startSession();
  let redeemed = false;
  try {
    await session.withTransaction(async () => {
      redeemed = false;
      const order = await Order.findOne({
        _id: orderId,
        paymentStatus: "paid",
        couponReservationStatus: "reserved",
      }).session(session).lean();
      if (!order) return;
      if (!order.couponCode) throw new Error("COUPON_RESERVATION_CODE_MISSING");

      const couponResult = await Coupon.updateOne(
        { code: order.couponCode, reservedCount: { $gt: 0 } },
        { $inc: { reservedCount: -1, usageCount: 1 } },
        { session }
      );
      if (!couponResult.modifiedCount) {
        if (!(await couponMissing(order.couponCode, session))) throw new Error("COUPON_RESERVATION_COUNTER_NOT_REDEEMABLE");
        console.warn("Coupon was deleted before its reservation was redeemed", String(orderId), order.couponCode);
      }
      await settleRedemption(orderId, "redeemed", session);

      const orderResult = await Order.updateOne(
        { _id: orderId, paymentStatus: "paid", couponReservationStatus: "reserved" },
        { $set: { couponReservationStatus: "redeemed" } },
        { session }
      );
      if (!orderResult.modifiedCount) throw new Error("COUPON_RESERVATION_STATE_CHANGED");
      redeemed = true;
    });
    return redeemed;
  } finally {
    await session.endSession();
  }
};
export const releaseCouponReservationByCode = async (codeInput) => {
  const code = normalizeCouponCode(codeInput);
  if (!code) return false;
  const result = await Coupon.updateOne(
    { code, reservedCount: { $gt: 0 } },
    { $inc: { reservedCount: -1 } }
  );
  return result.modifiedCount === 1;
};

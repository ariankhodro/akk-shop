import mongoose from "mongoose";
import Coupon from "../models/coupon.model.js";
import Product from "../models/product.model.js";
import { recordAuditEvent } from "../lib/audit-log.js";
import {
  calculateCouponDiscount,
  couponEligibilityError,
  couponUserLimitError,
  DEFAULT_PER_USER_LIMIT,
  normalizeCouponCode,
} from "../lib/coupons.js";

const couponFields = [
  "code", "description", "discountPercentage", "startsAt", "expiresAt",
  "minOrderAmount", "maxDiscountAmount", "usageLimit", "perUserLimit", "isActive",
];

const toDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const optionalWholeAmount = (value, fieldLabel, { allowZero = true } = {}) => {
  if (value === "" || value === null || value === undefined) return { value: null };
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
    return { error: fieldLabel + (allowZero ? " باید عدد صحیح و نامنفی باشد." : " باید عدد صحیح و بزرگ‌تر از صفر باشد.") };
  }
  return { value: number };
};

const normalizeCouponInput = (input, current = {}) => {
  const source = { ...current, ...Object.fromEntries(couponFields.filter((key) => Object.hasOwn(input || {}, key)).map((key) => [key, input[key]])) };
  const code = normalizeCouponCode(source.code);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return { error: "کد باید ۳ تا ۴۰ نویسه و فقط شامل حروف انگلیسی، اعداد، خط تیره یا زیرخط باشد." };
  }
  const description = typeof source.description === "string" ? source.description.trim() : "";
  if (description.length > 200) return { error: "توضیحات کد تخفیف حداکثر ۲۰۰ نویسه است." };

  const discountPercentage = Number(source.discountPercentage);
  if (!Number.isFinite(discountPercentage) || discountPercentage < 1 || discountPercentage > 100) {
    return { error: "درصد تخفیف باید بین ۱ تا ۱۰۰ باشد." };
  }
  const startsAt = toDate(source.startsAt);
  const expiresAt = toDate(source.expiresAt);
  if (!startsAt || !expiresAt || expiresAt <= startsAt) {
    return { error: "تاریخ پایان باید پس از تاریخ شروع باشد." };
  }

  const minimum = optionalWholeAmount(source.minOrderAmount ?? 0, "حداقل مبلغ سفارش");
  if (minimum.error) return minimum;
  const maxDiscount = optionalWholeAmount(source.maxDiscountAmount, "سقف تخفیف", { allowZero: false });
  if (maxDiscount.error) return maxDiscount;
  const usageLimit = optionalWholeAmount(source.usageLimit, "محدودیت تعداد استفاده", { allowZero: false });
  if (usageLimit.error) return usageLimit;
  // Absent => 1 use per account (safe default). An explicit empty value means unlimited.
  let perUserLimit = DEFAULT_PER_USER_LIMIT;
  if (source.perUserLimit !== undefined) {
    const parsed = optionalWholeAmount(source.perUserLimit, "محدودیت استفاده برای هر کاربر", { allowZero: false });
    if (parsed.error) return parsed;
    perUserLimit = parsed.value;
  }
  const isActive = source.isActive === undefined ? true : source.isActive;
  if (typeof isActive !== "boolean") return { error: "وضعیت فعال بودن معتبر نیست." };

  return {
    value: {
      code,
      description,
      discountPercentage,
      startsAt,
      expiresAt,
      minOrderAmount: minimum.value ?? 0,
      maxDiscountAmount: maxDiscount.value,
      usageLimit: usageLimit.value,
      perUserLimit,
      isActive,
    },
  };
};

const cartSubtotalFor = async (user) => {
  const items = Array.isArray(user?.cartItems) ? user.cartItems : [];
  if (!items.length) return { error: "سبد خرید شما خالی است." };
  const ids = items.map((item) => String(item?.product || item?._id || "")).filter(mongoose.isValidObjectId);
  if (!ids.length) return { error: "سبد خرید را به‌روزرسانی کنید و دوباره تلاش کنید." };
  const products = await Product.find({ _id: { $in: ids }, isActive: { $ne: false } }).select("_id price").lean();
  const byId = new Map(products.map((product) => [String(product._id), product]));
  let subtotal = 0;
  for (const item of items) {
    const id = String(item?.product || item?._id || "");
    const product = byId.get(id);
    const quantity = Number(item?.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return { error: "یکی از کالاهای سبد خرید معتبر نیست؛ سبد را به‌روزرسانی کنید." };
    }
    subtotal += product.price * quantity;
    if (!Number.isSafeInteger(subtotal)) return { error: "مبلغ سبد خرید معتبر نیست." };
  }
  return { subtotal };
};

export const getAdminCoupons = async (_req, res) => {
  try {
    const coupons = await Coupon.find({}).sort({ createdAt: -1, _id: -1 }).limit(300).lean();
    return res.json({ coupons });
  } catch (error) {
    console.error("Unable to load coupon campaigns", error.message);
    return res.status(500).json({ message: "بارگذاری کدهای تخفیف ناموفق بود." });
  }
};

export const validateCoupon = async (req, res) => {
  try {
    const code = normalizeCouponCode(req.body?.code);
    if (!code) return res.status(400).json({ message: "کد تخفیف را وارد کنید." });

    const cart = await cartSubtotalFor(req.user);
    if (cart.error) return res.status(400).json({ message: cart.error });

    const coupon = await Coupon.findOne({ code }).lean();
    const eligibilityError = couponEligibilityError(coupon, cart.subtotal);
    if (eligibilityError) return res.status(400).json({ message: eligibilityError });
    const userLimitError = await couponUserLimitError(coupon, req.user?._id);
    if (userLimitError) return res.status(400).json({ message: userLimitError });

    return res.json({
      message: "کد تخفیف معتبر است.",
      code: coupon.code,
      description: coupon.description,
      discountPercentage: coupon.discountPercentage,
      minOrderAmount: coupon.minOrderAmount || 0,
      maxDiscountAmount: coupon.maxDiscountAmount ?? null,
      discountAmount: calculateCouponDiscount(coupon, cart.subtotal),
      subtotal: cart.subtotal,
      expiresAt: coupon.expiresAt,
    });
  } catch (error) {
    console.error("Unable to validate coupon", error.message);
    return res.status(500).json({ message: "بررسی کد تخفیف ناموفق بود." });
  }
};

export const createCoupon = async (req, res) => {
  const normalized = normalizeCouponInput(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });

  try {
    const coupon = await Coupon.create({ ...normalized.value, createdBy: req.user._id });
    await recordAuditEvent(req, {
      action: "coupon.created",
      targetType: "coupon",
      targetId: coupon._id,
      summary: "Coupon campaign created",
      metadata: { code: coupon.code, discountPercentage: coupon.discountPercentage, expiresAt: coupon.expiresAt },
    });
    return res.status(201).json({ coupon });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "این کد تخفیف قبلاً ثبت شده است." });
    console.error("Unable to create coupon", error.message);
    return res.status(500).json({ message: "ایجاد کد تخفیف ناموفق بود." });
  }
};

export const updateCoupon = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "شناسه کد تخفیف نامعتبر است." });
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: "کد تخفیف پیدا نشد." });

    const current = coupon.toObject();
    const normalized = normalizeCouponInput(req.body || {}, current);
    if (normalized.error) return res.status(400).json({ message: normalized.error });
    if (normalized.value.code !== coupon.code && (coupon.usageCount > 0 || coupon.reservedCount > 0)) {
      return res.status(409).json({ message: "کد قابل استفاده مجدد یا دارای پرداخت در انتظار را نمی‌توان تغییر نام داد؛ کد جدید بسازید." });
    }
    Object.assign(coupon, normalized.value);
    await coupon.save();
    await recordAuditEvent(req, {
      action: "coupon.updated",
      targetType: "coupon",
      targetId: coupon._id,
      summary: "Coupon campaign updated",
      metadata: { code: coupon.code, isActive: coupon.isActive, discountPercentage: coupon.discountPercentage },
    });
    return res.json({ coupon });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "این کد تخفیف قبلاً ثبت شده است." });
    console.error("Unable to update coupon", error.message);
    return res.status(500).json({ message: "به‌روزرسانی کد تخفیف ناموفق بود." });
  }
};

export const deleteCoupon = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "شناسه کد تخفیف نامعتبر است." });
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: "کد تخفیف پیدا نشد." });
    if (coupon.reservedCount > 0) {
      return res.status(409).json({ message: "این کد تخفیف سفارش در انتظار پرداخت دارد؛ پس از تعیین وضعیت پرداخت دوباره تلاش کنید." });
    }
    // Conditional writes: a reservation created after the read above must win over the delete.
    let archived = false;
    if (coupon.usageCount > 0) {
      const result = await Coupon.updateOne({ _id: coupon._id, reservedCount: 0 }, { $set: { isActive: false } });
      if (!result.matchedCount) {
        return res.status(409).json({ message: "این کد تخفیف سفارش در انتظار پرداخت دارد؛ پس از تعیین وضعیت پرداخت دوباره تلاش کنید." });
      }
      archived = true;
    } else {
      const result = await Coupon.deleteOne({ _id: coupon._id, reservedCount: 0, usageCount: 0 });
      if (!result.deletedCount) {
        const stillThere = await Coupon.exists({ _id: coupon._id });
        if (!stillThere) return res.status(404).json({ message: "کد تخفیف پیدا نشد." });
        return res.status(409).json({ message: "این کد تخفیف هم‌زمان استفاده یا رزرو شد؛ پس از تعیین وضعیت پرداخت دوباره تلاش کنید." });
      }
    }
    await recordAuditEvent(req, {
      action: archived ? "coupon.archived" : "coupon.deleted",
      targetType: "coupon",
      targetId: coupon._id,
      summary: archived ? "Used coupon campaign archived" : "Coupon campaign deleted",
      metadata: { code: coupon.code, usageCount: coupon.usageCount },
    });
    return res.json({ success: true, archived, id: String(coupon._id) });
  } catch (error) {
    console.error("Unable to delete coupon", error.message);
    return res.status(500).json({ message: "حذف کد تخفیف ناموفق بود." });
  }
};

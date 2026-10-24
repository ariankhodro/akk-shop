import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 40,
      match: /^[A-Z0-9_-]+$/,
    },
    description: { type: String, trim: true, maxlength: 200, default: "" },
    discountPercentage: { type: Number, required: true, min: 1, max: 100 },
    startsAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    minOrderAmount: { type: Number, min: 0, default: 0 },
    maxDiscountAmount: { type: Number, min: 1, default: null },
    usageLimit: { type: Number, min: 1, default: null },
    // Max reserved+redeemed uses per account. null means unlimited; legacy documents
    // without the field are treated as 1 (see lib/coupons.js) until migrated.
    perUserLimit: { type: Number, min: 1, default: 1 },
    usageCount: { type: Number, min: 0, default: 0 },
    reservedCount: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

couponSchema.index({ isActive: 1, startsAt: 1, expiresAt: 1 });

const Coupon = mongoose.model("Coupon", couponSchema);

// One record per order that reserved a coupon: makes release/redeem of the per-user
// counter idempotent (compare-and-set on status).
const couponRedemptionSchema = new mongoose.Schema(
  {
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
    code: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    status: { type: String, enum: ["reserved", "redeemed", "released"], default: "reserved" },
  },
  { timestamps: true }
);
couponRedemptionSchema.index({ order: 1 }, { unique: true });
couponRedemptionSchema.index({ coupon: 1, user: 1, status: 1 });
export const CouponRedemption = mongoose.models.CouponRedemption || mongoose.model("CouponRedemption", couponRedemptionSchema);

// Per (coupon, user) count of reserved + redeemed uses. The unique index plus a
// conditional upsert ({count: {$lt: limit}}) is the atomic per-user limit gate.
const couponUserUsageSchema = new mongoose.Schema(
  {
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    count: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);
couponUserUsageSchema.index({ coupon: 1, user: 1 }, { unique: true });
export const CouponUserUsage = mongoose.models.CouponUserUsage || mongoose.model("CouponUserUsage", couponUserUsageSchema);

export default Coupon;

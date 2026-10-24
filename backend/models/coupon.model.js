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
    usageCount: { type: Number, min: 0, default: 0 },
    reservedCount: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

couponSchema.index({ isActive: 1, startsAt: 1, expiresAt: 1 });

const Coupon = mongoose.model("Coupon", couponSchema);

export default Coupon;

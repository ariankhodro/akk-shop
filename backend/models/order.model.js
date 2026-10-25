import mongoose from "mongoose";

const orderProductSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    // Retail price at checkout; differs from `price` on wholesale lines.
    retailPrice: { type: Number, min: 0, default: null },
    sku: { type: String, trim: true, maxlength: 64, default: "" },
    size: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "" },
    productName: { type: String, trim: true, maxlength: 160, default: "" },
    image: { type: String, trim: true, maxlength: 2048, default: "" },
    hasVariant: { type: Boolean, default: false },
    stockReserved: { type: Boolean, default: false },
    // Set when a release found no stock target (variant removed/renamed); never blocks other lines.
    releaseSkipped: { type: Boolean, default: false },
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    recipientName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, match: /^09\d{9}$/ },
    province: { type: String, required: true, trim: true, maxlength: 80 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    district: { type: String, trim: true, maxlength: 80, default: "" },
    addressLine: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
    postalCode: { type: String, required: true, match: /^\d{10}$/ },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: false }
);

const shipmentEventSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["processing", "packed", "shipped", "delivered", "returned"], required: true },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    products: { type: [orderProductSchema], required: true },
    shippingAddress: { type: shippingAddressSchema, default: undefined },
    shipmentStatus: { type: String, enum: ["not_ready", "processing", "packed", "shipped", "delivered", "returned"] },
    shippingCarrier: { type: String, trim: true, maxlength: 100, default: "" },
    trackingCode: { type: String, trim: true, maxlength: 120, default: "" },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    shipmentEvents: { type: [shipmentEventSchema], default: [] },
    totalAmount: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, min: 0, default: 0 },
    currency: { type: String, enum: ["IRT"], default: "IRT", required: true },
    paymentProvider: { type: String, enum: ["zarinpal"], default: "zarinpal", required: true },
    paymentStatus: { type: String, enum: ["pending", "paid", "failed", "expired", "paid_after_expiry"], default: "pending", required: true },
    paymentRequestStatus: { type: String, enum: ["not_started", "in_flight", "accepted", "unknown", "rejected", "expired"], default: "not_started" },
    paymentRequestAttemptedAt: { type: Date, default: null },
    reconciliationAttempts: { type: Number, min: 0, default: 0 },
    reconciliationLastAttemptAt: { type: Date, default: null },
    reconciliationNextAttemptAt: { type: Date, default: null },
    status: { type: String, enum: ["pending", "paid", "failed", "cancelled", "expired", "paid_after_expiry"], default: "pending" },
    subtotalAmount: { type: Number, min: 0, default: 0 },
    pricingTier: { type: String, enum: ["retail", "wholesale"], default: "retail" },
    couponCode: { type: String, trim: true, maxlength: 40, default: "" },
    couponDiscountAmount: { type: Number, min: 0, default: 0 },
    couponDiscountPercentage: { type: Number, min: 0, max: 100, default: 0 },
    couponReservationStatus: { type: String, enum: ["none", "reserved", "redeemed", "released"], default: "none" },
    zarinpalAuthority: { type: String, unique: true, sparse: true },
    // No default: the unique partial index below ignores missing and empty values.
    zarinpalRefId: { type: String },
    zarinpalCardPan: { type: String, trim: true, maxlength: 32, default: "" },
    zarinpalFee: { type: Number, default: null },
    zarinpalFeeType: { type: String, trim: true, maxlength: 40, default: "" },
    lastVerifyCode: { type: Number, default: null },
    lastVerifyAt: { type: Date, default: null },
    // paid_after_expiry / amount mismatch / unredeemable coupon: an operator must look at it.
    needsManualReview: { type: Boolean, default: false },
    manualReviewReason: { type: String, trim: true, maxlength: 120, default: "" },
    paidAfterExpiryAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ user: 1, paymentStatus: 1, expiresAt: 1 });
orderSchema.index(
  { zarinpalRefId: 1 },
  { unique: true, partialFilterExpression: { zarinpalRefId: { $type: "string", $gt: "" } } }
);
orderSchema.index({ needsManualReview: 1, paymentProvider: 1 }, { partialFilterExpression: { needsManualReview: true } });
orderSchema.index({ paymentStatus: 1, paymentProvider: 1, createdAt: 1 });
orderSchema.index({ paymentProvider: 1, paymentStatus: 1, expiresAt: 1 });
orderSchema.index({ paymentProvider: 1, paymentRequestStatus: 1, expiresAt: 1 });
orderSchema.index({ paymentProvider: 1, paymentStatus: 1, finalizedAt: 1 });
orderSchema.index({ paymentProvider: 1, paymentStatus: 1, reconciliationNextAttemptAt: 1, createdAt: 1 });
orderSchema.index({ paymentStatus: 1, shipmentStatus: 1, createdAt: -1 });

// One document per user, written inside every checkout transaction. Concurrent
// checkouts by the same user therefore conflict and are retried serially, which
// makes the per-user pending-order cap race-safe (snapshot isolation alone is not).
const checkoutGuardSchema = new mongoose.Schema(
  { _id: { type: mongoose.Schema.Types.ObjectId, required: true }, seq: { type: Number, default: 0 } },
  { versionKey: false }
);
export const CheckoutGuard = mongoose.models.CheckoutGuard || mongoose.model("CheckoutGuard", checkoutGuardSchema);

export default mongoose.model("Order", orderSchema);

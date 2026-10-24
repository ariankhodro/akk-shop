import mongoose from "mongoose";

const ACTIVE_CASE_STATUSES = ["open", "in_review", "approved"];

const serviceEventSchema = new mongoose.Schema({
  status: { type: String, enum: ["open", "in_review", "approved", "rejected", "resolved"], required: true },
  note: { type: String, trim: true, maxlength: 1000, default: "" },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const serviceCaseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
  type: { type: String, enum: ["support", "return", "refund"], required: true, index: true },
  subject: { type: String, trim: true, minlength: 3, maxlength: 160, required: true },
  message: { type: String, trim: true, minlength: 5, maxlength: 4000, required: true },
  status: { type: String, enum: ["open", "in_review", "approved", "rejected", "resolved"], default: "open", index: true },
  resolutionNote: { type: String, trim: true, maxlength: 1000, default: "" },
  refundAmount: { type: Number, min: 0, default: 0 },
  refundStatus: { type: String, enum: ["not_applicable", "requested", "approved", "processed", "rejected"], default: "not_applicable" },
  refundReference: { type: String, trim: true, maxlength: 160, default: "" },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  events: { type: [serviceEventSchema], default: [] },
}, { timestamps: true });

serviceCaseSchema.index({ createdAt: -1, status: 1 });
// At most one active refund (and one active return) per order, enforced by the database
// so concurrent submissions cannot both succeed (BIZ-8). Needs MongoDB 6.0+ for $in.
serviceCaseSchema.index(
  { order: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: { $in: ["refund", "return"] },
      status: { $in: ACTIVE_CASE_STATUSES },
      order: { $type: "objectId" },
    },
  }
);

const COUNTED_REFUND_STATUSES = ["approved", "processed"];

// Sum of refunds already approved/processed for an order, optionally ignoring one case.
export const sumCommittedRefunds = async (orderId, { excludeCaseId = null } = {}) => {
  const match = { order: orderId, type: "refund", refundStatus: { $in: COUNTED_REFUND_STATUSES } };
  if (excludeCaseId) match._id = { $ne: excludeCaseId };
  const [row] = await mongoose.model("ServiceCase").aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$refundAmount" } } },
  ]);
  return row?.total || 0;
};

// Cumulative cap: approved + processed refunds for one order never exceed its total.
serviceCaseSchema.pre("save", async function () {
  if (this.type !== "refund" || !this.order || !COUNTED_REFUND_STATUSES.includes(this.refundStatus)) return;
  if (!this.isNew && !this.isModified("refundStatus") && !this.isModified("refundAmount")) return;
  const order = await mongoose.model("Order").findById(this.order).select("totalAmount").lean();
  if (!order) return;
  const others = await sumCommittedRefunds(this.order, { excludeCaseId: this._id });
  if (others + this.refundAmount > order.totalAmount) {
    const error = new Error("REFUND_EXCEEDS_ORDER_TOTAL");
    error.code = "REFUND_EXCEEDS_ORDER_TOTAL";
    throw error;
  }
});
export default mongoose.model("ServiceCase", serviceCaseSchema);

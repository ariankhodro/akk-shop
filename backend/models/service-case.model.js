import mongoose from "mongoose";

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
export default mongoose.model("ServiceCase", serviceCaseSchema);

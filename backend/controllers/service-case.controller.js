import mongoose from "mongoose";
import Order from "../models/order.model.js";
import ServiceCase, { sumCommittedRefunds } from "../models/service-case.model.js";

const clampPage = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(1000, Math.max(1, parsed)) : 1;
};

export const getMyServiceCases = async (req, res) => {
  try {
    const page = clampPage(req.query.page);
    const limit = Math.min(30, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const filter = { user: req.user._id };
    const [cases, total] = await Promise.all([
      ServiceCase.find(filter).populate("order", "totalAmount currency paymentStatus shipmentStatus createdAt")
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(1500).lean(),
      ServiceCase.countDocuments(filter).maxTimeMS(1500),
    ]);
    return res.json({ cases, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Unable to load customer service cases", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to load your support requests" });
  }
};

export const createServiceCase = async (req, res) => {
  const type = req.body?.type;
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const orderId = req.body?.orderId;
  if (!["support", "return", "refund"].includes(type)) return res.status(400).json({ message: "Choose a valid request type" });
  if (subject.length < 3 || subject.length > 160 || message.length < 5 || message.length > 4000) return res.status(400).json({ message: "Subject or message is invalid" });
  try {
    let order = null;
    if (type !== "support" || orderId) {
      if (!mongoose.isValidObjectId(orderId)) return res.status(400).json({ message: "A valid order is required for this request" });
      order = await Order.findOne({ _id: orderId, user: req.user._id, currency: "IRT", paymentProvider: "zarinpal" });
      if (!order) return res.status(404).json({ message: "Order not found" });
    }
    if (["return", "refund"].includes(type)) {
      if (order.paymentStatus !== "paid") return res.status(409).json({ message: "Only paid orders can be returned or refunded" });
      if (type === "return" && order.shipmentStatus !== "delivered") return res.status(409).json({ message: "Returns can be requested after delivery" });
      const existing = await ServiceCase.findOne({ order: order._id, type, status: { $nin: ["rejected", "resolved"] } });
      if (existing) return res.status(409).json({ message: "An active request already exists for this order" });
    }
    // The request is for what is still refundable, never the full total twice (BIZ-8).
    let refundAmount = 0;
    if (type === "refund") {
      refundAmount = order.totalAmount - await sumCommittedRefunds(order._id);
      if (refundAmount <= 0) return res.status(409).json({ message: "This order has already been fully refunded" });
    }
    const serviceCase = await ServiceCase.create({
      user: req.user._id, order: order?._id || null, type, subject, message,
      refundAmount,
      refundStatus: type === "refund" ? "requested" : "not_applicable",
      events: [{ status: "open", note: "Request submitted by customer", actor: req.user._id }],
    });
    return res.status(201).json({ serviceCase });
  } catch (error) {
    // The partial unique index closes the find-then-create race above.
    if (error?.code === 11000) return res.status(409).json({ message: "An active request already exists for this order" });
    console.error("Unable to create service case", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to submit your request" });
  }
};

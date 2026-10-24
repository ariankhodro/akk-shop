import mongoose from "mongoose";
import Order from "../models/order.model.js";
import { recordAuditEvent } from "../lib/audit-log.js";

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const shipmentLabels = ["processing", "packed", "shipped", "delivered", "returned"];
const shipmentRank = { not_ready: 0, processing: 1, packed: 2, shipped: 3, delivered: 4, returned: 5 };

export const getMyOrders = async (req, res) => {
  try {
    const page = clampInteger(req.query.page, 1, 1, 1000);
    const limit = clampInteger(req.query.limit, 10, 1, 30);
    const filter = { user: req.user._id, paymentProvider: "zarinpal", currency: "IRT" };
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("products.product", "name image")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .maxTimeMS(2000)
        .lean(),
      Order.countDocuments(filter).maxTimeMS(1500),
    ]);
    return res.json({ orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Unable to load customer orders", error.message);
    return res.status(500).json({ message: "Unable to load orders" });
  }
};

export const getAdminOrders = async (req, res) => {
  try {
    const page = clampInteger(req.query.page, 1, 1, 1000);
    const limit = clampInteger(req.query.limit, 25, 1, 50);
    const allowedStatuses = new Set(["not_ready", ...shipmentLabels]);
    const status = typeof req.query.shipmentStatus === "string" ? req.query.shipmentStatus : "";
    if (status && !allowedStatuses.has(status)) {
      return res.status(400).json({ message: "Invalid shipment status" });
    }
    const filter = { paymentStatus: "paid", paymentProvider: "zarinpal", currency: "IRT" };
    if (status) filter.shipmentStatus = status;
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("user", "name email")
        .populate("products.product", "name image")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .maxTimeMS(2000)
        .lean(),
      Order.countDocuments(filter).maxTimeMS(1500),
    ]);
    return res.json({ orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Unable to load shipment queue", error.message);
    return res.status(500).json({ message: "Unable to load shipment queue" });
  }
};

export const updateShipment = async (req, res) => {
  const orderId = req.params.id;
  const nextStatus = typeof req.body?.status === "string" ? req.body.status : "";
  if (!mongoose.isValidObjectId(orderId)) return res.status(400).json({ message: "Invalid order ID" });
  if (!shipmentLabels.includes(nextStatus)) return res.status(400).json({ message: "Invalid shipment status" });

  const carrierInput = req.body?.shippingCarrier;
  const trackingInput = req.body?.trackingCode;
  const noteInput = req.body?.note;
  if ((carrierInput !== undefined && typeof carrierInput !== "string") ||
      (trackingInput !== undefined && typeof trackingInput !== "string") ||
      (noteInput !== undefined && typeof noteInput !== "string")) {
    return res.status(400).json({ message: "Shipment fields must be text" });
  }
  const shippingCarrier = typeof carrierInput === "string" ? carrierInput.trim().slice(0, 100) : undefined;
  const trackingCode = typeof trackingInput === "string" ? trackingInput.trim().slice(0, 120) : undefined;
  const note = typeof noteInput === "string" ? noteInput.trim().slice(0, 500) : "";

  try {
    const order = await Order.findOne({ _id: orderId, paymentProvider: "zarinpal", currency: "IRT" });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.paymentStatus !== "paid") {
      return res.status(409).json({ message: "Only paid orders can be prepared for shipment" });
    }

    const before = {
      shipmentStatus: order.shipmentStatus || "processing",
      shippingCarrier: order.shippingCarrier || "",
      trackingCode: order.trackingCode || "",
      shippedAt: order.shippedAt || null,
      deliveredAt: order.deliveredAt || null,
    };
    const currentStatus = order.shipmentStatus || "processing";
    if (nextStatus !== currentStatus) {
      if (nextStatus === "returned") {
        if (currentStatus !== "delivered") {
          return res.status(409).json({ message: "A shipment can be marked returned only after delivery" });
        }
      } else if (shipmentRank[nextStatus] !== shipmentRank[currentStatus] + 1) {
        return res.status(409).json({ message: "Move the shipment through each status in order" });
      }
    }

    const effectiveCarrier = shippingCarrier ?? order.shippingCarrier ?? "";
    const effectiveTrackingCode = trackingCode ?? order.trackingCode ?? "";
    if (nextStatus === "shipped" && (!effectiveCarrier || effectiveTrackingCode.length < 3)) {
      return res.status(400).json({ message: "A carrier and tracking code are required before shipping" });
    }

    if (shippingCarrier !== undefined) order.shippingCarrier = shippingCarrier;
    if (trackingCode !== undefined) order.trackingCode = trackingCode;
    const changed = nextStatus !== currentStatus;
    order.shipmentStatus = nextStatus;
    if (nextStatus === "shipped" && !order.shippedAt) order.shippedAt = new Date();
    if (nextStatus === "delivered" && !order.deliveredAt) order.deliveredAt = new Date();
    if (changed || note || shippingCarrier !== undefined || trackingCode !== undefined) {
      order.shipmentEvents.push({
        status: nextStatus,
        note: note || (changed ? "وضعیت ارسال توسط مدیریت به‌روزرسانی شد." : "اطلاعات رهگیری به‌روزرسانی شد."),
        changedBy: req.user._id,
        createdAt: new Date(),
      });
    }
    await order.save();

    await recordAuditEvent(req, {
      action: changed ? "order.shipment_status_updated" : "order.shipment_tracking_updated",
      targetType: "order",
      targetId: order._id,
      summary: changed ? "Shipment moved from " + before.shipmentStatus + " to " + nextStatus : "Shipment tracking details updated",
      metadata: {
        orderId: String(order._id),
        before,
        after: {
          shipmentStatus: order.shipmentStatus,
          shippingCarrier: order.shippingCarrier || "",
          trackingCode: order.trackingCode || "",
          shippedAt: order.shippedAt || null,
          deliveredAt: order.deliveredAt || null,
        },
        changes: {
          shipmentStatus: { before: before.shipmentStatus, after: order.shipmentStatus },
          shippingCarrier: { before: before.shippingCarrier, after: order.shippingCarrier || "" },
          trackingCode: { before: before.trackingCode, after: order.trackingCode || "" },
        },
        note: note || "",
        shipmentEventCount: order.shipmentEvents.length,
      },
    });
    return res.json({ order });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid order ID" });
    console.error("Unable to update shipment", error.message);
    return res.status(500).json({ message: "Unable to update shipment" });
  }
};

import mongoose from "mongoose";
import AuditLog from "../models/audit-log.model.js";
import { recordAuditEvent } from "../lib/audit-log.js";
import { escapeSearchRegex } from "../lib/persian-search.js";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import User from "../models/user.model.js";
import ServiceCase from "../models/service-case.model.js";
import { redis } from "../lib/redis.js";
import { getKnownProductStock } from "../lib/inventory-stock.js";
import { hasAdministratorManagementAccess, canPreserveAdministratorManagement, withAdministratorAccessLock, AdministratorAccessLockError } from "../lib/admin-permissions.js";

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const getAuditLogs = async (req, res) => {
  try {
    const page = clampInteger(req.query.page, 1, 1, 1000);
    const limit = clampInteger(req.query.limit, 30, 1, 50);
    const filter = {};
    if (typeof req.query.action === "string" && req.query.action.trim()) {
      const safeAction = escapeSearchRegex(req.query.action.trim().slice(0, 120));
      filter.action = new RegExp(safeAction, "i");
    }
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).populate("actor", "name role").sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).maxTimeMS(1500).lean(),
      AuditLog.countDocuments(filter).maxTimeMS(1500),
    ]);
    return res.json({ logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Unable to load audit history", error.message);
    return res.status(500).json({ message: "Unable to load audit history" });
  }
};

export const getOperationsDashboard = async (_req, res) => {
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [
      pendingPayments,
      unfinalizedPaidOrders,
      waitingToShip,
      shippedWithoutTracking,
      failedPayments24h,
      auditEvents24h,
    ] = await Promise.all([
      Order.countDocuments({ paymentStatus: "pending", paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "paid", finalizedAt: null, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "paid", shipmentStatus: { $in: ["not_ready", "processing", "packed"] }, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "paid", shipmentStatus: { $in: ["shipped", "delivered"] }, trackingCode: { $in: ["", null] }, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "failed", updatedAt: { $gte: dayAgo }, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      AuditLog.countDocuments({ createdAt: { $gte: dayAgo } }).maxTimeMS(1500),
    ]);

    const readyState = mongoose.connection.readyState;
    let redisState = "unknown";
    try {
      if (typeof redis.ping !== "function") redisState = "unsupported";
      else {
        const response = await redis.ping();
        redisState = response === "PONG" ? "connected" : "unexpected_response";
      }
    } catch {
      redisState = "unavailable";
    }

    const databaseState = readyState === 1 ? "connected" : readyState === 2 ? "connecting" : readyState === 3 ? "disconnecting" : "disconnected";
    return res.json({
      generatedAt: now,
      health: { status: databaseState === "connected" && redisState === "connected" ? "healthy" : "degraded", database: databaseState, redis: redisState },
      payments: { pending: pendingPayments, paidAwaitingFinalization: unfinalizedPaidOrders, failedLast24Hours: failedPayments24h },
      fulfillment: { paidAwaitingShipment: waitingToShip, shippedWithoutTracking: shippedWithoutTracking },
      audit: { eventsLast24Hours: auditEvents24h },
    });
  } catch (error) {
    console.error("Unable to load operations dashboard", error.message);
    return res.status(500).json({ message: "Unable to load operations dashboard" });
  }
};


const allowedAdminPermissions = new Set([
  "catalogue.manage", "orders.manage", "customers.manage", "support.manage",
  "reports.view", "settings.manage", "inventory.manage", "audit.view",
  "system.view", "roles.manage", "marketing.manage", "*",
]);

export const getCustomers = async (req, res) => {
  try {
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(req.query.limit, 25, 1, 50);
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const filter = {};
    if (search) {
      const safe = escapeSearchRegex(search);
      filter.$or = [{ name: new RegExp(safe, "i") }, { email: new RegExp(safe, "i") }];
    }
    if (["customer", "admin"].includes(req.query.role)) filter.role = req.query.role;
    const [customers, total] = await Promise.all([
      User.find(filter).select("_id name email role permissions isActive createdAt").sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).maxTimeMS(1500).lean(),
      User.countDocuments(filter).maxTimeMS(1500),
    ]);
    return res.json({ customers, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Unable to list customers", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to load customer accounts" });
  }
};

export const updateCustomerAccess = async (req, res) => {
  const customerId = req.params.id;
  if (!mongoose.isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
  const { role, permissions, isActive } = req.body || {};
  if (role !== undefined && !["customer", "admin"].includes(role)) return res.status(400).json({ message: "Invalid account role" });
  if (permissions !== undefined && (!Array.isArray(permissions) || permissions.some((item) => !allowedAdminPermissions.has(item)) || new Set(permissions).size !== permissions.length)) {
    return res.status(400).json({ message: "Invalid administrator permissions" });
  }
  if (isActive !== undefined && typeof isActive !== "boolean") return res.status(400).json({ message: "Invalid account status" });

  try {
    return await withAdministratorAccessLock(redis, async () => {
      const target = await User.findById(customerId);
      if (!target) return res.status(404).json({ message: "Customer account not found" });
      const nextRole = role ?? target.role;
      const nextActive = isActive ?? target.isActive !== false;
      const nextPermissions = permissions ?? target.permissions;
      if (String(target._id) === String(req.user._id) && (nextRole !== "admin" || !nextActive || (Array.isArray(nextPermissions) && !nextPermissions.includes("*") && !nextPermissions.includes("roles.manage")))) {
        return res.status(409).json({ message: "You cannot remove your own administrator access" });
      }

      const targetKeepsManagementAccess = hasAdministratorManagementAccess(nextRole, nextActive, nextPermissions);
      if (!targetKeepsManagementAccess) {
        const otherActiveAdmins = await User.find({
          _id: { $ne: target._id }, role: "admin", isActive: { $ne: false },
        }).select("permissions").lean();
        if (!canPreserveAdministratorManagement({ nextRole, nextActive, nextPermissions, otherActiveAdmins })) {
          return res.status(409).json({ message: "At least one active administrator must retain permission to manage administrator access" });
        }
      }

      if (target.role === "admin" && (nextRole !== "admin" || !nextActive)) {
        const activeAdmins = await User.countDocuments({ role: "admin", isActive: { $ne: false } });
        if (activeAdmins <= 1) return res.status(409).json({ message: "At least one active administrator must remain" });
      }

      const isDisablingAccount = nextActive === false;
      if (isDisablingAccount && target.isActive !== false) {
        await redis.del(`refresh_token:${target._id}`);
      }
      target.role = nextRole;
      target.isActive = nextActive;
      if (nextRole === "customer") target.permissions = undefined;
      else if (permissions !== undefined) target.permissions = permissions;
      await target.save();
      if (isDisablingAccount) {
        try {
          await redis.del(`refresh_token:${target._id}`);
        } catch (error) {
          console.warn("Unable to repeat refresh-token revocation after deactivation", {
            name: error?.name || "Error",
            code: typeof error?.code === "string" ? error.code : undefined,
          });
        }
      }
      await recordAuditEvent(req, {
        action: "customer.access_updated", targetType: "user", targetId: target._id,
        summary: "Customer account access updated",
        metadata: { role: target.role, isActive: target.isActive, permissions: target.permissions || null },
      });
      return res.json({ customer: { _id: target._id, name: target.name, email: target.email, role: target.role, permissions: target.permissions, isActive: target.isActive } });
    });
  } catch (error) {
    if (error instanceof AdministratorAccessLockError) {
      console.warn("Administrator access update temporarily unavailable", { code: error.code });
      return res.status(503).json({ message: "Administrator access is temporarily busy. Please try again." });
    }
    console.error("Unable to update customer access", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to update customer access" });
  }
};
export const getInventoryAlerts = async (req, res) => {
  const threshold = clampInteger(req.query.threshold, 5, 0, 50);
  try {
    const products = await Product.find({ isActive: { $ne: false } })
      .select("name image stock variants category price").sort({ createdAt: -1 }).limit(500).maxTimeMS(2500).lean();
    const alerts = products.map((product) => {
      const totalStock = getKnownProductStock(product);
      return { ...product, totalStock, lowStock: totalStock !== null && totalStock <= threshold };
    }).filter((product) => product.lowStock);
    return res.json({ threshold, alerts, scannedProducts: products.length, capped: products.length === 500 });
  } catch (error) {
    console.error("Unable to load inventory alerts", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to load inventory alerts" });
  }
};

export const getAdminServiceCases = async (req, res) => {
  try {
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(req.query.limit, 25, 1, 50);
    const filter = {};
    if (["support", "return", "refund"].includes(req.query.type)) filter.type = req.query.type;
    if (["open", "in_review", "approved", "rejected", "resolved"].includes(req.query.status)) filter.status = req.query.status;
    const [cases, total] = await Promise.all([
      ServiceCase.find(filter).populate("user", "name email").populate("order", "totalAmount currency paymentStatus shipmentStatus createdAt")
        .populate("handledBy", "name email").sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(2000).lean(),
      ServiceCase.countDocuments(filter).maxTimeMS(1500),
    ]);
    return res.json({ cases, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Unable to load service cases", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to load support and return cases" });
  }
};

export const updateAdminServiceCase = async (req, res) => {
  const caseId = req.params.id;
  if (!mongoose.isValidObjectId(caseId)) return res.status(400).json({ message: "Invalid case ID" });
  const { status, resolutionNote, refundStatus, refundAmount, refundReference } = req.body || {};
  const statuses = ["open", "in_review", "approved", "rejected", "resolved"];
  const refundStatuses = ["requested", "approved", "processed", "rejected"];
  if (status !== undefined && !statuses.includes(status)) return res.status(400).json({ message: "Invalid case status" });
  if (refundStatus !== undefined && !refundStatuses.includes(refundStatus)) return res.status(400).json({ message: "Invalid refund status" });
  if (resolutionNote !== undefined && (typeof resolutionNote !== "string" || resolutionNote.length > 1000)) return res.status(400).json({ message: "Resolution note is too long" });
  if (refundReference !== undefined && (typeof refundReference !== "string" || refundReference.length > 160)) return res.status(400).json({ message: "Refund reference is invalid" });
  try {
    const serviceCase = await ServiceCase.findById(caseId);
    if (!serviceCase) return res.status(404).json({ message: "Service case not found" });
    const order = serviceCase.order ? await Order.findById(serviceCase.order) : null;
    const nextRefundStatus = refundStatus ?? serviceCase.refundStatus;
    if (refundAmount !== undefined) {
      const amount = Number(refundAmount);
      if (!Number.isSafeInteger(amount) || amount < 0 || (order && amount > order.totalAmount)) return res.status(400).json({ message: "Refund amount is invalid" });
      serviceCase.refundAmount = amount;
    }
    if (serviceCase.type !== "refund" && refundStatus !== undefined) return res.status(400).json({ message: "Only refund cases can change refund status" });
    if (nextRefundStatus === "approved" && serviceCase.status === "rejected") return res.status(409).json({ message: "Rejected cases cannot be approved for refund" });
    if (nextRefundStatus === "processed" && (serviceCase.refundStatus !== "approved" || typeof refundReference !== "string" || !refundReference.trim())) {
      return res.status(409).json({ message: "A refund must be approved and have a transaction reference before being marked processed" });
    }
    if (serviceCase.type === "refund" && nextRefundStatus === "approved" && (!order || order.paymentStatus !== "paid")) {
      return res.status(409).json({ message: "Only paid orders can be approved for refund" });
    }
    const nextStatus = status ?? serviceCase.status;
    serviceCase.status = nextStatus;
    if (refundStatus !== undefined) serviceCase.refundStatus = refundStatus;
    if (refundReference !== undefined) serviceCase.refundReference = refundReference.trim();
    if (resolutionNote !== undefined) serviceCase.resolutionNote = resolutionNote.trim();
    serviceCase.handledBy = req.user._id;
    serviceCase.events.push({ status: nextStatus, note: serviceCase.resolutionNote || "", actor: req.user._id });
    if (serviceCase.type === "refund" && nextRefundStatus === "processed") serviceCase.status = "resolved";
    await serviceCase.save();
    await recordAuditEvent(req, {
      action: "service_case.updated", targetType: "service_case", targetId: serviceCase._id,
      summary: "Support, return or refund case updated",
      metadata: { type: serviceCase.type, status: serviceCase.status, refundStatus: serviceCase.refundStatus, refundAmount: serviceCase.refundAmount },
    });
    return res.json({ serviceCase });
  } catch (error) {
    console.error("Unable to update service case", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to update service case" });
  }
};

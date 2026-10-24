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
import { withAdministratorAccessLock, AdministratorAccessLockError } from "../lib/admin-permissions.js";
import {
  AccessChangeError, assertAccessChangeAllowed, hasPermission, presetPermissions, ROLE_PRESET_NAMES,
} from "../lib/rbac.js";
import { revokeRefreshSession } from "../lib/refresh-token.js";
import { isPlainObject } from "../lib/input.js";

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
      manualReviewOrders,
    ] = await Promise.all([
      Order.countDocuments({ paymentStatus: "pending", paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "paid", finalizedAt: null, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "paid", shipmentStatus: { $in: ["not_ready", "processing", "packed"] }, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "paid", shipmentStatus: { $in: ["shipped", "delivered"] }, trackingCode: { $in: ["", null] }, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      Order.countDocuments({ paymentStatus: "failed", updatedAt: { $gte: dayAgo }, paymentProvider: "zarinpal", currency: "IRT" }).maxTimeMS(1500),
      AuditLog.countDocuments({ createdAt: { $gte: dayAgo } }).maxTimeMS(1500),
      // Paid-after-expiry and held-for-review payments need a person: money may be captured without a fulfilled order.
      Order.countDocuments({ needsManualReview: true, paymentProvider: "zarinpal" }).maxTimeMS(1500),
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
      payments: { pending: pendingPayments, paidAwaitingFinalization: unfinalizedPaidOrders, failedLast24Hours: failedPayments24h, needingManualReview: manualReviewOrders },
      fulfillment: { paidAwaitingShipment: waitingToShip, shippedWithoutTracking: shippedWithoutTracking },
      audit: { eventsLast24Hours: auditEvents24h },
    });
  } catch (error) {
    console.error("Unable to load operations dashboard", error.message);
    return res.status(500).json({ message: "Unable to load operations dashboard" });
  }
};


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
    // Permission lists and owner flags are only visible to access managers.
    const canSeeAccess = hasPermission(req.user, "roles.manage");
    const projection = "_id name email role isActive createdAt" + (canSeeAccess ? " permissions adminRole isOwner" : "");
    const [customers, total] = await Promise.all([
      User.find(filter).select(projection).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).maxTimeMS(1500).lean(),
      User.countDocuments(filter).maxTimeMS(1500),
    ]);
    // Customer PII listings are audited (counts and search flag only, never the result set).
    await recordAuditEvent(req, {
      action: "customers.listed", targetType: "user", targetId: "",
      summary: "Customer account list viewed",
      metadata: { page, limit, returned: customers.length, searched: Boolean(search), roleFilter: filter.role || null },
    });
    return res.json({
      customers, canManageAccess: canSeeAccess,
      rolePresets: canSeeAccess ? ROLE_PRESET_NAMES : undefined,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Unable to list customers", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to load customer accounts" });
  }
};

const accessSnapshot = (user) => ({
  role: user.role, isActive: user.isActive !== false, isOwner: user.isOwner === true,
  adminRole: user.adminRole ?? null, permissions: Array.isArray(user.permissions) ? [...user.permissions].sort() : null,
});

const publicCustomer = (user, includeAccess) => ({
  _id: user._id, name: user.name, email: user.email, role: user.role, isActive: user.isActive,
  ...(includeAccess ? { permissions: user.permissions, adminRole: user.adminRole, isOwner: user.isOwner === true } : {}),
});

export const updateCustomerAccess = async (req, res) => {
  const customerId = req.params.id;
  if (!mongoose.isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
  const body = isPlainObject(req.body) ? req.body : {};
  const { role, permissions, isActive, adminRole, isOwner: requestedOwner } = body;
  if (role !== undefined && !["customer", "admin"].includes(role)) return res.status(400).json({ message: "Invalid account role" });
  if (permissions !== undefined && (!Array.isArray(permissions) || new Set(permissions).size !== permissions.length)) {
    return res.status(400).json({ message: "Invalid administrator permissions" });
  }
  if (adminRole !== undefined && (typeof adminRole !== "string" || !ROLE_PRESET_NAMES.includes(adminRole) || adminRole === "owner")) {
    return res.status(400).json({ message: "Invalid administrator role preset" });
  }
  if (adminRole !== undefined && permissions !== undefined) {
    return res.status(400).json({ message: "Provide either a role preset or explicit permissions, not both" });
  }
  if (isActive !== undefined && typeof isActive !== "boolean") return res.status(400).json({ message: "Invalid account status" });
  if (requestedOwner !== undefined && typeof requestedOwner !== "boolean") return res.status(400).json({ message: "Invalid owner flag" });

  try {
    return await withAdministratorAccessLock(redis, async () => {
      const session = await mongoose.startSession();
      let result;
      try {
        await session.withTransaction(async () => {
          const target = await User.findById(customerId).session(session);
          if (!target) throw new AccessChangeError(404, "Customer account not found", "NOT_FOUND");

          const nextRole = role ?? target.role;
          const nextActive = isActive ?? target.isActive !== false;
          let nextPermissions;
          let nextAdminRole;
          if (nextRole === "admin") {
            if (adminRole !== undefined) {
              nextPermissions = presetPermissions(adminRole);
              nextAdminRole = adminRole;
            } else if (permissions !== undefined) {
              nextPermissions = permissions;
              nextAdminRole = undefined;
            } else if (target.role === "admin") {
              // Never promote implicitly: a legacy admin with no explicit list keeps none.
              nextPermissions = Array.isArray(target.permissions) ? [...target.permissions] : [];
              nextAdminRole = target.adminRole;
            }
          }
          const nextOwner = nextRole === "admin" ? (requestedOwner ?? target.isOwner === true) : false;
          const next = { role: nextRole, isActive: nextActive, isOwner: nextOwner, permissions: nextPermissions };

          const otherActiveOwners = await User.countDocuments({
            _id: { $ne: target._id }, role: "admin", isActive: { $ne: false }, isOwner: true,
          }).session(session);
          // Reload the actor inside the lock so a concurrent demotion is honoured.
          const actor = await User.findById(req.user._id).select("-password").session(session);
          if (!actor || actor.isActive === false) throw new AccessChangeError(401, "Authentication required", "ACTOR_GONE");
          assertAccessChangeAllowed({ actor, target, next, otherActiveOwners });

          const before = accessSnapshot(target);
          target.role = nextRole;
          target.isActive = nextActive;
          target.isOwner = nextOwner;
          target.permissions = nextRole === "admin" ? nextPermissions : undefined;
          target.adminRole = nextRole === "admin" ? nextAdminRole : undefined;
          const after = accessSnapshot(target);
          const changed = JSON.stringify(before) !== JSON.stringify(after);
          // Any real access change invalidates outstanding access tokens immediately.
          if (changed) target.tokenVersion = (Number.isInteger(target.tokenVersion) ? target.tokenVersion : 0) + 1;
          await target.save({ session });
          if (changed) {
            await recordAuditEvent(req, {
              action: "customer.access_updated", targetType: "user", targetId: target._id,
              summary: "Customer account access updated",
              metadata: { targetEmail: target.email, before, after },
            }, { session, strict: true });
          }
          result = { target, changed };
        });
      } finally {
        await session.endSession();
      }

      if (result.changed) {
        try {
          await revokeRefreshSession(redis, result.target._id);
        } catch (error) {
          // Access tokens are already invalid (tokenVersion) and refresh rejects a stale version.
          console.warn("Unable to revoke refresh session after access change", {
            name: error?.name || "Error", code: typeof error?.code === "string" ? error.code : undefined,
          });
        }
      }
      return res.json({ customer: publicCustomer(result.target, true) });
    });
  } catch (error) {
    if (error instanceof AdministratorAccessLockError) {
      console.warn("Administrator access update temporarily unavailable", { code: error.code });
      return res.status(503).json({ message: "Administrator access is temporarily busy. Please try again." });
    }
    if (error instanceof AccessChangeError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
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

const COMMITTED_REFUND_STATUSES = ["approved", "processed"];

export const updateAdminServiceCase = async (req, res) => {
  const caseId = req.params.id;
  if (!mongoose.isValidObjectId(caseId)) return res.status(400).json({ message: "Invalid case ID" });
  const body = isPlainObject(req.body) ? req.body : {};
  const { status, resolutionNote, refundStatus, refundAmount, refundReference } = body;
  const statuses = ["open", "in_review", "approved", "rejected", "resolved"];
  const refundStatuses = ["requested", "approved", "processed", "rejected"];
  if (status !== undefined && !statuses.includes(status)) return res.status(400).json({ message: "Invalid case status" });
  if (refundStatus !== undefined && !refundStatuses.includes(refundStatus)) return res.status(400).json({ message: "Invalid refund status" });
  if (resolutionNote !== undefined && (typeof resolutionNote !== "string" || resolutionNote.length > 1000)) return res.status(400).json({ message: "Resolution note is too long" });
  if (refundReference !== undefined && (typeof refundReference !== "string" || refundReference.length > 160)) return res.status(400).json({ message: "Refund reference is invalid" });

  // Money-moving fields need their own permission so support staff cannot approve refunds.
  const touchesRefund = [refundStatus, refundAmount, refundReference].some((value) => value !== undefined);
  if (touchesRefund && !hasPermission(req.user, "refunds.manage")) {
    return res.status(403).json({ message: "You do not have permission to perform this action" });
  }
  const touchesCase = [status, resolutionNote].some((value) => value !== undefined);
  if (touchesCase && !hasPermission(req.user, "support.manage")) {
    return res.status(403).json({ message: "You do not have permission to perform this action" });
  }

  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const serviceCase = await ServiceCase.findById(caseId).session(session);
      if (!serviceCase) throw new AccessChangeError(404, "Service case not found", "NOT_FOUND");
      const order = serviceCase.order ? await Order.findById(serviceCase.order).session(session) : null;
      const nextRefundStatus = refundStatus ?? serviceCase.refundStatus;
      const before = {
        status: serviceCase.status, refundStatus: serviceCase.refundStatus,
        refundAmount: serviceCase.refundAmount, refundReference: serviceCase.refundReference,
      };
      if (refundAmount !== undefined) {
        const amount = Number(refundAmount);
        if (!Number.isSafeInteger(amount) || amount < 0 || (order && amount > order.totalAmount)) throw new AccessChangeError(400, "Refund amount is invalid", "BAD_AMOUNT");
        serviceCase.refundAmount = amount;
      }
      if (serviceCase.type !== "refund" && refundStatus !== undefined) throw new AccessChangeError(400, "Only refund cases can change refund status", "NOT_REFUND");
      if (nextRefundStatus === "approved" && serviceCase.status === "rejected") throw new AccessChangeError(409, "Rejected cases cannot be approved for refund", "REJECTED");
      if (nextRefundStatus === "processed" && (serviceCase.refundStatus !== "approved" || typeof refundReference !== "string" || !refundReference.trim())) {
        throw new AccessChangeError(409, "A refund must be approved and have a transaction reference before being marked processed", "NOT_APPROVED");
      }
      if (serviceCase.type === "refund" && nextRefundStatus === "approved" && (!order || order.paymentStatus !== "paid")) {
        throw new AccessChangeError(409, "Only paid orders can be approved for refund", "UNPAID_ORDER");
      }

      // Cumulative cap: approved + processed refunds for one order can never exceed
      // what the customer paid. Touching the order serialises concurrent approvals
      // (write conflict => transaction retry), so the sum below cannot go stale.
      if (serviceCase.type === "refund" && order && COMMITTED_REFUND_STATUSES.includes(nextRefundStatus)) {
        await Order.updateOne({ _id: order._id }, { $currentDate: { updatedAt: true } }, { session });
        const [{ committed = 0 } = {}] = await ServiceCase.aggregate([
          { $match: { order: order._id, type: "refund", _id: { $ne: serviceCase._id }, refundStatus: { $in: COMMITTED_REFUND_STATUSES } } },
          { $group: { _id: null, committed: { $sum: "$refundAmount" } } },
        ]).session(session);
        if (committed + (serviceCase.refundAmount || 0) > order.totalAmount) {
          throw new AccessChangeError(409, "Total approved refunds for this order would exceed the amount paid", "REFUND_CAP");
        }
      }

      const nextStatus = status ?? serviceCase.status;
      serviceCase.status = nextStatus;
      if (refundStatus !== undefined) serviceCase.refundStatus = refundStatus;
      if (refundReference !== undefined) serviceCase.refundReference = refundReference.trim();
      if (resolutionNote !== undefined) serviceCase.resolutionNote = resolutionNote.trim();
      serviceCase.handledBy = req.user._id;
      serviceCase.events.push({ status: nextStatus, note: serviceCase.resolutionNote || "", actor: req.user._id });
      if (serviceCase.type === "refund" && nextRefundStatus === "processed") serviceCase.status = "resolved";
      await serviceCase.save({ session });
      await recordAuditEvent(req, {
        action: "service_case.updated", targetType: "service_case", targetId: serviceCase._id,
        summary: "Support, return or refund case updated",
        metadata: {
          type: serviceCase.type, before,
          after: {
            status: serviceCase.status, refundStatus: serviceCase.refundStatus,
            refundAmount: serviceCase.refundAmount, refundReference: serviceCase.refundReference,
          },
        },
      }, { session, strict: touchesRefund });
      updated = serviceCase;
    });
    return res.json({ serviceCase: updated });
  } catch (error) {
    if (error instanceof AccessChangeError) return res.status(error.status).json({ message: error.message });
    if (error?.code === "REFUND_EXCEEDS_ORDER_TOTAL" || error?.message === "REFUND_EXCEEDS_ORDER_TOTAL") {
      return res.status(409).json({ message: "Total approved refunds for this order would exceed the amount paid" });
    }
    console.error("Unable to update service case", { name: error?.name, message: error?.message });
    return res.status(500).json({ message: "Unable to update service case" });
  } finally {
    await session.endSession();
  }
};

import mongoose from "mongoose";
import { randomUUID, timingSafeEqual } from "node:crypto";
import Order, { CheckoutGuard } from "../models/order.model.js";
import Product from "../models/product.model.js";
import User from "../models/user.model.js";
import {
  redeemCouponReservationForOrder,
  releaseCouponReservationByCode,
  releaseCouponReservationForOrder,
  reserveCoupon,
} from "../lib/coupons.js";
import { calculateShippingFee, getShippingSettings } from "../lib/shipping.js";
import { hasConfiguredInventory, hasKnownFiniteStock } from "../lib/inventory-stock.js";
import { redis } from "../lib/redis.js";
import {
  buildExpiredPendingFilter,
  buildStrandedOrdersFilter,
  getDueReconciliationFilter,
  getNextReconciliationDelayMs,
  isCronSecretAcceptable,
  mapWithConcurrency,
  PAYMENT_HOLD_ALERT_AGE_MS,
  PAYMENT_RECONCILIATION_BATCH_SIZE,
  PAYMENT_RECONCILIATION_LOCK_TTL_MS,
  PAYMENT_RECONCILIATION_MAX_BATCH_SIZE,
  PAYMENT_RECONCILIATION_MAX_ITEMS_PER_PHASE,
  PAYMENT_RECONCILIATION_TIME_BUDGET_MS,
  PAYMENT_RECONCILIATION_VERIFY_CONCURRENCY,
} from "../lib/payment-reconciliation.js";
import { acquireMongoLease, releaseMongoLease } from "../lib/reconciliation-lease.js";
import { classifyRequestResponse, classifyVerifyResponse } from "../lib/zarinpal-codes.js";

// Tests replace these to mock the provider and the clock.
export const zarinpalDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
};
const MAX_PENDING_ORDERS_PER_USER = 2;

const isSandbox = () => process.env.ZARINPAL_SANDBOX === "true";
const isTomanCatalogConfirmed = () => process.env.IRT_CATALOG_PRICES_CONFIRMED === "true";
const apiBase = () => isSandbox()
  ? "https://sandbox.zarinpal.com/pg/v4/payment"
  : "https://api.zarinpal.com/pg/v4/payment";
const startPayBase = () => isSandbox()
  ? "https://sandbox.zarinpal.com/pg/StartPay"
  : "https://www.zarinpal.com/pg/StartPay";
const isTracked = hasKnownFiniteStock;
const cartProductId = (item) => item.product?.toString() || item._id?.toString();
const optionValue = (value) => typeof value === "string" ? value.trim() : "";
const findVariant = (product, size, color) => (product.variants || []).find((variant) =>
  optionValue(variant.size) === optionValue(size) && optionValue(variant.color) === optionValue(color)
);
const cartSignature = (lines) => lines
  .map((line) => [String(line.product), optionValue(line.size), optionValue(line.color), Number(line.quantity)].join("|"))
  .sort()
  .join(";");
const safeClientUrl = () => (process.env.CLIENT_URL || "").replace(/\/$/, "");
const normalizeIranDigits = (value) => String(value ?? "")
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
const normalizeIranPhone = (value) => {
  let digits = normalizeIranDigits(value).replace(/\D/g, "");
  if (digits.startsWith("0098") && digits.length === 14) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("98") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && digits.startsWith("9")) digits = `0${digits}`;
  return digits;
};
const parseShippingAddress = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const address = {
    recipientName: typeof input.recipientName === "string" ? input.recipientName.trim().slice(0, 100) : "",
    phone: normalizeIranPhone(input.phone),
    province: typeof input.province === "string" ? input.province.trim().slice(0, 80) : "",
    city: typeof input.city === "string" ? input.city.trim().slice(0, 80) : "",
    district: typeof input.district === "string" ? input.district.trim().slice(0, 80) : "",
    addressLine: typeof input.addressLine === "string" ? input.addressLine.trim().slice(0, 500) : "",
    postalCode: normalizeIranDigits(input.postalCode).replace(/\D/g, "").slice(0, 10),
    notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 500) : "",
  };
  const valid = address.recipientName.length >= 2 &&
    /^09\d{9}$/.test(address.phone) &&
    address.province.length > 0 &&
    address.city.length > 0 &&
    address.addressLine.length >= 10 &&
    /^\d{10}$/.test(address.postalCode);
  return valid ? address : null;
};


export const getPaymentConfiguration = (_req, res) => {
  const configured = Boolean(
    process.env.ZARINPAL_MERCHANT_ID &&
    process.env.API_URL &&
    safeClientUrl() &&
    isTomanCatalogConfirmed()
  );
  return res.json({
    provider: "zarinpal",
    currency: "IRT",
    configured,
    message: configured
      ? ""
      : "برای پرداخت، شناسه پذیرنده زرین‌پال، API_URL و CLIENT_URL را تنظیم کنید؛ پس از بازبینی قیمت‌های واقعی، IRT_CATALOG_PRICES_CONFIRMED=true را فعال کنید.",
  });
};

// Routing is decided by the line's own hasVariant flag, never by whether size/color
// happen to be set (BIZ-6). Returns "released" | "skipped" for one reserved line.
const releaseLineStock = async (item, session) => {
  const options = session ? { session } : {};
  let result;
  if (item.hasVariant) {
    result = await Product.updateOne(
      { _id: item.product, variants: { $elemMatch: { size: optionValue(item.size), color: optionValue(item.color) } } },
      { $inc: { "variants.$.stock": item.quantity } },
      options
    );
  } else {
    result = await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }, options);
  }
  return result.matchedCount ? "released" : "skipped";
};

const releaseReservedInventoryDirect = async (items = []) => {
  for (const item of items) {
    if (!item.stockReserved || !item.product || item.quantity <= 0) continue;
    const outcome = await releaseLineStock(item);
    if (outcome === "skipped") console.error("RELEASE_SKIPPED: stock target not found", String(item.product), item.size, item.color);
  }
};

const isTransactionUnsupported = (error) =>
  /Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(error?.message || "");

export const releaseReservedInventory = async (items = [], orderId = null) => {
  if (!orderId) return releaseReservedInventoryDirect(items);

  const session = await mongoose.startSession();
  let transactionUnsupported = false;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, paymentProvider: "zarinpal", currency: "IRT" }).session(session);
      if (!order) return;
      let changed = false;
      for (let index = 0; index < order.products.length; index += 1) {
        const item = order.products[index];
        if (!item.stockReserved || !item.product || item.quantity <= 0) continue;
        const productExists = await Product.exists({ _id: item.product }).session(session);
        if (productExists) {
          const outcome = await releaseLineStock(item, session);
          if (outcome === "skipped") {
            // A renamed/removed variant must not block releasing the other lines.
            item.releaseSkipped = true;
            console.error("RELEASE_SKIPPED: stock target not found", String(orderId), String(item.product), item.size, item.color);
          }
        } else {
          item.releaseSkipped = true;
        }
        item.stockReserved = false;
        changed = true;
      }
      if (changed) await order.save({ session });
    });
  } catch (error) {
    if (!isTransactionUnsupported(error)) throw error;
    transactionUnsupported = true;
    console.warn("MongoDB transactions are unavailable; using compatibility inventory release:", error.message);
  } finally {
    await session.endSession();
  }

  if (transactionUnsupported) {
    // Standalone local MongoDB has no transactions. Preserve local development;
    // production recovery is atomic on MongoDB Atlas/replica sets.
    await releaseReservedInventoryDirect(items);
    const updates = {};
    items.forEach((item, index) => {
      if (item.stockReserved) updates[`products.${index}.stockReserved`] = false;
    });
    if (Object.keys(updates).length) await Order.updateOne({ _id: orderId, paymentProvider: "zarinpal", currency: "IRT" }, { $set: updates });
  }
};

// Re-reserve stock for a paid_after_expiry order, all lines or none. Throws when any
// line cannot be reserved; the caller flags the order for manual review.
const reReserveOrderStock = async (orderId) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId }).session(session);
      if (!order) return;
      const lines = order.products
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.stockReserved && !item.releaseSkipped);
      if (!lines.length) return;
      const ids = [...new Set(lines.map(({ item }) => String(item.product)))];
      const products = await Product.find({ _id: { $in: ids } }).session(session).lean();
      const byId = new Map(products.map((product) => [String(product._id), product]));
      await reserveInventory(
        lines.map(({ item }) => ({ product: String(item.product), quantity: item.quantity, size: item.size, color: item.color })),
        byId,
        { session }
      );
      for (const { index } of lines) order.products[index].stockReserved = true;
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }
};

// Finalization is idempotent and ordered so that no side effect can strand a paid order:
// 1. coupon redeem (state-machine guarded; a permanently unredeemable counter is flagged
//    for review instead of blocking fulfilment), 2. best-effort cart cleanup,
// 3. the finalizedAt compare-and-set that releases the order to fulfilment.
const finalizePaidOrder = async (paidOrder) => {
  if (!paidOrder || paidOrder.finalizedAt) return;
  if (paidOrder.couponReservationStatus === "reserved") {
    try {
      await redeemCouponReservationForOrder(paidOrder._id);
    } catch (error) {
      if (error?.message !== "COUPON_RESERVATION_COUNTER_NOT_REDEEMABLE") throw error;
      console.error("COUPON_REDEEM_BLOCKED: paid order needs manual coupon review", String(paidOrder._id));
      await Order.updateOne(
        { _id: paidOrder._id, paymentStatus: "paid" },
        { $set: { needsManualReview: true, manualReviewReason: "coupon_redeem_failed" } }
      );
    }
  }
  try {
    // $pull does not depend on a stale in-memory user document (no VersionError).
    for (const purchased of paidOrder.products || []) {
      await User.updateOne(
        { _id: paidOrder.user },
        { $pull: { cartItems: { product: purchased.product, size: optionValue(purchased.size), color: optionValue(purchased.color) } } }
      );
    }
  } catch (error) {
    console.error("Cart cleanup after payment failed (non-fatal)", String(paidOrder._id), error.message);
  }
  const event = {
    status: "processing",
    note: "پرداخت تأیید شد؛ سفارش برای آماده‌سازی ارسال ثبت شد.",
    createdAt: new Date(),
  };
  const base = { _id: paidOrder._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "paid", finalizedAt: null };
  const advanced = await Order.updateOne(
    { ...base, shipmentStatus: { $in: [null, "not_ready"] } },
    { $set: { finalizedAt: new Date(), shipmentStatus: "processing" }, $push: { shipmentEvents: event } }
  );
  if (!advanced.modifiedCount) {
    // An admin already moved the shipment: only stamp finalizedAt, never rewind the status.
    await Order.updateOne(base, { $set: { finalizedAt: new Date() } });
  }
};

export const reserveInventory = async (items, productsById, { session } = {}) => {
  const reserved = [];
  const orderItems = [];
  try {
    for (const item of items) {
      const id = cartProductId(item);
      const product = id && productsById.get(id);
      const quantity = Number(item.quantity);
      const size = optionValue(item.size);
      const color = optionValue(item.color);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || product.isActive === false) {
        throw new Error("INVALID_CART");
      }
      if (!hasConfiguredInventory(product)) throw new Error("UNTRACKED_INVENTORY");

      const hasVariant = (product.variants || []).length > 0;
      const selectedVariant = hasVariant ? findVariant(product, size, color) : null;
      if (hasVariant && (!selectedVariant || !Number.isSafeInteger(selectedVariant.stock) || selectedVariant.stock < 0)) {
        throw new Error("UNTRACKED_INVENTORY");
      }
      if (hasVariant) {
        const updated = await Product.findOneAndUpdate(
          {
            _id: product._id,
            isActive: { $ne: false },
            price: product.price,
            variants: { $elemMatch: { size, color, stock: { $gte: quantity } } },
          },
          { $inc: { "variants.$.stock": -quantity } },
          session ? { new: true, session } : { new: true }
        ).lean();
        if (!updated) throw new Error("INSUFFICIENT_STOCK");
        reserved.push({ product: product._id, quantity, size, color, hasVariant: true, stockReserved: true });
        orderItems.push({ product: product._id, quantity, price: product.price, size, color, productName: product.name, image: product.image || "", hasVariant: true, stockReserved: true });
      } else if (isTracked(product)) {
        const updated = await Product.findOneAndUpdate(
          { _id: product._id, isActive: { $ne: false }, price: product.price, stock: { $gte: quantity } },
          { $inc: { stock: -quantity } },
          session ? { new: true, session } : { new: true }
        ).lean();
        if (!updated) throw new Error("INSUFFICIENT_STOCK");
        reserved.push({ product: product._id, quantity, hasVariant: false, stockReserved: true });
        orderItems.push({ product: product._id, quantity, price: product.price, size, color, productName: product.name, image: product.image || "", hasVariant: false, stockReserved: true });
      } else {
        // Defense in depth: unknown inventory is not an unlimited-stock policy.
        throw new Error("UNTRACKED_INVENTORY");
      }
    }
    return { orderItems, reserved };
  } catch (error) {
    // A transaction caller owns rollback; compensating writes inside its session
    // could otherwise duplicate the rollback.
    if (!session) await releaseReservedInventory(reserved);
    throw error;
  }
};
export const createZarinpalCheckout = async (req, res) => {
  if (!isTomanCatalogConfirmed()) {
    return res.status(503).json({ message: "پرداخت تا زمان تأیید قیمت‌های واقعی کاتالوگ به تومان غیرفعال است." });
  }
  if (!process.env.ZARINPAL_MERCHANT_ID || !process.env.API_URL || !safeClientUrl()) {
    return res.status(503).json({ message: "Zarinpal is not configured on the server" });
  }

  let reserved = [];
  let order = null;
  let checkoutOrderId = null;
  let gatewayRequestStarted = false;
  let gatewayRequestRejected = false;
  let receivedAuthority = "";
  let couponReservedWithoutOrder = false;
  let reservedCouponCode = "";
  const shippingAddress = parseShippingAddress(req.body?.shippingAddress);
  if (!shippingAddress) {
    return res.status(400).json({ message: "نام گیرنده، موبایل ایرانی، استان، شهر، نشانی کامل و کد پستی ۱۰ رقمی را بررسی کنید." });
  }
  try {
    const cartItems = req.user.cartItems || [];
    if (!cartItems.length) return res.status(400).json({ message: "سبد خرید خالی است" });

    const productIds = cartItems.map(cartProductId).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds }, isActive: { $ne: false } }).lean();
    const productsById = new Map(products.map((product) => [product._id.toString(), product]));
    const validated = cartItems.map((item) => {
      const id = cartProductId(item);
      const product = id && productsById.get(id);
      const quantity = Number(item.quantity);
      const size = optionValue(item.size);
      const color = optionValue(item.color);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 ||
          !Number.isSafeInteger(product.price) || product.price < 0) return null;
      if (!hasConfiguredInventory(product)) return null;
      const hasVariant = (product.variants || []).length > 0;
      const selectedVariant = hasVariant ? findVariant(product, size, color) : null;
      if (hasVariant && (!selectedVariant || selectedVariant.stock < quantity)) return null;
      // Options on a product without variants are stale cart data (BIZ-6): refuse them
      // instead of reserving against a stock target that cannot be released by option.
      if (!hasVariant && (size || color)) return null;
      if (!hasVariant && isTracked(product) && product.stock < quantity) return null;
      return { productId: id, quantity, product, size, color, hasVariant };
    });
    if (validated.some((item) => !item)) {
      return res.status(409).json({ message: "موجودی یا اطلاعات یکی از کالاهای سبد خرید معتبر نیست؛ سبد خرید را به‌روزرسانی کنید." });
    }

    const couponCode = typeof req.body.couponCode === "string" ? req.body.couponCode.trim().toUpperCase() : "";
    let coupon = null;
    let couponDiscountAmount = 0;
    let shippingFee = 0;
    let totalToman = 0;

    // Reserve coupon usage, finite inventory, and the pending order in one MongoDB
    // transaction. A crash cannot leave stock reserved without a durable order record.
    checkoutOrderId = new mongoose.Types.ObjectId();
    let transactionResult = null;
    const transactionItems = validated.map((item) => ({
      product: item.productId,
      quantity: item.quantity,
      size: item.size,
      color: item.color,
    }));
    const initialPricesByProductId = new Map(
      validated.map((item) => [String(item.productId), item.product.price])
    );
    // Ensure the per-user guard document exists outside the transaction (an upsert race
    // inside it would surface as a duplicate-key error instead of a retryable conflict).
    await CheckoutGuard.updateOne({ _id: req.user._id }, { $setOnInsert: { seq: 0 } }, { upsert: true });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        transactionResult = null;
        // Serialize this user's checkouts: concurrent transactions write the same document,
        // so one of them aborts with a transient conflict and is retried after the other
        // commits. The pending-order cap below is therefore race-safe (BIZ-4).
        await CheckoutGuard.updateOne({ _id: req.user._id }, { $inc: { seq: 1 } }, { session });
        const ownPending = await Order.find({
          user: req.user._id,
          paymentProvider: "zarinpal",
          currency: "IRT",
          paymentStatus: "pending",
          expiresAt: { $gt: new Date(zarinpalDeps.now()) },
        }).session(session).lean();
        const requestedSignature = cartSignature(transactionItems);
        const reusable = ownPending.find((pending) =>
          cartSignature(pending.products) === requestedSignature && (pending.couponCode || "") === couponCode
        );
        if (reusable) {
          transactionResult = { reuse: reusable };
          return;
        }
        if (ownPending.length >= MAX_PENDING_ORDERS_PER_USER) {
          const limitError = new Error("PENDING_ORDER_LIMIT");
          limitError.code = "PENDING_ORDER_LIMIT";
          throw limitError;
        }
        const uniqueProductIds = [...new Set(transactionItems.map((item) => String(item.product)))];
        const currentProducts = await Product.find({
          _id: { $in: uniqueProductIds },
          isActive: { $ne: false },
        }).session(session).lean();
        const transactionProductsById = new Map(currentProducts.map((product) => [String(product._id), product]));
        if (transactionProductsById.size !== uniqueProductIds.length) {
          throw new Error("INVALID_CART");
        }
        for (const [productId, currentProduct] of transactionProductsById) {
          if (currentProduct.price !== initialPricesByProductId.get(productId)) {
            const priceError = new Error("PRICE_CHANGED");
            priceError.code = "PRICE_CHANGED";
            throw priceError;
          }
        }

        const transactionSubtotal = transactionItems.reduce((sum, item) => {
          const currentProduct = transactionProductsById.get(String(item.product));
          if (!currentProduct || !Number.isSafeInteger(currentProduct.price) || currentProduct.price < 0) {
            throw new Error("INVALID_CART");
          }
          return sum + currentProduct.price * item.quantity;
        }, 0);
        if (!Number.isSafeInteger(transactionSubtotal) || transactionSubtotal < 0) {
          const amountError = new Error("Invalid checkout amount");
          amountError.code = "INVALID_CHECKOUT_AMOUNT";
          throw amountError;
        }

        let transactionCoupon = null;
        let transactionDiscount = 0;
        if (couponCode) {
          const reservation = await reserveCoupon(couponCode, transactionSubtotal, new Date(), {
            session,
            userId: req.user._id,
            orderId: checkoutOrderId,
          });
          if (reservation.error) {
            const couponError = new Error(reservation.error);
            couponError.code = "COUPON_REJECTED";
            throw couponError;
          }
          transactionCoupon = reservation.coupon;
          transactionDiscount = reservation.discountAmount;
        }

        // Read dynamic shipping settings from the same transaction snapshot as
        // the catalogue and inventory, so an admin update cannot race checkout totals.
        const transactionShippingSettings = await getShippingSettings({ session });
        const transactionDiscountedSubtotal = transactionSubtotal - transactionDiscount;
        const transactionShippingFee = calculateShippingFee(transactionDiscountedSubtotal, transactionShippingSettings);
        const transactionTotal = transactionDiscountedSubtotal + transactionShippingFee;
        if (!Number.isSafeInteger(transactionTotal) || transactionTotal < 0) {
          const amountError = new Error("Invalid checkout amount");
          amountError.code = "INVALID_CHECKOUT_AMOUNT";
          throw amountError;
        }

        const reservations = await reserveInventory(transactionItems, transactionProductsById, { session });
        const [createdOrder] = await Order.create([{
          _id: checkoutOrderId,
          user: req.user._id,
          products: reservations.orderItems,
          shippingAddress,
          shipmentStatus: "not_ready",
          totalAmount: transactionTotal,
          subtotalAmount: transactionSubtotal,
          shippingFee: transactionShippingFee,
          currency: "IRT",
          paymentProvider: "zarinpal",
          paymentStatus: "pending",
          status: "pending",
          couponCode: transactionCoupon?.code || "",
          couponDiscountAmount: transactionDiscount,
          couponDiscountPercentage: transactionCoupon ? Number(transactionCoupon.discountPercentage) : 0,
          couponReservationStatus: transactionCoupon ? "reserved" : "none",
          expiresAt: new Date(zarinpalDeps.now() + 30 * 60 * 1000),
          paymentRequestStatus: "not_started",
        }], { session });

        transactionResult = {
          order: createdOrder,
          reserved: reservations.reserved,
          coupon: transactionCoupon,
          couponDiscountAmount: transactionDiscount,
          shippingFee: transactionShippingFee,
          totalToman: transactionTotal,
        };
      });
    } finally {
      await session.endSession();
    }

    if (!transactionResult) throw new Error("CHECKOUT_TRANSACTION_NO_RESULT");
    if (transactionResult.reuse) {
      // The same cart already has a live pending order: never reserve it twice.
      const existing = transactionResult.reuse;
      checkoutOrderId = null;
      if (existing.zarinpalAuthority && existing.paymentRequestStatus === "accepted") {
        return res.status(200).json({
          provider: "zarinpal",
          orderId: existing._id,
          totalAmount: existing.totalAmount,
          reused: true,
          redirectUrl: `${startPayBase()}/${encodeURIComponent(existing.zarinpalAuthority)}`,
        });
      }
      return res.status(202).json({
        status: "pending",
        orderId: existing._id,
        message: "پرداخت این سبد خرید در حال آماده‌سازی است؛ چند لحظه بعد دوباره تلاش کنید و دوباره پرداخت نکنید.",
      });
    }
    order = transactionResult.order;
    // Detach the committed order from the ended MongoDB session before later
    // payment-request status updates call save().
    if (typeof order.$session === "function") order.$session(null);
    reserved = transactionResult.reserved;
    coupon = transactionResult.coupon;
    couponDiscountAmount = transactionResult.couponDiscountAmount;
    shippingFee = transactionResult.shippingFee;
    totalToman = transactionResult.totalToman;

    // 100% discounts can legitimately create a zero-payable order when shipping is free.
    // Finalize locally instead of sending a zero amount to the payment gateway.
    if (totalToman === 0) {
      order.paymentStatus = "paid";
      order.status = "paid";
      order.paymentRequestStatus = "accepted";
      order.paymentRequestAttemptedAt = new Date();
      await order.save();
      reserved = [];
      try {
        await finalizePaidOrder(order);
      } catch (finalizationError) {
        console.error("Zero-payable order finalization deferred for reconciliation", String(order._id), finalizationError.message);
      }
      return res.status(200).json({ status: "paid", provider: "zarinpal", orderId: order._id, totalAmount: 0 });
    }

    order.paymentRequestStatus = "in_flight";
    order.paymentRequestAttemptedAt = new Date();
    await order.save();

    const callbackUrl = new URL("/api/payments/zarinpal/verify", process.env.API_URL);
    callbackUrl.searchParams.set("order_id", order._id.toString());
    gatewayRequestStarted = true;
    const gatewayResponse = await zarinpalDeps.fetch(`${apiBase()}/request.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.ZARINPAL_MERCHANT_ID,
        amount: totalToman * 10,
        description: `Store order ${order._id}`,
        callback_url: callbackUrl.toString(),
        metadata: { email: req.user.email },
      }),
      signal: AbortSignal.timeout(12000),
    });

    let payload;
    try {
      payload = await gatewayResponse.json();
    } catch {
      throw new Error("ZARINPAL_REQUEST_AMBIGUOUS");
    }

    // Errors may be under errors.code (v4) or data.code (legacy); 5xx, timeouts and
    // unparseable bodies are ambiguous and never release stock.
    const requestOutcome = classifyRequestResponse({ status: gatewayResponse.status, payload });
    receivedAuthority = requestOutcome.outcome === "accepted" ? requestOutcome.authority : "";
    if (receivedAuthority) {
      order.zarinpalAuthority = receivedAuthority;
      order.paymentRequestStatus = "accepted";
      await order.save();
      reserved = [];
      return res.status(200).json({
        provider: "zarinpal",
        orderId: order._id,
        totalAmount: totalToman,
        redirectUrl: `${startPayBase()}/${encodeURIComponent(receivedAuthority)}`,
      });
    }

    if (requestOutcome.outcome === "rejected") {
      gatewayRequestRejected = true;
      throw new Error("ZARINPAL_REQUEST_REJECTED");
    }
    throw new Error("ZARINPAL_REQUEST_AMBIGUOUS");
  } catch (error) {
    if (error?.code === "COUPON_REJECTED") {
      return res.status(400).json({ message: error.message });
    }
    if (error?.code === "PENDING_ORDER_LIMIT") {
      return res.status(409).json({ message: "چند سفارش پرداخت‌نشده‌ی فعال دارید؛ ابتدا پرداخت آن‌ها را کامل کنید یا چند دقیقه تا پایان مهلت صبر کنید." });
    }
    if (error?.code === "INVALID_CHECKOUT_AMOUNT") {
      return res.status(400).json({ message: "مبلغ سفارش به تومان معتبر نیست." });
    }
    if (error?.code === "PRICE_CHANGED") {
      return res.status(409).json({ message: "قیمت یکی از کالاها تغییر کرده است؛ سبد خرید را تازه‌سازی کنید و دوباره تلاش کنید." });
    }
    if (isTransactionUnsupported(error)) {
      return res.status(503).json({ message: "ثبت سفارش به پایگاه داده تراکنشی نیاز دارد؛ پرداخت آغاز نشد." });
    }
    const unknownCommit = error?.hasErrorLabel?.("UnknownTransactionCommitResult") ||
      (Array.isArray(error?.errorLabels) && error.errorLabels.includes("UnknownTransactionCommitResult"));
    if (!order && checkoutOrderId && unknownCommit) {
      // The transaction commit outcome itself is unknown. Never compensate by
      // releasing stock: the order may already exist. Return a stable reference
      // and require status/reconciliation before allowing another checkout.
      return res.status(202).json({
        status: "pending",
        orderId: String(checkoutOrderId),
        message: "نتیجه ثبت سفارش قطعی نیست؛ دوباره پرداخت نکنید و وضعیت سفارش را پیگیری کنید.",
      });
    }
    if (error?.message === "UNTRACKED_INVENTORY") {
      return res.status(409).json({ message: "موجودی این کالا مشخص نیست؛ تا ثبت موجودی معتبر امکان خرید وجود ندارد." });
    }
    if (order && gatewayRequestStarted && !gatewayRequestRejected) {
      // The provider may have accepted the request even though our response or
      // local persistence failed. Never release inventory on this uncertain path.
      if (receivedAuthority) {
        const recovered = await Order.findOneAndUpdate(
          { _id: order._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "pending" },
          { $set: { zarinpalAuthority: receivedAuthority, paymentRequestStatus: "accepted" } },
          { new: true }
        ).catch(() => null);
        if (recovered?.zarinpalAuthority) {
          reserved = [];
          return res.status(200).json({
            provider: "zarinpal",
            orderId: order._id,
            totalAmount: order.totalAmount,
            redirectUrl: `${startPayBase()}/${encodeURIComponent(recovered.zarinpalAuthority)}`,
          });
        }
      }

      await Order.updateOne(
        { _id: order._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "pending" },
        { $set: { paymentRequestStatus: "unknown" } }
      ).catch((persistenceError) => {
        console.error("Unable to record ambiguous Zarinpal request state", persistenceError.message);
      });
      console.error("Zarinpal request outcome is ambiguous; keeping order pending", String(order._id), error.message);
      return res.status(202).json({
        status: "pending",
        orderId: order._id,
        message: "وضعیت درخواست پرداخت قطعی نیست؛ تا مشخص‌شدن وضعیت این سفارش، دوباره پرداخت نکنید.",
      });
    }

    if (order) {
      const failedOrder = await Order.findOneAndUpdate(
        { _id: order._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "pending" },
        {
          $set: {
            paymentStatus: "failed",
            status: "failed",
            paymentRequestStatus: gatewayRequestRejected ? "rejected" : "not_started",
          },
        },
        { new: true }
      ).catch(() => null);
      if (failedOrder) {
        await releaseReservedInventory(failedOrder.products, failedOrder._id).catch(() => {});
        await releaseCouponReservationForOrder(failedOrder._id).catch((releaseError) => {
          console.error("Unable to release coupon reservation", String(failedOrder._id), releaseError.message);
        });
      }
    } else {
      await releaseReservedInventory(reserved).catch(() => {});
      if (couponReservedWithoutOrder && reservedCouponCode) {
        await releaseCouponReservationByCode(reservedCouponCode).catch(() => {});
      }
    }
    console.error("Error creating Zarinpal checkout", error.message);
    if (error.message === "INSUFFICIENT_STOCK" || error.message === "INVALID_CART") {
      return res.status(409).json({ message: "موجودی یکی از کالاها تغییر کرده است؛ سبد خرید را دوباره بررسی کنید." });
    }
    if (gatewayRequestRejected) {
      return res.status(502).json({ message: "درگاه پرداخت درخواست را نپذیرفت؛ موجودی آزاد شد. لطفاً کمی بعد دوباره تلاش کنید." });
    }
    return res.status(502).json({ message: "شروع پرداخت ناموفق بود. لطفاً دوباره تلاش کنید." });
  }
};

// Provider verification. Never throws: network errors, timeouts, 4xx/5xx and malformed
// bodies all classify as "uncertain", which keeps stock and coupons reserved.
const callVerify = async (order, timeoutMs) => {
  const expectedAmountRial = order.totalAmount * 10;
  try {
    const response = await zarinpalDeps.fetch(`${apiBase()}/verify.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.ZARINPAL_MERCHANT_ID,
        amount: expectedAmountRial,
        authority: order.zarinpalAuthority,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => null);
    return classifyVerifyResponse({ status: response.status, payload, expectedAmountRial });
  } catch (error) {
    return {
      outcome: "uncertain",
      reason: error?.name === "TimeoutError" ? "timeout" : "network_error",
      code: null, location: null, refId: "", cardPan: "", fee: null, feeType: "",
    };
  }
};

const recordVerifyObservation = (orderId, outcome) => Order.updateOne(
  { _id: orderId },
  { $set: { lastVerifyCode: Number.isInteger(outcome.code) ? outcome.code : null, lastVerifyAt: new Date(zarinpalDeps.now()) } }
).catch(() => {});

const resetReconciliation = { reconciliationAttempts: 0, reconciliationLastAttemptAt: null, reconciliationNextAttemptAt: null };
const orderScope = { paymentProvider: "zarinpal", currency: "IRT" };

const providerFields = (outcome) => ({
  zarinpalCardPan: outcome.cardPan || "",
  zarinpalFee: outcome.fee ?? null,
  zarinpalFeeType: outcome.feeType || "",
  lastVerifyCode: Number.isInteger(outcome.code) ? outcome.code : null,
  lastVerifyAt: new Date(zarinpalDeps.now()),
});

// Writes the provider ref id; a duplicate ref id (unique index) must not block recording
// a real payment, so it is stored without the ref id and flagged for review.
const casWithRefId = async (filter, fields, outcome) => {
  const withRef = outcome.refId ? { ...fields, zarinpalRefId: outcome.refId } : fields;
  try {
    return await Order.findOneAndUpdate(filter, { $set: withRef }, { new: true });
  } catch (error) {
    if (error?.code !== 11000 || !outcome.refId) throw error;
    console.error("DUPLICATE_PROVIDER_REF_ID: recording payment without ref id", outcome.refId);
    return Order.findOneAndUpdate(
      filter,
      { $set: { ...fields, needsManualReview: true, manualReviewReason: "duplicate_provider_ref_id" } },
      { new: true }
    );
  }
};

// pending -> paid, only ever from a verify outcome of "paid" (code 100/101, amount matched).
const markOrderPaid = (orderId, outcome) => casWithRefId(
  { _id: orderId, ...orderScope, paymentStatus: "pending" },
  { paymentStatus: "paid", status: "paid", paymentRequestStatus: "accepted", ...providerFields(outcome), ...resetReconciliation },
  outcome
);

// failed/expired -> paid_after_expiry: the customer paid after we released the stock.
// The order is NOT shipped automatically; stock is re-reserved when possible.
const markPaidAfterExpiry = async (orderId, outcome) => {
  const updated = await casWithRefId(
    { _id: orderId, ...orderScope, paymentStatus: { $in: ["failed", "expired"] } },
    {
      paymentStatus: "paid_after_expiry",
      status: "paid_after_expiry",
      needsManualReview: true,
      manualReviewReason: "paid_after_expiry",
      paidAfterExpiryAt: new Date(zarinpalDeps.now()),
      ...providerFields(outcome),
      ...resetReconciliation,
    },
    outcome
  );
  if (!updated) return null;
  console.error("PAID_AFTER_EXPIRY: payment confirmed for a released order; manual review required", String(updated._id));
  let reason = "paid_after_expiry_stock_rereserved";
  try {
    await reReserveOrderStock(updated._id);
  } catch (error) {
    reason = "paid_after_expiry_stock_unavailable";
    console.error("PAID_AFTER_EXPIRY: stock could not be re-reserved", String(updated._id), error.message);
  }
  await Order.updateOne({ _id: updated._id }, { $set: { manualReviewReason: reason } }).catch(() => {});
  return updated;
};

// pending -> failed|expired, only after a definitive unpaid verify answer. Releases stock and coupon.
const markOrderUnpaid = async (orderId, finalStatus, extra = {}) => {
  const closed = await Order.findOneAndUpdate(
    { _id: orderId, ...orderScope, paymentStatus: "pending" },
    { $set: { paymentStatus: finalStatus, status: finalStatus, ...extra, ...resetReconciliation } },
    { new: true }
  );
  if (closed) {
    await releaseReservedInventory(closed.products, closed._id);
    await releaseCouponReservationForOrder(closed._id);
  }
  return closed;
};

const flagAmountMismatch = async (orderId) => {
  console.error("PAYMENT_AMOUNT_MISMATCH: provider reports a different amount; holding order for review", String(orderId));
  await Order.updateOne(
    { _id: orderId, ...orderScope, paymentStatus: "pending" },
    { $set: { needsManualReview: true, manualReviewReason: "amount_mismatch" } }
  ).catch(() => {});
};

export const verifyZarinpalPayment = async (req, res) => {
  const authority = typeof req.query.Authority === "string" ? req.query.Authority : "";
  const orderId = typeof req.query.order_id === "string" ? req.query.order_id : "";
  const gatewayStatus = typeof req.query.Status === "string" ? req.query.Status : "";
  const resultBase = safeClientUrl();

  if (!resultBase) return res.status(503).send("CLIENT_URL is not configured");
  if (!mongoose.isValidObjectId(orderId) || !authority) {
    return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=invalid-callback`);
  }
  const pendingUrl = `${resultBase}/purchase-cancel?provider=zarinpal&reason=verification-pending&order_id=${encodeURIComponent(orderId)}`;
  const failedUrl = `${resultBase}/purchase-cancel?provider=zarinpal&reason=payment-not-confirmed&order_id=${encodeURIComponent(orderId)}`;
  const successUrl = `${resultBase}/purchase-success?provider=zarinpal&order_id=${encodeURIComponent(orderId)}`;

  try {
    const order = await Order.findOne({ _id: orderId, ...orderScope, zarinpalAuthority: authority });
    if (!order) return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=order-not-found`);
    if (order.paymentStatus === "paid") {
      await finalizePaidOrder(order);
      return res.redirect(successUrl);
    }
    if (order.paymentStatus === "paid_after_expiry") return res.redirect(pendingUrl);
    // The gateway's Status=NOK is only a hint that the customer cancelled. It is never
    // trusted: the provider is asked once and its answer decides.
    if (gatewayStatus === "NOK") console.warn("Zarinpal callback Status=NOK; verifying with the provider", String(order._id));

    const outcome = await callVerify(order, 12000);
    await recordVerifyObservation(order._id, outcome);

    if (!["pending", "failed", "expired"].includes(order.paymentStatus)) return res.redirect(pendingUrl);

    if (outcome.outcome === "paid") {
      if (order.paymentStatus === "pending") {
        const paid = await markOrderPaid(order._id, outcome);
        if (paid) {
          try {
            await finalizePaidOrder(paid);
          } catch (finalizationError) {
            // Paid is durable; the reconciler retries finalization.
            console.error("Paid order finalization deferred for reconciliation", String(paid._id), finalizationError.message);
          }
          return res.redirect(successUrl);
        }
        const latest = await Order.findOne({ _id: order._id, ...orderScope }).lean();
        if (latest?.paymentStatus === "paid") return res.redirect(successUrl);
        if (latest?.paymentStatus === "paid_after_expiry") return res.redirect(pendingUrl);
        // Lost a race with expiry: re-run through the failed/expired branch.
        const recovered = await markPaidAfterExpiry(order._id, outcome);
        return res.redirect(recovered ? pendingUrl : failedUrl);
      }
      // failed/expired but the customer did pay.
      const recovered = await markPaidAfterExpiry(order._id, outcome);
      if (recovered) return res.redirect(pendingUrl);
      const latest = await Order.findOne({ _id: order._id, ...orderScope }).lean();
      return res.redirect(latest?.paymentStatus === "paid" ? successUrl : pendingUrl);
    }

    if (outcome.outcome === "unpaid") {
      if (order.paymentStatus === "pending") await markOrderUnpaid(order._id, "failed");
      // For failed/expired orders this fresh verify is what justifies showing a definitive failure.
      return res.redirect(failedUrl);
    }

    if (outcome.outcome === "amount_mismatch") await flagAmountMismatch(order._id);
    // uncertain: never a definitive failure.
    return res.redirect(pendingUrl);
  } catch (error) {
    console.error("Error verifying Zarinpal payment", error.message);
    // Any exception may occur after the gateway succeeded or the paid status
    // was stored. Keep the customer on an explicitly uncertain path.
    return res.redirect(mongoose.isValidObjectId(orderId) ? pendingUrl : `${resultBase}/purchase-cancel?provider=zarinpal&reason=verification-pending`);
  }
};


export const getZarinpalOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  if (!mongoose.isValidObjectId(orderId)) {
    return res.status(400).json({ message: "Invalid order ID" });
  }
  try {
    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id,
      paymentProvider: "zarinpal",
      currency: "IRT",
    }).select("_id paymentStatus status totalAmount currency createdAt").lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.json({
      orderId: order._id,
      paymentStatus: order.paymentStatus,
      status: order.status,
      currency: order.currency,
      totalAmount: order.totalAmount,
      paid: order.paymentStatus === "paid",
    });
  } catch (error) {
    console.error("Error loading Zarinpal order status", error.message);
    return res.status(500).json({ message: "Unable to load order status" });
  }
};


const reconciliationLockKey = "lock:payment-reconciliation";
const releaseReconciliationLockScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

const markReconciliationAttempt = async (order) => {
  const now = new Date();
  const nextAttemptNumber = Math.max(0, Number(order.reconciliationAttempts) || 0) + 1;
  const nextAttemptAt = new Date(now.getTime() + getNextReconciliationDelayMs(nextAttemptNumber));
  const result = await Order.updateOne(
    {
      _id: order._id,
      paymentProvider: "zarinpal",
      currency: "IRT",
      paymentStatus: order.paymentStatus,
    },
    {
      $inc: { reconciliationAttempts: 1 },
      $set: {
        reconciliationLastAttemptAt: now,
        reconciliationNextAttemptAt: nextAttemptAt,
      },
    }
  );
  return result.modifiedCount > 0;
};

// The lock is only an overlap guard (every step is a compare-and-set), so a Redis
// outage must not stop payment recovery: fall back to a Mongo lease, and if even that
// fails, proceed without a guard and say so in the log (BIZ-10).
const acquireReconciliationLock = async (token) => {
  try {
    const result = await redis.set(reconciliationLockKey, token, "PX", PAYMENT_RECONCILIATION_LOCK_TTL_MS, "NX");
    return result === "OK" ? { held: true, backend: "redis" } : { held: false };
  } catch (error) {
    console.error("Payment reconciliation Redis lock unavailable; using Mongo lease", {
      name: error?.name || "Error",
      code: typeof error?.code === "string" ? error.code : undefined,
    });
  }
  try {
    const acquired = await acquireMongoLease(reconciliationLockKey, token, PAYMENT_RECONCILIATION_LOCK_TTL_MS);
    return acquired ? { held: true, backend: "mongo" } : { held: false };
  } catch (error) {
    console.error("Payment reconciliation Mongo lease unavailable; running without an overlap guard", error?.message);
    return { held: true, backend: "none" };
  }
};

const releaseReconciliationLock = async (lock, token) => {
  try {
    if (lock.backend === "redis") await redis.eval(releaseReconciliationLockScript, 1, reconciliationLockKey, token);
    else if (lock.backend === "mongo") await releaseMongoLease(reconciliationLockKey, token);
  } catch (error) {
    console.error("Payment reconciliation lock release failed", {
      name: error?.name || "Error",
      code: typeof error?.code === "string" ? error.code : undefined,
    });
  }
};

// Decide one pending order that is past its lifetime and has an authority.
const reconcileExpiredPendingWithAuthority = async (order, summary) => {
  const outcome = await callVerify(order, 5000);
  await recordVerifyObservation(order._id, outcome);
  if (outcome.outcome === "paid") {
    const paid = await markOrderPaid(order._id, outcome);
    if (paid) {
      await finalizePaidOrder(paid);
      summary.paymentsRecovered += 1;
    } else {
      const current = await Order.findOne({ _id: order._id, ...orderScope }).lean();
      if (current?.paymentStatus === "paid" && !current.finalizedAt) {
        await finalizePaidOrder(current);
        summary.paidOrdersFinalized += 1;
      }
    }
    return;
  }
  if (outcome.outcome === "unpaid") {
    // Authority lifetime has passed (query grace) AND the final verify is definitive.
    const expired = await markOrderUnpaid(order._id, "expired", { paymentRequestStatus: "expired" });
    if (expired) summary.ordersExpired += 1;
    return;
  }
  if (outcome.outcome === "amount_mismatch") await flagAmountMismatch(order._id);
  summary.deferredForRetry += 1;
  const age = zarinpalDeps.now() - new Date(order.createdAt || order.expiresAt).getTime();
  if (age > PAYMENT_HOLD_ALERT_AGE_MS) {
    console.error("PAYMENT_HOLD_ALERT: provider has not given a definitive answer; stock and coupon stay reserved", {
      orderId: String(order._id), ageHours: Math.round(age / 3600000), reason: outcome.reason, code: outcome.code,
    });
  }
};

// Runs one phase in adaptive batches (5, 10, 20, 40, 50...) until the queue is empty,
// the per-phase cap is hit or the wall-clock deadline passes. Every handled order
// gets a future next-attempt time, so it is not fetched again within the run.
const runReconciliationPhase = async ({ buildQuery, sort, concurrency, deadline, handler }) => {
  let batchSize = PAYMENT_RECONCILIATION_BATCH_SIZE;
  let fetched = 0;
  while (zarinpalDeps.now() < deadline && fetched < PAYMENT_RECONCILIATION_MAX_ITEMS_PER_PHASE) {
    const orders = await Order.find(buildQuery(new Date(zarinpalDeps.now()))).sort(sort).limit(batchSize).lean();
    if (!orders.length) break;
    fetched += orders.length;
    await mapWithConcurrency(orders, concurrency, async (order) => {
      if (zarinpalDeps.now() >= deadline) return;
      await handler(order);
    });
    if (orders.length < batchSize) break;
    batchSize = Math.min(batchSize * 2, PAYMENT_RECONCILIATION_MAX_BATCH_SIZE);
  }
};

export const reconcilePendingZarinpalOrders = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(503).json({ message: "CRON_SECRET is not configured" });
  if (!isCronSecretAcceptable(cronSecret)) {
    return res.status(503).json({ message: "CRON_SECRET must be at least 32 characters" });
  }

  const authorization = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const suppliedBuffer = Buffer.from(authorization.replace(/^Bearer\s+/i, ""));
  const expectedBuffer = Buffer.from(cronSecret);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const lockToken = randomUUID();
  const lock = await acquireReconciliationLock(lockToken);
  if (!lock.held) {
    // Another invocation owns the lock. This is a safe no-op,
    // not a reconciliation failure that should page an operator every 5 minutes.
    return res.status(200).json({ success: true, skipped: true, reason: "already-running" });
  }

  const summary = {
    stockReservationsRecovered: 0,
    paidOrdersFinalized: 0,
    paymentsRecovered: 0,
    ordersExpired: 0,
    deferredForRetry: 0,
    failures: 0,
  };
  const deadline = zarinpalDeps.now() + PAYMENT_RECONCILIATION_TIME_BUDGET_MS;
  const guarded = (label, work) => async (order) => {
    try {
      if (!await markReconciliationAttempt(order)) return;
      await work(order);
    } catch (error) {
      summary.failures += 1;
      console.error(label, String(order._id), error.message);
    }
  };

  try {
    await runReconciliationPhase({
      buildQuery: (now) => buildStrandedOrdersFilter(now),
      sort: { reconciliationNextAttemptAt: 1, createdAt: 1 },
      concurrency: 1,
      deadline,
      handler: guarded("Pending inventory restoration needs retry", async (order) => {
        await releaseReservedInventory(order.products, order._id);
        await releaseCouponReservationForOrder(order._id);
        summary.stockReservationsRecovered += 1;
      }),
    });

    await runReconciliationPhase({
      buildQuery: (now) => ({ ...orderScope, paymentStatus: "paid", finalizedAt: null, ...getDueReconciliationFilter(now) }),
      sort: { reconciliationNextAttemptAt: 1, createdAt: 1 },
      concurrency: 1,
      deadline,
      handler: guarded("Paid order finalization needs retry", async (order) => {
        await finalizePaidOrder(order);
        summary.paidOrdersFinalized += 1;
      }),
    });

    await runReconciliationPhase({
      buildQuery: (now) => buildExpiredPendingFilter(now),
      sort: { reconciliationNextAttemptAt: 1, expiresAt: 1, createdAt: 1 },
      concurrency: PAYMENT_RECONCILIATION_VERIFY_CONCURRENCY,
      deadline,
      handler: guarded("Payment reconciliation item needs retry", async (order) => {
        if (!order.zarinpalAuthority) {
          const expired = await markOrderUnpaid(order._id, "expired", { paymentRequestStatus: "expired" });
          if (expired) summary.ordersExpired += 1;
          return;
        }
        await reconcileExpiredPendingWithAuthority(order, summary);
      }),
    });

    return res.status(200).json({ success: summary.failures === 0, lock: lock.backend, ...summary });
  } catch (error) {
    console.error("Payment reconciliation failed", error.message);
    return res.status(500).json({ message: "Payment reconciliation failed" });
  } finally {
    await releaseReconciliationLock(lock, lockToken);
  }
};

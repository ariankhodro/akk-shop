import mongoose from "mongoose";
import { randomUUID, timingSafeEqual } from "node:crypto";
import Order from "../models/order.model.js";
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
import { getDueReconciliationFilter, getNextReconciliationDelayMs, PAYMENT_RECONCILIATION_BATCH_SIZE, PAYMENT_RECONCILIATION_LOCK_TTL_MS } from "../lib/payment-reconciliation.js";

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
const sameCartLine = (item, productId, size, color) =>
  cartProductId(item) === productId &&
  optionValue(item.size) === optionValue(size) &&
  optionValue(item.color) === optionValue(color);
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

const releaseReservedInventoryDirect = async (items = []) => {
  for (const item of items) {
    if (!item.stockReserved || !item.product || item.quantity <= 0) continue;
    if (item.hasVariant || item.size || item.color) {
      await Product.updateOne(
        { _id: item.product, variants: { $elemMatch: { size: optionValue(item.size), color: optionValue(item.color) } } },
        { $inc: { "variants.$.stock": item.quantity } }
      );
    } else {
      await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } });
    }
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
          let result;
          if (item.hasVariant || item.size || item.color) {
            result = await Product.updateOne(
              { _id: item.product, variants: { $elemMatch: { size: optionValue(item.size), color: optionValue(item.color) } } },
              { $inc: { "variants.$.stock": item.quantity } },
              { session }
            );
          } else {
            result = await Product.updateOne(
              { _id: item.product },
              { $inc: { stock: item.quantity } },
              { session }
            );
          }
          if (!result.matchedCount) throw new Error("RESERVED_INVENTORY_TARGET_NOT_FOUND");
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

const finalizePaidOrder = async (paidOrder) => {
  if (!paidOrder || paidOrder.finalizedAt) return;
  if (paidOrder.couponReservationStatus === "reserved") {
    await redeemCouponReservationForOrder(paidOrder._id);
  }
  const user = await User.findById(paidOrder.user);
  if (user) {
    user.cartItems = (user.cartItems || []).filter((item) =>
      !(paidOrder.products || []).some((purchased) =>
        sameCartLine(item, purchased.product.toString(), purchased.size, purchased.color)
      )
    );
    await user.save();
  }
  await Order.updateOne(
    { _id: paidOrder._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "paid", finalizedAt: null },
    {
      $set: { finalizedAt: new Date(), shipmentStatus: "processing" },
      $push: {
        shipmentEvents: {
          status: "processing",
          note: "پرداخت تأیید شد؛ سفارش برای آماده‌سازی ارسال ثبت شد.",
          createdAt: new Date(),
        },
      },
    }
  );
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
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        transactionResult = null;
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
          const reservation = await reserveCoupon(couponCode, transactionSubtotal, new Date(), { session });
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
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
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
    const gatewayResponse = await fetch(`${apiBase()}/request.json`, {
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

    receivedAuthority = gatewayResponse.ok && payload?.data?.code === 100 && typeof payload?.data?.authority === "string"
      ? payload.data.authority
      : "";
    if (gatewayResponse.ok && payload?.data?.code === 100 && receivedAuthority) {
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

    // A structured provider validation/business error confirms rejection.
    // HTTP errors, timeouts, malformed responses, and unknown payloads do not.
    if (gatewayResponse.ok && Number.isInteger(payload?.errors?.code)) {
      gatewayRequestRejected = true;
      throw new Error("ZARINPAL_REQUEST_REJECTED");
    }
    throw new Error("ZARINPAL_REQUEST_AMBIGUOUS");
  } catch (error) {
    if (error?.code === "COUPON_REJECTED") {
      return res.status(400).json({ message: error.message });
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

export const verifyZarinpalPayment = async (req, res) => {
  const authority = typeof req.query.Authority === "string" ? req.query.Authority : "";
  const orderId = typeof req.query.order_id === "string" ? req.query.order_id : "";
  const resultBase = safeClientUrl();

  if (!resultBase) return res.status(503).send("CLIENT_URL is not configured");
  if (!mongoose.isValidObjectId(orderId) || !authority) {
    return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=invalid-callback`);
  }

  try {
    const order = await Order.findOne({
      _id: orderId,
      paymentProvider: "zarinpal",
      currency: "IRT",
      zarinpalAuthority: authority,
    });
    if (!order) return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=order-not-found`);
    if (order.paymentStatus === "paid") {
      await finalizePaidOrder(order);
      return res.redirect(`${resultBase}/purchase-success?provider=zarinpal&order_id=${order._id}`);
    }
    if (order.paymentStatus !== "pending") {
      if (["failed", "expired"].includes(order.paymentStatus)) {
        return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=payment-not-confirmed&order_id=${order._id}`);
      }
      return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=verification-pending&order_id=${order._id}`);
    }

    const response = await fetch(`${apiBase()}/verify.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: process.env.ZARINPAL_MERCHANT_ID,
        amount: order.totalAmount * 10,
        authority,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json().catch(() => ({}));
    const code = payload?.data?.code;
    if (!response.ok || !Number.isInteger(code)) {
      // An HTTP/network/provider response that cannot be classified is not
      // proof of a failed payment. Leave it pending for the reconciler.
      return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=verification-pending&order_id=${order._id}`);
    }
    if (code !== 100 && code !== 101) {
      if (!reconciliationTerminalUnpaidCodes.has(code)) {
        return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=verification-pending&order_id=${order._id}`);
      }
      const failed = await Order.findOneAndUpdate(
        { _id: order._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "pending" },
        { $set: { paymentStatus: "failed", status: "failed", reconciliationAttempts: 0, reconciliationLastAttemptAt: null, reconciliationNextAttemptAt: null } },
        { new: true }
      );
      if (failed) {
        await releaseReservedInventory(failed.products, failed._id);
        await releaseCouponReservationForOrder(failed._id);
      }
      return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=payment-not-confirmed&order_id=${order._id}`);
    }

    const paid = await Order.findOneAndUpdate(
      { _id: order._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "pending" },
      {
        $set: {
          paymentStatus: "paid",
          status: "paid",
          paymentRequestStatus: "accepted",
          zarinpalRefId: String(payload?.data?.ref_id ?? ""),
          reconciliationAttempts: 0,
          reconciliationLastAttemptAt: null,
          reconciliationNextAttemptAt: null,
        },
      },
      { new: true }
    );
    if (!paid) {
      const latest = await Order.findOne({ _id: order._id, paymentProvider: "zarinpal", currency: "IRT" }).lean();
      if (latest?.paymentStatus === "paid") {
        return res.redirect(`${resultBase}/purchase-success?provider=zarinpal&order_id=${order._id}`);
      }
      return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&order_id=${order._id}`);
    }

    await finalizePaidOrder(paid);
    return res.redirect(`${resultBase}/purchase-success?provider=zarinpal&order_id=${order._id}`);
  } catch (error) {
    console.error("Error verifying Zarinpal payment", error.message);
    // Any exception may occur after the gateway succeeded or the paid status
    // was stored. Keep the customer on an explicitly uncertain path.
    const orderQuery = mongoose.isValidObjectId(orderId) ? `&order_id=${encodeURIComponent(orderId)}` : "";
    return res.redirect(`${resultBase}/purchase-cancel?provider=zarinpal&reason=verification-pending${orderQuery}`);
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


const reconciliationTerminalUnpaidCodes = new Set([-11, -12, -21, -22, -42]);
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

export const reconcilePendingZarinpalOrders = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(503).json({ message: "CRON_SECRET is not configured" });

  const authorization = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
  const suppliedBuffer = Buffer.from(authorization.replace(/^Bearer\s+/i, ""));
  const expectedBuffer = Buffer.from(cronSecret);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const lockToken = randomUUID();
  let lockResult;
  try {
    lockResult = await redis.set(
      reconciliationLockKey,
      lockToken,
      "PX",
      PAYMENT_RECONCILIATION_LOCK_TTL_MS,
      "NX"
    );
  } catch (error) {
    console.error("Payment reconciliation lock is unavailable", {
      name: error?.name || "Error",
      code: typeof error?.code === "string" ? error.code : undefined,
    });
    return res.status(503).json({ message: "Payment reconciliation is temporarily unavailable" });
  }
  if (lockResult !== "OK") {
    // Another invocation owns the distributed lock. This is a safe no-op,
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

  try {
    const now = new Date();
    const due = getDueReconciliationFilter(now);

    const strandedOrders = await Order.find({
      paymentProvider: "zarinpal",
      currency: "IRT",
      paymentStatus: { $in: ["failed", "expired"] },
      $or: [
        { products: { $elemMatch: { stockReserved: true } } },
        { couponReservationStatus: "reserved" },
      ],
      ...due,
    }).sort({ reconciliationNextAttemptAt: 1, createdAt: 1 }).limit(PAYMENT_RECONCILIATION_BATCH_SIZE).lean();

    for (const order of strandedOrders) {
      try {
        if (!await markReconciliationAttempt(order)) continue;
        await releaseReservedInventory(order.products, order._id);
        await releaseCouponReservationForOrder(order._id);
        summary.stockReservationsRecovered += 1;
      } catch (error) {
        summary.failures += 1;
        console.error("Pending inventory restoration needs retry", String(order._id), error.message);
      }
    }

    const unfinalizedPaidOrders = await Order.find({
      paymentProvider: "zarinpal",
      currency: "IRT",
      paymentStatus: "paid",
      finalizedAt: null,
      ...due,
    }).sort({ reconciliationNextAttemptAt: 1, createdAt: 1 }).limit(PAYMENT_RECONCILIATION_BATCH_SIZE).lean();

    for (const order of unfinalizedPaidOrders) {
      try {
        if (!await markReconciliationAttempt(order)) continue;
        await finalizePaidOrder(order);
        summary.paidOrdersFinalized += 1;
      } catch (error) {
        summary.failures += 1;
        console.error("Paid order finalization needs retry", String(order._id), error.message);
      }
    }

    const expiredPendingOrders = await Order.find({
      paymentProvider: "zarinpal",
      currency: "IRT",
      paymentStatus: "pending",
      expiresAt: { $lte: now },
      ...due,
    }).sort({ reconciliationNextAttemptAt: 1, expiresAt: 1, createdAt: 1 })
      .limit(PAYMENT_RECONCILIATION_BATCH_SIZE).lean();

    for (const order of expiredPendingOrders) {
      try {
        if (!await markReconciliationAttempt(order)) continue;

        if (!order.zarinpalAuthority) {
          const expired = await Order.findOneAndUpdate(
            {
              _id: order._id,
              paymentProvider: "zarinpal",
              currency: "IRT",
              paymentStatus: "pending",
              zarinpalAuthority: { $in: [null, ""] },
            },
            { $set: { paymentStatus: "expired", status: "expired", paymentRequestStatus: "expired", reconciliationAttempts: 0, reconciliationLastAttemptAt: null, reconciliationNextAttemptAt: null } },
            { new: true }
          );
          if (expired) {
            summary.ordersExpired += 1;
            await releaseReservedInventory(expired.products, expired._id);
            await releaseCouponReservationForOrder(expired._id);
          }
          continue;
        }

        const response = await fetch(`${apiBase()}/verify.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_id: process.env.ZARINPAL_MERCHANT_ID,
            amount: order.totalAmount * 10,
            authority: order.zarinpalAuthority,
          }),
          signal: AbortSignal.timeout(5000),
        });
        const payload = await response.json().catch(() => null);
        const code = payload?.data?.code;

        if (!response.ok || !Number.isInteger(code)) {
          summary.deferredForRetry += 1;
          continue;
        }

        if (code === 100 || code === 101) {
          const paid = await Order.findOneAndUpdate(
            { _id: order._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "pending" },
            { $set: {
              paymentStatus: "paid",
              status: "paid",
              paymentRequestStatus: "accepted",
              zarinpalRefId: String(payload?.data?.ref_id ?? order.zarinpalRefId ?? ""),
              reconciliationAttempts: 0,
              reconciliationLastAttemptAt: null,
              reconciliationNextAttemptAt: null,
            } },
            { new: true }
          );
          if (paid) {
            await finalizePaidOrder(paid);
            summary.paymentsRecovered += 1;
          } else {
            const current = await Order.findOne({ _id: order._id, paymentProvider: "zarinpal", currency: "IRT" }).lean();
            if (current?.paymentStatus === "paid" && !current.finalizedAt) {
              await finalizePaidOrder(current);
              summary.paidOrdersFinalized += 1;
            }
          }
          continue;
        }

        // Unknown/provider-configuration errors are deferred with a persisted,
        // bounded backoff schedule so they do not monopolize every batch.
        if (reconciliationTerminalUnpaidCodes.has(code)) {
          const expired = await Order.findOneAndUpdate(
            { _id: order._id, paymentProvider: "zarinpal", currency: "IRT", paymentStatus: "pending" },
            { $set: { paymentStatus: "expired", status: "expired", reconciliationAttempts: 0, reconciliationLastAttemptAt: null, reconciliationNextAttemptAt: null } },
            { new: true }
          );
          if (expired) {
            summary.ordersExpired += 1;
            await releaseReservedInventory(expired.products, expired._id);
            await releaseCouponReservationForOrder(expired._id);
          }
        } else {
          summary.deferredForRetry += 1;
        }
      } catch (error) {
        summary.failures += 1;
        console.error("Payment reconciliation item needs retry", String(order._id), error.message);
      }
    }

    return res.status(200).json({ success: summary.failures === 0, ...summary });
  } catch (error) {
    console.error("Payment reconciliation failed", error.message);
    return res.status(500).json({ message: "Payment reconciliation failed" });
  } finally {
    try {
      await redis.eval(releaseReconciliationLockScript, 1, reconciliationLockKey, lockToken);
    } catch (error) {
      console.error("Payment reconciliation lock release failed", {
        name: error?.name || "Error",
        code: typeof error?.code === "string" ? error.code : undefined,
      });
    }
  }
};

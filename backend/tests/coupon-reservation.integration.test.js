import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Coupon from "../models/coupon.model.js";
import Order from "../models/order.model.js";
import { releaseCouponReservationForOrder, redeemCouponReservationForOrder } from "../lib/coupons.js";

const testUri = process.env.MONGO_TEST_URI || "";
const dbName = (() => {
  try { return new URL(testUri).pathname.replace(/^\//, "").split("?")[0]; }
  catch { return ""; }
})();
const safeTestDatabase = /(^|[_-])test($|[_-])/i.test(dbName);
if (testUri && !safeTestDatabase) {
  throw new Error("MONGO_TEST_URI must point to a dedicated disposable database whose name includes 'test'.");
}

const createdCouponIds = new Set();
const createdOrderIds = new Set();

before(async () => {
  if (!testUri) return;
  await mongoose.connect(testUri);
});

afterEach(async () => {
  if (!testUri || mongoose.connection.readyState !== 1) return;
  if (createdOrderIds.size) await Order.deleteMany({ _id: { $in: [...createdOrderIds] } });
  if (createdCouponIds.size) await Coupon.deleteMany({ _id: { $in: [...createdCouponIds] } });
  createdOrderIds.clear();
  createdCouponIds.clear();
});

after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});

const createCoupon = async ({ code, reservedCount = 1, usageCount = 0 } = {}) => {
  const coupon = await Coupon.create({
    code: code || "TEST-" + new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase(),
    discountPercentage: 10,
    startsAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    reservedCount,
    usageCount,
    isActive: true,
  });
  createdCouponIds.add(coupon._id);
  return coupon;
};

const createOrder = async (couponCode, overrides = {}) => {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    products: [],
    totalAmount: 1000,
    couponCode,
    couponReservationStatus: "reserved",
    paymentProvider: "zarinpal",
    paymentStatus: "failed",
    status: "failed",
    ...overrides,
  });
  createdOrderIds.add(order._id);
  return order;
};

test("concurrent coupon release decrements capacity exactly once", { skip: !testUri }, async (t) => {
  const topology = mongoose.connection.getClient().topology?.description?.type || "";
  if (!/ReplicaSet|Sharded/.test(topology)) {
    t.skip("Requires a MongoDB replica set or sharded cluster for transactional coupon accounting.");
    return;
  }
  const coupon = await createCoupon({ reservedCount: 1 });
  const order = await createOrder(coupon.code);
  const results = await Promise.all([
    releaseCouponReservationForOrder(order._id),
    releaseCouponReservationForOrder(order._id),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const [currentCoupon, currentOrder] = await Promise.all([
    Coupon.findById(coupon._id).lean(),
    Order.findById(order._id).lean(),
  ]);
  assert.equal(currentCoupon.reservedCount, 0);
  assert.equal(currentOrder.couponReservationStatus, "released");
});

test("concurrent coupon redemption increments usage exactly once", { skip: !testUri }, async (t) => {
  const topology = mongoose.connection.getClient().topology?.description?.type || "";
  if (!/ReplicaSet|Sharded/.test(topology)) {
    t.skip("Requires a MongoDB replica set or sharded cluster for transactional coupon accounting.");
    return;
  }
  const coupon = await createCoupon({ reservedCount: 1, usageCount: 0 });
  const order = await createOrder(coupon.code, { paymentStatus: "paid", status: "paid" });
  const results = await Promise.all([
    redeemCouponReservationForOrder(order._id),
    redeemCouponReservationForOrder(order._id),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const [currentCoupon, currentOrder] = await Promise.all([
    Coupon.findById(coupon._id).lean(),
    Order.findById(order._id).lean(),
  ]);
  assert.equal(currentCoupon.reservedCount, 0);
  assert.equal(currentCoupon.usageCount, 1);
  assert.equal(currentOrder.couponReservationStatus, "redeemed");
});

test("a missing coupon counter aborts release and preserves its retryable order state", { skip: !testUri }, async (t) => {
  const topology = mongoose.connection.getClient().topology?.description?.type || "";
  if (!/ReplicaSet|Sharded/.test(topology)) {
    t.skip("Requires a MongoDB replica set or sharded cluster for transactional coupon accounting.");
    return;
  }
  const coupon = await createCoupon({ reservedCount: 0 });
  const order = await createOrder(coupon.code);
  await assert.rejects(releaseCouponReservationForOrder(order._id), /COUPON_RESERVATION_COUNTER_NOT_RELEASABLE/);
  const [currentCoupon, currentOrder] = await Promise.all([
    Coupon.findById(coupon._id).lean(),
    Order.findById(order._id).lean(),
  ]);
  assert.equal(currentCoupon.reservedCount, 0);
  assert.equal(currentOrder.couponReservationStatus, "reserved", "failed release must remain retryable");
});

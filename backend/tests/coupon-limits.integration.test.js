import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Coupon, { CouponRedemption, CouponUserUsage } from "../models/coupon.model.js";
import Order from "../models/order.model.js";
import User from "../models/user.model.js";
import { createZarinpalCheckout, releaseReservedInventory, verifyZarinpalPayment } from "../controllers/zarinpal.controller.js";
import { createCoupon as createCouponHandler, deleteCoupon, validateCoupon } from "../controllers/coupon.controller.js";
import { redeemCouponReservationForOrder, releaseCouponReservationForOrder, reserveCoupon } from "../lib/coupons.js";
import { runMigration } from "../../scripts/migrate-payment-integrity.mjs";
import {
  callbackRequest, checkoutRequest, createCoupon, createProduct, createUser, fixtureResponse, jsonResponse, makeRes,
  mockProvider, testUri, useDatabase,
} from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };

let authority = 0;
const acceptingProvider = () => mockProvider(async () => {
  authority += 1;
  return jsonResponse(200, { data: { code: 100, authority: `C${String(authority).padStart(35, "0")}` }, errors: [] });
});
const cartFor = async (user, product) => {
  await User.updateOne({ _id: user._id }, { $set: { cartItems: [{ product: product._id, quantity: 1, size: "", color: "" }] } });
  return User.findById(user._id);
};
const checkoutWith = async (user, product, couponCode) => {
  const res = makeRes();
  await createZarinpalCheckout(checkoutRequest(await cartFor(user, product), { couponCode }), res);
  return res;
};
const reserveInTransaction = async (coupon, user, orderId) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await reserveCoupon(coupon.code, 10_000, new Date(), { session, userId: user._id, orderId });
      if (result.error) throw Object.assign(new Error(result.error), { code: "COUPON_REJECTED" });
    });
    return result;
  } catch (error) {
    if (error.code === "COUPON_REJECTED") return { error: error.message };
    throw error;
  } finally {
    await session.endSession();
  }
};
const usageOf = async (coupon, user) => (await CouponUserUsage.findOne({ coupon: coupon._id, user: user._id }).lean())?.count ?? 0;

test("new coupons default to one use per account; null means unlimited", opts, async () => {
  const admin = await createUser();
  const res = makeRes();
  await createCouponHandler({
    user: admin,
    body: { code: "DEFAULTLIM" + Date.now().toString(36).toUpperCase(), discountPercentage: 10, startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 86_400_000) },
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.coupon.perUserLimit, 1);
  await Coupon.deleteOne({ _id: res.body.coupon._id });

  const unlimited = makeRes();
  await createCouponHandler({
    user: admin,
    body: { code: "UNLIM" + Date.now().toString(36).toUpperCase(), discountPercentage: 10, perUserLimit: null, startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 86_400_000) },
  }, unlimited);
  assert.equal(unlimited.body.coupon.perUserLimit, null);
  await Coupon.deleteOne({ _id: unlimited.body.coupon._id });
});

test("a second checkout with a one-per-user coupon is rejected; another user is not", opts, async () => {
  const a = await createProduct({ stock: 9, price: 100_000 });
  const b = await createProduct({ stock: 9, price: 100_000 });
  const coupon = await createCoupon({ perUserLimit: 1 });
  acceptingProvider();
  const user = await createUser();

  const first = await checkoutWith(user, a, coupon.code);
  assert.equal(first.statusCode, 200);
  const second = await checkoutWith(user, b, coupon.code);
  assert.equal(second.statusCode, 400);
  assert.match(second.body.message, /حداکثر دفعات/);
  assert.equal((await Coupon.findById(coupon._id).lean()).reservedCount, 1, "rejected checkout leaves no reservation");

  const other = await checkoutWith(await createUser(), b, coupon.code);
  assert.equal(other.statusCode, 200);
  assert.equal((await Coupon.findById(coupon._id).lean()).reservedCount, 2);
});

test("concurrent reservations by one user respect the per-user limit atomically", opts, async () => {
  const coupon = await createCoupon({ perUserLimit: 2 });
  const user = await createUser();
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    reserveInTransaction(coupon, user, new mongoose.Types.ObjectId())));
  assert.equal(results.filter((result) => !result.error).length, 2);
  assert.equal(await usageOf(coupon, user), 2);
  assert.equal((await Coupon.findById(coupon._id).lean()).reservedCount, 2);
  assert.equal(await CouponRedemption.countDocuments({ coupon: coupon._id }), 2);
});

test("unlimited per-user coupons are not gated", opts, async () => {
  const coupon = await createCoupon({ perUserLimit: null });
  const user = await createUser();
  for (let i = 0; i < 3; i += 1) assert.ok(!(await reserveInTransaction(coupon, user, new mongoose.Types.ObjectId())).error);
});

test("failed payment releases the per-user slot exactly once; redeem keeps it", opts, async () => {
  const product = await createProduct({ stock: 9, price: 100_000 });
  const coupon = await createCoupon({ perUserLimit: 1 });
  acceptingProvider();
  const user = await createUser();
  assert.equal((await checkoutWith(user, product, coupon.code)).statusCode, 200);
  const order = await Order.findOne({ user: user._id });
  assert.equal(await usageOf(coupon, user), 1);

  await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: "failed", status: "failed" } });
  await Promise.all([releaseCouponReservationForOrder(order._id), releaseCouponReservationForOrder(order._id)]);
  await releaseCouponReservationForOrder(order._id);
  assert.equal(await usageOf(coupon, user), 0, "released once, never negative");
  assert.equal((await Coupon.findById(coupon._id).lean()).reservedCount, 0);

  // The slot is usable again, and a paid order redeems it permanently (idempotently).
  const again = await createProduct({ stock: 9, price: 100_000 });
  assert.equal((await checkoutWith(user, again, coupon.code)).statusCode, 200);
  const paidOrder = await Order.findOne({ user: user._id, paymentStatus: "pending" });
  mockProvider(() => fixtureResponse("verify-success-100"));
  await verifyZarinpalPayment(callbackRequest(paidOrder), makeRes());
  await redeemCouponReservationForOrder(paidOrder._id);
  assert.equal(await usageOf(coupon, user), 1);
  assert.equal((await CouponRedemption.findOne({ order: paidOrder._id }).lean()).status, "redeemed");
  const blocked = await reserveInTransaction(coupon, user, new mongoose.Types.ObjectId());
  assert.ok(blocked.error);
});

test("validate reports the per-user limit", opts, async () => {
  const product = await createProduct({ stock: 9, price: 100_000 });
  const coupon = await createCoupon({ perUserLimit: 1 });
  const user = await createUser();
  await User.updateOne({ _id: user._id }, { $set: { cartItems: [{ product: product._id, quantity: 1, size: "", color: "" }] } });
  const live = await User.findById(user._id);
  let res = makeRes();
  await validateCoupon({ user: live, body: { code: coupon.code } }, res);
  assert.equal(res.statusCode, 200);
  await CouponUserUsage.create({ coupon: coupon._id, user: user._id, count: 1 });
  res = makeRes();
  await validateCoupon({ user: live, body: { code: coupon.code } }, res);
  assert.equal(res.statusCode, 400);
});

test("deleteCoupon cannot remove a coupon that gained a reservation after the read", opts, async (t) => {
  const coupon = await createCoupon();
  const stale = await Coupon.findById(coupon._id);
  await Coupon.updateOne({ _id: coupon._id }, { $set: { reservedCount: 1 } }); // reserved after our read
  t.mock.method(Coupon, "findById", async () => stale);
  const res = makeRes();
  await deleteCoupon({ user: {}, params: { id: String(coupon._id) } }, res);
  t.mock.restoreAll();
  assert.equal(res.statusCode, 409);
  assert.ok(await Coupon.exists({ _id: coupon._id }));
});

test("deleteCoupon removes an idle coupon and answers 404 for a missing one", opts, async () => {
  const coupon = await createCoupon();
  let res = makeRes();
  await deleteCoupon({ user: {}, params: { id: String(coupon._id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(await Coupon.exists({ _id: coupon._id }), null);
  res = makeRes();
  await deleteCoupon({ user: {}, params: { id: String(coupon._id) } }, res);
  assert.equal(res.statusCode, 404);
});

test("releasing the reservation of a deleted coupon settles the order instead of failing forever", opts, async () => {
  const product = await createProduct({ stock: 9 });
  const coupon = await createCoupon();
  const order = await Order.create({
    user: (await createUser())._id, products: [{ product: product._id, quantity: 1, price: 1000, stockReserved: false }],
    totalAmount: 900, couponCode: coupon.code, couponReservationStatus: "reserved", paymentProvider: "zarinpal", paymentStatus: "failed",
  });
  await Coupon.deleteOne({ _id: coupon._id });
  await releaseReservedInventory(order.products, order._id);
  assert.equal(await releaseCouponReservationForOrder(order._id), true);
  assert.equal((await Order.findById(order._id).lean()).couponReservationStatus, "released");
  await Order.deleteOne({ _id: order._id });
});

test("migration: dry run writes nothing, apply is idempotent and rebuilds counters", opts, async () => {
  const user = await createUser();
  const coupon = await createCoupon();
  await Coupon.collection.updateOne({ _id: coupon._id }, { $unset: { perUserLimit: "" } });
  const product = await createProduct({ stock: 5 });
  const mk = (status) => Order.create({
    user: user._id, products: [{ product: product._id, quantity: 1, price: 1000 }], totalAmount: 900,
    couponCode: coupon.code, couponReservationStatus: status, paymentProvider: "zarinpal",
  });
  const [reservedOrder, redeemedOrder] = [await mk("reserved"), await mk("redeemed")];
  const silent = { log: () => {} };

  const dry = await runMigration(mongoose.connection.db, { apply: false, ...silent });
  assert.equal(dry.couponsMissingPerUserLimit >= 1, true);
  assert.equal((await Coupon.collection.findOne({ _id: coupon._id })).perUserLimit, undefined);
  assert.equal(await CouponUserUsage.countDocuments({ coupon: coupon._id }), 0);

  await runMigration(mongoose.connection.db, { apply: true, ...silent });
  await runMigration(mongoose.connection.db, { apply: true, ...silent });
  assert.equal((await Coupon.collection.findOne({ _id: coupon._id })).perUserLimit, 1);
  assert.equal(await usageOf(coupon, user), 2);
  assert.equal(await CouponRedemption.countDocuments({ coupon: coupon._id }), 2);
  await Order.deleteMany({ _id: { $in: [reservedOrder._id, redeemedOrder._id] } });
});

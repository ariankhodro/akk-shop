import test from "node:test";
import assert from "node:assert/strict";
import Coupon from "../models/coupon.model.js";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import { reconcilePendingZarinpalOrders, zarinpalDeps } from "../controllers/zarinpal.controller.js";
import { acquireMongoLease, releaseMongoLease } from "../lib/reconciliation-lease.js";
import {
  createCoupon, createProduct, createReservedOrder, createUser, fixtureResponse, jsonResponse, makeRes, mockProvider,
  testUri, useDatabase,
} from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };
const MINUTE = 60_000;
const runReconcile = async (headers = { authorization: `Bearer ${process.env.CRON_SECRET}` }) => {
  const res = makeRes();
  await reconcilePendingZarinpalOrders({ headers }, res);
  return res;
};
const expiredAgo = (minutes) => new Date(Date.now() - minutes * MINUTE);

test("cron auth: short secret is refused server-side, wrong secret is 401", opts, async () => {
  const original = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "short-secret";
    const short = await runReconcile({ authorization: "Bearer short-secret" });
    assert.equal(short.statusCode, 503);
    process.env.CRON_SECRET = "s".repeat(40);
    assert.equal((await runReconcile({ authorization: "Bearer " + "x".repeat(40) })).statusCode, 401);
    assert.equal((await runReconcile({ authorization: "Bearer " + "s".repeat(40) })).statusCode, 200);
  } finally {
    process.env.CRON_SECRET = original;
  }
});

test("reconcile works with Redis down (no REDIS_URL stub throws) using the Mongo lease", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 2, paymentStatus: "failed" });
  const res = await runReconcile();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.lock, "mongo");
  assert.equal(res.body.stockReservationsRecovered, 1);
  assert.equal((await Product.findById(product._id).lean()).stock, 5);
  assert.equal((await Order.findById(order._id).lean()).products[0].stockReserved, false);
});

test("an active Mongo lease makes a second run a safe no-op", opts, async () => {
  assert.equal(await acquireMongoLease("lock:payment-reconciliation", "other-run", 60_000), true);
  const res = await runReconcile();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.skipped, true);
  await releaseMongoLease("lock:payment-reconciliation", "other-run");
});

test("fully released historic failed orders are not requeued; a stranded one still is", opts, async () => {
  const product = await createProduct({ stock: 50 });
  const historic = [];
  for (let i = 0; i < 8; i += 1) {
    historic.push(await createReservedOrder(product, { quantity: 1, paymentStatus: "failed", stockReserved: false }));
  }
  const stranded = await createReservedOrder(product, { quantity: 3, paymentStatus: "expired" });

  const res = await runReconcile();
  assert.equal(res.body.stockReservationsRecovered, 1, "only the order that still holds stock is counted");
  for (const order of historic) {
    const current = await Order.findById(order._id).lean();
    assert.equal(current.reconciliationAttempts, 0, "historic order must not be re-queued");
    assert.equal(current.reconciliationNextAttemptAt, null);
  }
  assert.equal((await Order.findById(stranded._id).lean()).products[0].stockReserved, false);
});

test("expired pending order with authority: definitive unpaid expires and releases", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const coupon = await createCoupon();
  const order = await createReservedOrder(product, { quantity: 2, coupon, expiresAt: expiredAgo(60) });
  mockProvider(() => fixtureResponse("verify-error-54"));
  const res = await runReconcile();
  assert.equal(res.body.ordersExpired, 1);
  const current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "expired");
  assert.equal(current.products[0].stockReserved, false);
  assert.equal(current.couponReservationStatus, "released");
  assert.equal((await Product.findById(product._id).lean()).stock, 5);
  assert.equal((await Coupon.findById(coupon._id).lean()).reservedCount, 0);
});

test("expired pending order that was actually paid is recovered", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 1, expiresAt: expiredAgo(60) });
  mockProvider(() => fixtureResponse("verify-success-100"));
  const res = await runReconcile();
  assert.equal(res.body.paymentsRecovered, 1);
  const current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "paid");
  assert.ok(current.finalizedAt);
});

test("provider timeout, 5xx, rate limit and merchant errors keep the reservation and back off", opts, async () => {
  const product = await createProduct({ stock: 9 });
  const scenarios = [
    () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
    () => fixtureResponse("verify-http-500"),
    () => fixtureResponse("verify-error-12-rate-limit"),
    () => fixtureResponse("verify-error-11-merchant"),
  ];
  for (const scenario of scenarios) {
    const order = await createReservedOrder(product, { quantity: 1, expiresAt: expiredAgo(60) });
    mockProvider(scenario);
    const res = await runReconcile();
    assert.equal(res.body.deferredForRetry, 1);
    assert.equal(res.body.ordersExpired, 0);
    const current = await Order.findById(order._id).lean();
    assert.equal(current.paymentStatus, "pending");
    assert.equal(current.products[0].stockReserved, true);
    assert.equal(current.reconciliationAttempts, 1);
    assert.ok(current.reconciliationNextAttemptAt > new Date());
    await Order.deleteOne({ _id: order._id });
  }
});

test("an order inside the authority grace window is not verified or expired yet", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 1, expiresAt: expiredAgo(5) });
  const calls = mockProvider(() => fixtureResponse("verify-error-51"));
  const res = await runReconcile();
  assert.equal(calls.length, 0);
  assert.equal(res.body.ordersExpired, 0);
  assert.equal((await Order.findById(order._id).lean()).paymentStatus, "pending");
});

test("an orphaned pending order the provider never answers raises a hold alert and keeps holding", opts, async (t) => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 1, expiresAt: expiredAgo(26 * 60) });
  await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: new Date(Date.now() - 27 * 60 * MINUTE) } });
  mockProvider(() => fixtureResponse("verify-http-500"));
  const errors = [];
  t.mock.method(console, "error", (...args) => { errors.push(args.map(String).join(" ")); });
  const res = await runReconcile();
  t.mock.restoreAll();
  assert.equal(res.body.deferredForRetry, 1);
  assert.ok(errors.some((line) => line.includes("PAYMENT_HOLD_ALERT")), "alert logged");
  assert.equal((await Order.findById(order._id).lean()).paymentStatus, "pending");
});

test("pending order without an authority expires after its lifetime", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 2, expiresAt: expiredAgo(1), authority: undefined });
  await Order.collection.updateOne({ _id: order._id }, { $unset: { zarinpalAuthority: "" } });
  const calls = mockProvider(() => jsonResponse(200, {}));
  const res = await runReconcile();
  assert.equal(calls.length, 0);
  assert.equal(res.body.ordersExpired, 1);
  assert.equal((await Product.findById(product._id).lean()).stock, 5);
});

test("500 stranded orders are cleared within an hour of 5-minute runs", opts, async () => {
  const product = await createProduct({ stock: 0 });
  const user = await createUser();
  const docs = Array.from({ length: 500 }, () => ({
    user: user._id,
    products: [{ product: product._id, quantity: 1, price: product.price, hasVariant: false, stockReserved: true }],
    totalAmount: product.price,
    paymentProvider: "zarinpal",
    paymentStatus: "expired",
    status: "expired",
  }));
  const inserted = await Order.insertMany(docs);
  await Product.updateOne({ _id: product._id }, { $set: { stock: 0 } });
  let runs = 0;
  let recovered = 0;
  while (runs < 12 && recovered < 500) {
    const res = await runReconcile();
    recovered += res.body.stockReservationsRecovered;
    runs += 1;
  }
  assert.equal(recovered, 500);
  assert.ok(runs <= 12, "within one hour of 5-minute runs, got " + runs);
  assert.equal((await Product.findById(product._id).lean()).stock, 500);
  assert.equal(await Order.countDocuments({ _id: { $in: inserted.map((order) => order._id) }, "products.stockReserved": true }), 0);
});

test("the wall-clock budget stops a run before it starts new items", opts, async () => {
  const product = await createProduct({ stock: 0 });
  const user = await createUser();
  await Order.insertMany(Array.from({ length: 30 }, () => ({
    user: user._id,
    products: [{ product: product._id, quantity: 1, price: product.price, hasVariant: false, stockReserved: true }],
    totalAmount: product.price, paymentProvider: "zarinpal", paymentStatus: "failed", status: "failed",
  })));
  const start = Date.now();
  let calls = 0;
  zarinpalDeps.now = () => { calls += 1; return calls > 3 ? start + 10 * MINUTE : start; };
  const res = await runReconcile();
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.stockReservationsRecovered < 30, "budget exhausted: " + res.body.stockReservationsRecovered);
});

import test from "node:test";
import assert from "node:assert/strict";
import Coupon from "../models/coupon.model.js";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import User from "../models/user.model.js";
import { reconcilePendingZarinpalOrders, verifyZarinpalPayment } from "../controllers/zarinpal.controller.js";
import {
  callbackRequest, createCoupon, createProduct, createReservedOrder, createUser, fixtureResponse,
  jsonResponse, makeRes, mockProvider, testUri, useDatabase,
} from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };
const reasonOf = (res) => new URL(res.redirectedTo).searchParams.get("reason");
const pathOf = (res) => new URL(res.redirectedTo).pathname;
const callback = async (order, query) => {
  const res = makeRes();
  await verifyZarinpalPayment(callbackRequest(order, query), res);
  return res;
};
const stockOf = async (product) => (await Product.findById(product._id).lean()).stock;

test("verify error under errors.code -51 marks the order failed and releases stock and coupon", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const coupon = await createCoupon();
  const order = await createReservedOrder(product, { quantity: 2, coupon });
  mockProvider(() => fixtureResponse("verify-error-51"));

  const res = await callback(order);
  assert.equal(reasonOf(res), "payment-not-confirmed");
  const current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "failed");
  assert.equal(current.products[0].stockReserved, false);
  assert.equal(current.couponReservationStatus, "released");
  assert.equal(await stockOf(product), 5);
  assert.equal((await Coupon.findById(coupon._id).lean()).reservedCount, 0);
});

test("legacy data.code -54 is also read as definitively unpaid", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product);
  mockProvider(() => jsonResponse(200, { data: { code: -54 }, errors: [] }));
  assert.equal(reasonOf(await callback(order)), "payment-not-confirmed");
  assert.equal((await Order.findById(order._id).lean()).paymentStatus, "failed");
});

test("rate-limit, merchant, 5xx and timeouts never fail the order", opts, async () => {
  const product = await createProduct({ stock: 9 });
  const scenarios = [
    () => fixtureResponse("verify-error-12-rate-limit"),
    () => fixtureResponse("verify-error-11-merchant"),
    () => fixtureResponse("verify-http-500"),
    () => jsonResponse(404, { errors: { code: -12 } }),
    () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); },
    () => new Response("<html>bad gateway</html>", { status: 502 }),
  ];
  for (const scenario of scenarios) {
    const order = await createReservedOrder(product, { quantity: 1 });
    mockProvider(scenario);
    const res = await callback(order);
    assert.equal(reasonOf(res), "verification-pending");
    const current = await Order.findById(order._id).lean();
    assert.equal(current.paymentStatus, "pending");
    assert.equal(current.products[0].stockReserved, true, "stock must stay reserved");
  }
});

test("Status=NOK is a hint only: the provider is asked and decides", opts, async () => {
  const product = await createProduct({ stock: 9 });
  // NOK but the provider says it was paid: trust the provider, not the browser.
  const paidOrder = await createReservedOrder(product, { quantity: 1 });
  mockProvider(() => fixtureResponse("verify-success-100"));
  const paidRes = await callback(paidOrder, { Status: "NOK" });
  assert.equal(pathOf(paidRes), "/purchase-success");
  assert.equal((await Order.findById(paidOrder._id).lean()).paymentStatus, "paid");

  // NOK and the provider is unreachable: not a confirmed failure.
  const uncertain = await createReservedOrder(product, { quantity: 1 });
  const calls = mockProvider(() => fixtureResponse("verify-http-500"));
  assert.equal(reasonOf(await callback(uncertain, { Status: "NOK" })), "verification-pending");
  assert.equal(calls.length, 1, "verified exactly once");
  assert.equal((await Order.findById(uncertain._id).lean()).paymentStatus, "pending");

  // Cancelled at the gateway and the provider confirms: failed and released (cancelled payment).
  const cancelled = await createReservedOrder(product, { quantity: 1 });
  mockProvider(() => fixtureResponse("verify-error-51"));
  assert.equal(reasonOf(await callback(cancelled, { Status: "NOK" })), "payment-not-confirmed");
  const current = await Order.findById(cancelled._id).lean();
  assert.equal(current.paymentStatus, "failed");
  assert.equal(current.products[0].stockReserved, false);
});

test("verify 100 stores ref id, masked card and fee, redeems the coupon and clears the cart line", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const coupon = await createCoupon();
  const user = await createUser({ cartItems: [] });
  await User.updateOne({ _id: user._id }, { $push: { cartItems: { product: product._id, quantity: 2, size: "", color: "" } } });
  const order = await createReservedOrder(product, { user, quantity: 2, coupon });
  mockProvider(() => fixtureResponse("verify-success-100"));

  const res = await callback(order);
  assert.equal(pathOf(res), "/purchase-success");
  const current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "paid");
  assert.equal(current.zarinpalRefId, "201");
  assert.equal(current.zarinpalCardPan, "502229******5995");
  assert.equal(current.zarinpalFee, 0);
  assert.ok(current.finalizedAt);
  assert.equal(current.shipmentStatus, "processing");
  assert.equal(current.couponReservationStatus, "redeemed");
  const couponAfter = await Coupon.findById(coupon._id).lean();
  assert.deepEqual([couponAfter.reservedCount, couponAfter.usageCount], [0, 1]);
  assert.equal((await User.findById(user._id).lean()).cartItems.length, 0);
});

test("amount mismatch is never paid and never failed", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 1 });
  mockProvider(() => fixtureResponse("verify-error-50"));
  assert.equal(reasonOf(await callback(order)), "verification-pending");
  let current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "pending");
  assert.equal(current.needsManualReview, true);
  assert.equal(current.manualReviewReason, "amount_mismatch");
  assert.equal(current.products[0].stockReserved, true);

  const echoed = await createReservedOrder(product, { quantity: 1 });
  mockProvider(() => jsonResponse(200, { data: { code: 100, ref_id: 77, amount: 1 }, errors: [] }));
  await callback(echoed);
  current = await Order.findById(echoed._id).lean();
  assert.equal(current.paymentStatus, "pending");
  assert.equal(current.needsManualReview, true);
});

test("a replayed callback converges and finalizes exactly once", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 1 });
  mockProvider(() => fixtureResponse("verify-success-100"));
  await callback(order);
  const second = await callback(order);
  assert.equal(pathOf(second), "/purchase-success");
  const current = await Order.findById(order._id).lean();
  assert.equal(current.shipmentEvents.length, 1);
  assert.equal(await stockOf(product), 4, "stock is consumed once");
});

test("concurrent verify callbacks produce exactly one finalization", opts, async () => {
  const product = await createProduct({ stock: 20 });
  const coupon = await createCoupon();
  const order = await createReservedOrder(product, { quantity: 3, coupon });
  const calls = mockProvider(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return fixtureResponse("verify-success-100");
  });

  const results = await Promise.all(Array.from({ length: 12 }, () => callback(order)));
  assert.equal(calls.length, 12);
  for (const res of results) assert.equal(pathOf(res), "/purchase-success");
  const current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "paid");
  assert.equal(current.shipmentEvents.length, 1, "one shipment event means one finalization");
  assert.equal(current.couponReservationStatus, "redeemed");
  const couponAfter = await Coupon.findById(coupon._id).lean();
  assert.deepEqual([couponAfter.reservedCount, couponAfter.usageCount], [0, 1]);
  assert.equal(await stockOf(product), 17);
});

test("a failed order with an authority is re-verified: paid becomes paid_after_expiry and re-reserves stock", opts, async () => {
  const product = await createProduct({ stock: 5 });
  // The reconciler already released the stock for this expired order (stock is back at 5).
  const order = await createReservedOrder(product, { quantity: 2, paymentStatus: "expired", stockReserved: false });
  mockProvider(() => fixtureResponse("verify-success-100"));

  const res = await callback(order);
  assert.equal(reasonOf(res), "verification-pending", "never a definitive failure for a paid order");
  const current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "paid_after_expiry");
  assert.equal(current.status, "paid_after_expiry");
  assert.equal(current.needsManualReview, true);
  assert.equal(current.manualReviewReason, "paid_after_expiry_stock_rereserved");
  assert.equal(current.products[0].stockReserved, true);
  assert.equal(await stockOf(product), 3, "the 2 units are held again for the paid order");
});

test("paid_after_expiry without available stock is flagged, not shipped", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { quantity: 2, paymentStatus: "failed", stockReserved: false });
  await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
  mockProvider(() => fixtureResponse("verify-success-100"));
  await callback(order);
  const current = await Order.findById(order._id).lean();
  assert.equal(current.paymentStatus, "paid_after_expiry");
  assert.equal(current.manualReviewReason, "paid_after_expiry_stock_unavailable");
  assert.equal(current.products[0].stockReserved, false);
  assert.equal(await stockOf(product), 1, "failed re-reservation must not change stock");
  assert.equal(current.finalizedAt, null);
});

test("a failed order is only shown as a confirmed failure after a fresh unpaid verify", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const order = await createReservedOrder(product, { paymentStatus: "failed", stockReserved: false });

  mockProvider(() => fixtureResponse("verify-error-51"));
  assert.equal(reasonOf(await callback(order)), "payment-not-confirmed");

  const calls = mockProvider(() => fixtureResponse("verify-error-12-rate-limit"));
  assert.equal(reasonOf(await callback(order)), "verification-pending");
  assert.equal(calls.length, 1, "the provider is contacted for failed orders too");
  assert.equal((await Order.findById(order._id).lean()).paymentStatus, "failed");
});

test("process restart mid-finalization: reconcile finalizes a paid order with a reserved coupon", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const coupon = await createCoupon();
  const user = await createUser();
  await User.updateOne({ _id: user._id }, { $push: { cartItems: { product: product._id, quantity: 1, size: "", color: "" } } });
  // Crash right after the paid compare-and-set: coupon still reserved, cart untouched, no finalizedAt.
  const order = await createReservedOrder(product, { user, quantity: 1, coupon, paymentStatus: "paid" });
  mockProvider(() => { throw new Error("provider must not be called for paid orders"); });

  const run = async () => {
    const res = makeRes();
    await reconcilePendingZarinpalOrders({ headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
    return res;
  };
  const first = await run();
  assert.equal(first.body.success, true);
  assert.equal(first.body.paidOrdersFinalized, 1);
  let current = await Order.findById(order._id).lean();
  assert.ok(current.finalizedAt);
  assert.equal(current.couponReservationStatus, "redeemed");
  assert.equal((await User.findById(user._id).lean()).cartItems.length, 0);

  const second = await run();
  assert.equal(second.body.paidOrdersFinalized, 0, "nothing left to do");
  current = await Order.findById(order._id).lean();
  assert.equal(current.shipmentEvents.length, 1);
  assert.equal((await Coupon.findById(coupon._id).lean()).usageCount, 1);
});

test("a partially finalized order (coupon already redeemed) completes on reconcile", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const coupon = await createCoupon({ usageCount: 1 });
  const order = await createReservedOrder(product, { quantity: 1, paymentStatus: "paid", couponReservationStatus: "redeemed", coupon: null });
  await Order.updateOne({ _id: order._id }, { $set: { couponCode: coupon.code, couponReservationStatus: "redeemed" } });
  const res = makeRes();
  await reconcilePendingZarinpalOrders({ headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
  assert.equal(res.body.paidOrdersFinalized, 1);
  assert.ok((await Order.findById(order._id).lean()).finalizedAt);
  assert.equal((await Coupon.findById(coupon._id).lean()).usageCount, 1, "no second redemption");
});

test("finalization tolerates a deleted coupon and does not advance an admin-shipped order", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const coupon = await createCoupon();
  const order = await createReservedOrder(product, { quantity: 1, coupon, paymentStatus: "paid" });
  await Coupon.deleteOne({ _id: coupon._id });
  await Order.updateOne({ _id: order._id }, { $set: { shipmentStatus: "packed" } });
  const res = makeRes();
  await reconcilePendingZarinpalOrders({ headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
  assert.equal(res.body.failures, 0);
  const current = await Order.findById(order._id).lean();
  assert.ok(current.finalizedAt);
  assert.equal(current.couponReservationStatus, "redeemed");
  assert.equal(current.shipmentStatus, "packed", "late finalization must not rewind shipment status");
});

test("zarinpalRefId is unique among non-empty values; a duplicate is recorded without it and flagged", opts, async () => {
  const product = await createProduct({ stock: 9 });
  const first = await createReservedOrder(product, { quantity: 1 });
  const second = await createReservedOrder(product, { quantity: 1 });
  mockProvider(() => fixtureResponse("verify-success-100")); // ref_id 201 for both
  await callback(first);
  const res = await callback(second);
  assert.equal(pathOf(res), "/purchase-success", "the customer who paid is not punished");
  const current = await Order.findById(second._id).lean();
  assert.equal(current.paymentStatus, "paid");
  assert.equal(current.zarinpalRefId, undefined);
  assert.equal(current.needsManualReview, true);
  assert.equal(current.manualReviewReason, "duplicate_provider_ref_id");
});

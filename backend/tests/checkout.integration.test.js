import test from "node:test";
import assert from "node:assert/strict";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import User from "../models/user.model.js";
import { createZarinpalCheckout } from "../controllers/zarinpal.controller.js";
import {
  checkoutRequest, createProduct, createUser, fixtureResponse, jsonResponse, makeRes, mockProvider, testUri, useDatabase,
} from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };
let authoritySeq = 0;
const acceptingProvider = () => mockProvider(async (url) => {
  if (url.endsWith("/request.json")) {
    authoritySeq += 1;
    return jsonResponse(200, { data: { code: 100, message: "Success", authority: `A${String(authoritySeq).padStart(35, "0")}` }, errors: [] });
  }
  throw new Error("unexpected provider call " + url);
});

const userWithCart = async (lines) => {
  const user = await createUser();
  await User.updateOne({ _id: user._id }, { $set: { cartItems: lines } });
  return User.findById(user._id);
};
const checkout = async (user, extra) => {
  const res = makeRes();
  await createZarinpalCheckout(checkoutRequest(user, extra), res);
  return res;
};
const stockOf = async (product) => (await Product.findById(product._id).lean()).stock;

test("an accepted request returns the StartPay redirect and keeps the reservation", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const user = await userWithCart([{ product: product._id, quantity: 2, size: "", color: "" }]);
  acceptingProvider();
  const res = await checkout(user);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.redirectUrl, /^https:\/\/sandbox\.zarinpal\.com\/pg\/StartPay\/A/);
  assert.equal(await stockOf(product), 3);
});

test("provider rejection under errors.code releases stock; the same under legacy data.code too", opts, async () => {
  const product = await createProduct({ stock: 5 });
  for (const body of [
    { data: [], errors: { code: -9, message: "Validation error", validations: [] } },
    { data: { code: -12, message: "legacy shape" }, errors: [] },
  ]) {
    const user = await userWithCart([{ product: product._id, quantity: 1, size: "", color: "" }]);
    mockProvider(() => jsonResponse(200, body));
    const res = await checkout(user);
    assert.equal(res.statusCode, 502);
    assert.equal(await stockOf(product), 5, "rejected request releases the reservation");
    const order = await Order.findOne({ user: user._id }).lean();
    assert.equal(order.paymentStatus, "failed");
    assert.equal(order.paymentRequestStatus, "rejected");
  }
});

test("provider 5xx or timeout is ambiguous: 202, stock stays reserved", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const scenarios = [
    () => fixtureResponse("verify-http-500"),
    () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
  ];
  for (const scenario of scenarios) {
    const user = await userWithCart([{ product: product._id, quantity: 1, size: "", color: "" }]);
    mockProvider(scenario);
    const res = await checkout(user);
    assert.equal(res.statusCode, 202);
    const order = await Order.findOne({ user: user._id }).lean();
    assert.equal(order.paymentStatus, "pending");
    assert.equal(order.paymentRequestStatus, "unknown");
    assert.equal(order.products[0].stockReserved, true);
  }
  assert.equal(await stockOf(product), 3);
});

test("concurrent identical checkouts reserve stock once and create one order (BIZ-4)", opts, async () => {
  const product = await createProduct({ stock: 10 });
  const user = await userWithCart([{ product: product._id, quantity: 4, size: "", color: "" }]);
  const calls = acceptingProvider();
  const results = await Promise.all(Array.from({ length: 6 }, () => checkout(user)));
  assert.equal(await Order.countDocuments({ user: user._id }), 1, "exactly one pending order");
  assert.equal(await stockOf(product), 6, "units reserved once, not six times");
  assert.equal(calls.filter((call) => call.url.endsWith("/request.json")).length, 1, "one gateway session");
  for (const res of results) assert.ok([200, 202].includes(res.statusCode), "got " + res.statusCode);
  // Once the first one has an authority, a retry returns the same payment page.
  const again = await checkout(user);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.reused, true);
  assert.equal(await Order.countDocuments({ user: user._id }), 1);
});

test("a user cannot hold more than two pending orders with different carts", opts, async () => {
  const a = await createProduct({ stock: 10 });
  const b = await createProduct({ stock: 10 });
  const c = await createProduct({ stock: 10 });
  acceptingProvider();
  const user = await userWithCart([{ product: a._id, quantity: 1, size: "", color: "" }]);
  assert.equal((await checkout(user)).statusCode, 200);
  await User.updateOne({ _id: user._id }, { $set: { cartItems: [{ product: b._id, quantity: 1, size: "", color: "" }] } });
  assert.equal((await checkout(await User.findById(user._id))).statusCode, 200);
  await User.updateOne({ _id: user._id }, { $set: { cartItems: [{ product: c._id, quantity: 1, size: "", color: "" }] } });
  const third = await checkout(await User.findById(user._id));
  assert.equal(third.statusCode, 409);
  assert.equal(await stockOf(c), 10, "the refused checkout reserved nothing");
  assert.equal(await Order.countDocuments({ user: user._id }), 2);
});

test("concurrent checkouts with different carts never exceed the cap", opts, async () => {
  const products = await Promise.all(Array.from({ length: 5 }, () => createProduct({ stock: 10 })));
  const user = await createUser();
  acceptingProvider();
  const results = await Promise.all(products.map(async (product) => {
    const copy = await User.findById(user._id);
    copy.cartItems = [{ product: product._id, quantity: 1, size: "", color: "" }];
    return checkout(copy);
  }));
  assert.equal(await Order.countDocuments({ user: user._id, paymentStatus: "pending" }), 2);
  assert.equal(results.filter((res) => res.statusCode === 409).length, 3);
});

test("options on a product without variants are refused at checkout (BIZ-6)", opts, async () => {
  const product = await createProduct({ stock: 5 });
  const user = await userWithCart([{ product: product._id, quantity: 1, size: "M", color: "" }]);
  acceptingProvider();
  const res = await checkout(user);
  assert.equal(res.statusCode, 409);
  assert.equal(await Order.countDocuments({ user: user._id }), 0);
  assert.equal(await stockOf(product), 5);
});

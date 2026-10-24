import test from "node:test";
import assert from "node:assert/strict";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import User from "../models/user.model.js";
import { createZarinpalCheckout } from "../controllers/zarinpal.controller.js";
import {
  checkoutRequest, createCoupon, createProduct, createUser, jsonResponse, makeRes, mockProvider, testUri, useDatabase,
} from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };
let seq = 0;
const accepting = () => mockProvider(async (url, body) => {
  if (url.endsWith("/request.json")) {
    seq += 1;
    return jsonResponse(200, { data: { code: 100, message: "Success", authority: `W${String(seq).padStart(35, "0")}`, amount: body.amount }, errors: [] });
  }
  throw new Error("unexpected provider call " + url);
});
const buyerWithCart = async (lines, overrides = {}) => {
  const user = await createUser({ accountType: "wholesale", wholesaleProfile: { companyName: "قطعات پارس", discountPercent: 10 }, ...overrides });
  await User.updateOne({ _id: user._id }, { $set: { cartItems: lines } });
  return User.findById(user._id);
};
const checkout = async (user, extra) => {
  const res = makeRes();
  await createZarinpalCheckout(checkoutRequest(user, extra), res);
  return res;
};

test("wholesale buyers are charged their wholesale price from the minimum quantity", opts, async () => {
  const part = await createProduct({ price: 10_000, wholesalePrice: 8_000, wholesaleMinQuantity: 5, stock: 500 });
  const other = await createProduct({ price: 3_000, wholesalePrice: 2_000, wholesaleMinQuantity: 10, stock: 500 });
  const user = await buyerWithCart([
    { product: part._id, quantity: 150, size: "", color: "" },
    { product: other._id, quantity: 2, size: "", color: "" },
  ]);
  const calls = accepting();
  const res = await checkout(user);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const order = await Order.findOne({ user: user._id }).lean();
  assert.equal(order.pricingTier, "wholesale");
  const lines = new Map(order.products.map((line) => [String(line.product), line]));
  assert.equal(lines.get(String(part._id)).price, 7_200, "wholesale price minus 10% account discount");
  assert.equal(lines.get(String(part._id)).retailPrice, 10_000);
  assert.equal(lines.get(String(other._id)).price, 3_000, "below the minimum quantity the retail price applies");
  assert.equal(order.subtotalAmount, 150 * 7_200 + 2 * 3_000);
  const request = calls.find((call) => call.url.endsWith("/request.json"));
  assert.equal(request.body.amount, order.totalAmount * 10, "gateway amount (Rial) matches the server-side total");
  assert.equal((await Product.findById(part._id).lean()).stock, 350);
});

test("retail buyers keep retail prices and the 100-unit line cap", opts, async () => {
  const part = await createProduct({ price: 10_000, wholesalePrice: 8_000, stock: 500 });
  const retail = await createUser();
  await User.updateOne({ _id: retail._id }, { $set: { cartItems: [{ product: part._id, quantity: 101, size: "", color: "" }] } });
  const tooMany = await checkout(await User.findById(retail._id));
  assert.equal(tooMany.statusCode, 409);
  await User.updateOne({ _id: retail._id }, { $set: { cartItems: [{ product: part._id, quantity: 10, size: "", color: "" }] } });
  accepting();
  const ok = await checkout(await User.findById(retail._id));
  assert.equal(ok.statusCode, 200);
  const order = await Order.findOne({ user: retail._id }).lean();
  assert.equal(order.products[0].price, 10_000);
  assert.equal(order.pricingTier, "retail");
});

test("coupons do not stack on wholesale prices", opts, async () => {
  const part = await createProduct({ price: 10_000, wholesalePrice: 8_000, stock: 50 });
  const coupon = await createCoupon();
  const user = await buyerWithCart([{ product: part._id, quantity: 1, size: "", color: "" }]);
  const res = await checkout(user, { couponCode: coupon.code });
  assert.equal(res.statusCode, 400);
  assert.equal(await Order.countDocuments({ user: user._id }), 0);
});

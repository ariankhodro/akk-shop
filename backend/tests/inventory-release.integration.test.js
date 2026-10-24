import test from "node:test";
import assert from "node:assert/strict";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import { reconcilePendingZarinpalOrders, releaseReservedInventory } from "../controllers/zarinpal.controller.js";
import { createProduct, createUser, makeRes, testUri, trackOrder, useDatabase } from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };

const line = (product, overrides = {}) => ({
  product: product._id, quantity: 2, price: product.price, size: "", color: "", hasVariant: false, stockReserved: true, ...overrides,
});
const orderWith = async (products, overrides = {}) => {
  const user = await createUser();
  return trackOrder(await Order.create({
    user: user._id, products, totalAmount: 1000, paymentProvider: "zarinpal", paymentStatus: "failed", status: "failed", ...overrides,
  }));
};

test("a removed variant marks only its line releaseSkipped and the other lines still release", opts, async () => {
  const variantProduct = await createProduct({ variants: [{ size: "M", color: "Red", stock: 3 }] });
  const simple = await createProduct({ stock: 4 });
  const order = await orderWith([
    line(variantProduct, { size: "RENAMED", color: "Red", hasVariant: true }),
    line(simple),
  ]);
  await releaseReservedInventory(order.products, order._id);
  const current = await Order.findById(order._id).lean();
  assert.equal(current.products[0].releaseSkipped, true);
  assert.equal(current.products[0].stockReserved, false);
  assert.equal(current.products[1].releaseSkipped, false);
  assert.equal(current.products[1].stockReserved, false);
  assert.equal((await Product.findById(simple._id).lean()).stock, 6);
  assert.equal((await Product.findById(variantProduct._id).lean()).variants[0].stock, 3, "no stock invented for a missing target");
});

test("a non-variant line that carries size/color releases to the product stock (routing by hasVariant)", opts, async () => {
  const simple = await createProduct({ stock: 4 });
  const order = await orderWith([line(simple, { size: "M", color: "Red", hasVariant: false })]);
  await releaseReservedInventory(order.products, order._id);
  assert.equal((await Product.findById(simple._id).lean()).stock, 6);
  assert.equal((await Order.findById(order._id).lean()).products[0].releaseSkipped, false);
});

test("a product converted from variants to simple no longer wedges the reconciler", opts, async () => {
  const product = await createProduct({ variants: [{ size: "M", color: "", stock: 3 }] });
  const order = await orderWith([line(product, { size: "M", hasVariant: true })], { paymentStatus: "expired", status: "expired" });
  await Product.updateOne({ _id: product._id }, { $set: { variants: [], stock: 9 } });
  const res = makeRes();
  await reconcilePendingZarinpalOrders({ headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.failures, 0);
  assert.equal((await Order.findById(order._id).lean()).products[0].stockReserved, false);
});

test("a deleted product does not block release of the other lines", opts, async () => {
  const gone = await createProduct({ stock: 1 });
  const simple = await createProduct({ stock: 1 });
  const order = await orderWith([line(gone), line(simple)]);
  await Product.deleteOne({ _id: gone._id });
  await releaseReservedInventory(order.products, order._id);
  assert.equal((await Product.findById(simple._id).lean()).stock, 3);
});

import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import { releaseReservedInventory, reserveInventory } from "../controllers/zarinpal.controller.js";

const testUri = process.env.MONGO_TEST_URI || "";
const dbName = (() => {
  try { return new URL(testUri).pathname.replace(/^\//, "").split("?")[0]; }
  catch { return ""; }
})();
const safeTestDatabase = /(^|[_-])test($|[_-])/i.test(dbName);
if (testUri && !safeTestDatabase) {
  throw new Error("MONGO_TEST_URI must point to a dedicated disposable database whose name includes 'test'.");
}

let transactionSupport = false;
const createdProductIds = new Set();
const createdOrderIds = new Set();

before(async () => {
  if (!testUri) return;
  await mongoose.connect(testUri);
  const topology = mongoose.connection.getClient().topology?.description?.type || "";
  transactionSupport = /ReplicaSet|Sharded/.test(topology);
});

afterEach(async () => {
  if (!testUri || mongoose.connection.readyState !== 1) return;
  if (createdOrderIds.size) await Order.deleteMany({ _id: { $in: [...createdOrderIds] } });
  if (createdProductIds.size) await Product.deleteMany({ _id: { $in: [...createdProductIds] } });
  createdOrderIds.clear();
  createdProductIds.clear();
});

after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});

const createProduct = async ({ stock = 5, variants = [] } = {}) => {
  const product = await Product.create({
    name: "Integration test product",
    description: "Product fixture for inventory concurrency and recovery tests.",
    price: 1000,
    category: "test-category",
    stock: variants.length ? null : stock,
    variants,
    isActive: true,
  });
  createdProductIds.add(product._id);
  return product;
};

const createOrder = async (product, overrides = {}) => {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    products: [{
      product: product._id,
      quantity: 2,
      price: product.price,
      size: "",
      color: "",
      hasVariant: false,
      stockReserved: true,
    }],
    totalAmount: product.price * 2,
    paymentProvider: "zarinpal",
    paymentStatus: "pending",
    paymentRequestStatus: "accepted",
    status: "pending",
    ...overrides,
  });
  createdOrderIds.add(order._id);
  return order;
};

const productMap = (product) => new Map([[product._id.toString(), product.toObject()]]);

test("concurrent reservations never oversell tracked product stock", { skip: !testUri }, async () => {
  const product = await createProduct({ stock: 5 });
  const items = [{ product: product._id.toString(), quantity: 1, size: "", color: "" }];
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, () => reserveInventory(items, productMap(product)))
  );
  const successes = attempts.filter((item) => item.status === "fulfilled");
  const rejected = attempts.filter((item) => item.status === "rejected");

  assert.equal(successes.length, 5, "only the five available units should be reserved");
  assert.equal(rejected.length, 7, "excess concurrent requests should fail safely");
  const current = await Product.findById(product._id).lean();
  assert.equal(current.stock, 0);
});

test("reservation refuses a stale price snapshot without deducting stock", { skip: !testUri }, async () => {
  const product = await createProduct({ stock: 5 });
  const staleSnapshot = productMap(product);
  await Product.updateOne({ _id: product._id }, { $set: { price: 1500 } });

  await assert.rejects(
    reserveInventory(
      [{ product: product._id.toString(), quantity: 1, size: "", color: "" }],
      staleSnapshot
    ),
    /INSUFFICIENT_STOCK/
  );

  const current = await Product.findById(product._id).lean();
  assert.equal(current.price, 1500);
  assert.equal(current.stock, 5, "stale-price checkout must not reserve any units");
});

test("partial multi-product reservation failure restores earlier stock", { skip: !testUri }, async () => {
  const first = await createProduct({ stock: 4 });
  const second = await createProduct({ stock: 0 });
  const products = new Map([
    [first._id.toString(), first.toObject()],
    [second._id.toString(), second.toObject()],
  ]);
  await assert.rejects(
    reserveInventory([
      { product: first._id.toString(), quantity: 2 },
      { product: second._id.toString(), quantity: 1 },
    ], products),
    /INSUFFICIENT_STOCK/
  );

  const [firstAfter, secondAfter] = await Promise.all([
    Product.findById(first._id).lean(),
    Product.findById(second._id).lean(),
  ]);
  assert.equal(firstAfter.stock, 4, "the first reservation must be rolled back");
  assert.equal(secondAfter.stock, 0);
});

test("duplicate concurrent inventory-release attempts restore stock exactly once", { skip: !testUri }, async (t) => {
  if (!transactionSupport) {
    t.skip("Requires a MongoDB replica set or sharded cluster; standalone fallback is not atomic.");
    return;
  }
  const product = await createProduct({ stock: 4 });
  const order = await createOrder(product);
  await Promise.all([
    releaseReservedInventory(order.products, order._id),
    releaseReservedInventory(order.products, order._id),
  ]);
  const [currentProduct, currentOrder] = await Promise.all([
    Product.findById(product._id).lean(),
    Order.findById(order._id).lean(),
  ]);
  assert.equal(currentProduct.stock, 6, "two release attempts must add the quantity only once");
  assert.equal(currentOrder.products[0].stockReserved, false);
});

test("a failed transaction keeps the stock and reservation recoverable", { skip: !testUri }, async (t) => {
  if (!transactionSupport) {
    t.skip("Requires a MongoDB replica set or sharded cluster.");
    return;
  }
  const product = await createProduct({ variants: [{ size: "M", color: "Red", stock: 7 }] });
  const order = await createOrder(product, {
    products: [{
      product: product._id,
      quantity: 2,
      price: product.price,
      size: "MISSING",
      color: "Red",
      hasVariant: true,
      stockReserved: true,
    }],
  });

  await assert.rejects(releaseReservedInventory(order.products, order._id), /RESERVED_INVENTORY_TARGET_NOT_FOUND/);
  const [currentProduct, currentOrder] = await Promise.all([
    Product.findById(product._id).lean(),
    Order.findById(order._id).lean(),
  ]);
  assert.equal(currentProduct.variants[0].stock, 7, "transaction should roll back all stock changes");
  assert.equal(currentOrder.products[0].stockReserved, true, "reservation should remain recoverable");
});


test("unknown product stock is rejected instead of treated as unlimited inventory", { skip: !testUri }, async () => {
  const product = await createProduct({ stock: null });
  await assert.rejects(
    reserveInventory([{ product: product._id.toString(), quantity: 1 }], productMap(product)),
    /UNTRACKED_INVENTORY/
  );
  const current = await Product.findById(product._id).lean();
  assert.equal(current.stock, null);
});

test("transaction-scoped reservations roll back when order creation fails", { skip: !testUri }, async (t) => {
  if (!transactionSupport) {
    t.skip("Requires a MongoDB replica set or sharded cluster.");
    return;
  }
  const product = await createProduct({ stock: 5 });
  const session = await mongoose.startSession();
  try {
    await assert.rejects(
      session.withTransaction(async () => {
        await reserveInventory(
          [{ product: product._id.toString(), quantity: 2 }],
          productMap(product),
          { session }
        );
        throw new Error("SIMULATED_ORDER_PERSISTENCE_FAILURE");
      }),
      /SIMULATED_ORDER_PERSISTENCE_FAILURE/
    );
  } finally {
    await session.endSession();
  }
  const current = await Product.findById(product._id).lean();
  assert.equal(current.stock, 5, "aborted transaction must restore the original stock");
});

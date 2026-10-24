import test from "node:test";
import assert from "node:assert/strict";
import Order from "../models/order.model.js";
import ServiceCase from "../models/service-case.model.js";
import { createServiceCase } from "../controllers/service-case.controller.js";
import { createProduct, createReservedOrder, createUser, makeRes, testUri, trackCase, useDatabase } from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };

const paidOrder = async (quantity = 3) => {
  const user = await createUser();
  const product = await createProduct({ stock: 50, price: 1000 });
  const order = await createReservedOrder(product, { user, quantity, paymentStatus: "paid", stockReserved: false });
  return { user, order };
};
const submit = async (user, order, type = "refund") => {
  const res = makeRes();
  await createServiceCase({ user, body: { type, subject: "Refund please", message: "I want my money back", orderId: String(order._id) } }, res);
  if (res.body?.serviceCase) trackCase(res.body.serviceCase);
  return res;
};

test("the refund index is a partial unique index over active cases", opts, async () => {
  const indexes = await ServiceCase.collection.indexes();
  const index = indexes.find((entry) => entry.unique && entry.key.order === 1 && entry.key.type === 1);
  assert.ok(index, "unique {order,type} index exists");
  assert.ok(index.partialFilterExpression);
});

test("concurrent refund requests create exactly one active case", opts, async () => {
  const { user, order } = await paidOrder();
  const results = await Promise.all(Array.from({ length: 6 }, () => submit(user, order)));
  assert.equal(results.filter((res) => res.statusCode === 201).length, 1);
  assert.equal(results.filter((res) => res.statusCode === 409).length, 5);
  assert.equal(await ServiceCase.countDocuments({ order: order._id, type: "refund" }), 1);
});

test("a fully refunded order cannot be refunded again after the first case is resolved", opts, async () => {
  const { user, order } = await paidOrder();
  const first = await submit(user, order);
  assert.equal(first.body.serviceCase.refundAmount, 3000);
  const doc = await ServiceCase.findById(first.body.serviceCase._id);
  doc.refundStatus = "approved";
  await doc.save();
  doc.refundStatus = "processed";
  doc.refundReference = "TX-1";
  doc.status = "resolved";
  await doc.save();

  const second = await submit(user, order);
  assert.equal(second.statusCode, 409);
  assert.match(second.body.message, /fully refunded/);
});

test("a partial refund leaves only the remainder requestable, and approval cannot exceed the total", opts, async () => {
  const { user, order } = await paidOrder();
  const first = await submit(user, order);
  const doc = await ServiceCase.findById(first.body.serviceCase._id);
  doc.refundAmount = 1000;
  doc.refundStatus = "approved";
  await doc.save();
  doc.refundStatus = "processed";
  doc.status = "resolved";
  await doc.save();

  const second = await submit(user, order);
  assert.equal(second.statusCode, 201);
  assert.equal(second.body.serviceCase.refundAmount, 2000);

  const doc2 = await ServiceCase.findById(second.body.serviceCase._id);
  doc2.refundAmount = 2500; // 1000 already refunded + 2500 > 3000
  doc2.refundStatus = "approved";
  await assert.rejects(doc2.save(), /REFUND_EXCEEDS_ORDER_TOTAL/);
  doc2.refundAmount = 2000;
  await doc2.save();
  assert.equal((await Order.findById(order._id).lean()).totalAmount, 3000);
});

test("a rejected refund frees the order for a new request", opts, async () => {
  const { user, order } = await paidOrder();
  const first = await submit(user, order);
  await ServiceCase.updateOne({ _id: first.body.serviceCase._id }, { $set: { status: "rejected", refundStatus: "rejected" } });
  const second = await submit(user, order);
  assert.equal(second.statusCode, 201);
  assert.equal(second.body.serviceCase.refundAmount, 3000);
});

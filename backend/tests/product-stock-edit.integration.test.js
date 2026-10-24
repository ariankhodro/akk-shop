import test from "node:test";
import assert from "node:assert/strict";
import Product from "../models/product.model.js";
import { reserveInventory } from "../controllers/zarinpal.controller.js";
import { updateProduct, updateProductStock, updateProductVariantStock } from "../controllers/product.controller.js";
import { createProduct, makeRes, testUri, useDatabase } from "./helpers/payment-harness.js";

useDatabase();
const opts = { skip: !testUri };

const adminForm = (product, overrides = {}) => ({
  user: { _id: product._id, name: "Admin", role: "admin" },
  params: { id: String(product._id) },
  body: {
    name: product.name,
    description: "Edited description",
    category: product.category,
    price: product.price,
    stock: product.stock,
    ...overrides,
  },
});
const edit = async (product, overrides) => {
  const res = makeRes();
  await updateProduct(adminForm(product, overrides), res);
  return res;
};
const reserve = (product, quantity = 1, extra = {}) => {
  const lean = product.toObject();
  return reserveInventory([{ product: String(product._id), quantity, ...extra }], new Map([[String(product._id), lean]]));
};

test("an unchanged-stock admin edit racing with reservations never erases them", opts, async () => {
  const product = await createProduct({ stock: 10 });
  const reservations = Array.from({ length: 6 }, () => reserve(product, 1).catch((error) => error));
  const edits = Array.from({ length: 4 }, (_, index) => edit(product, { description: "Edited " + index, stockBaseline: 10 }));
  const [reserved, responses] = [await Promise.all(reservations), await Promise.all(edits)];
  const succeeded = reserved.filter((result) => !(result instanceof Error)).length;
  for (const res of responses) assert.ok([200, 409].includes(res.statusCode), "status " + res.statusCode);
  assert.ok(responses.some((res) => res.statusCode === 200));
  const current = await Product.findById(product._id).lean();
  assert.equal(succeeded, 6);
  assert.equal(current.stock, 10 - succeeded, "reservations survive the edits");
  assert.match(current.description, /^Edited/);
});

test("without a baseline an unchanged value is a no-op against the live value read for the request", opts, async () => {
  const product = await createProduct({ stock: 10 });
  const res = await edit(product, { stock: 10 });
  assert.equal(res.statusCode, 200);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});

test("a stale form (explicit stockBaseline) applies only the admin's own change", opts, async () => {
  const product = await createProduct({ stock: 10 });
  await reserve(product, 3); // stock is now 7 while the admin's form still shows 10
  const res = await edit(product, { stock: 10, stockBaseline: 10 });
  assert.equal(res.statusCode, 200);
  assert.equal((await Product.findById(product._id).lean()).stock, 7, "unchanged field must not overwrite live stock");

  const raised = await edit(product, { stock: 15, stockBaseline: 10 });
  assert.equal(raised.statusCode, 200);
  assert.equal((await Product.findById(product._id).lean()).stock, 12, "+5 delta on top of live stock");
});

test("lowering stock below what is already reserved is refused", opts, async () => {
  const product = await createProduct({ stock: 10 });
  await reserve(product, 8); // 2 left
  const res = await edit(product, { stock: 0, stockBaseline: 10 });
  assert.equal(res.statusCode, 409);
  assert.equal((await Product.findById(product._id).lean()).stock, 2);
});

test("variant edits keep live stock for retained variants and add new ones", opts, async () => {
  const product = await createProduct({ variants: [{ size: "M", color: "", stock: 10 }] });
  await reserve(product, 4, { size: "M", color: "" });
  const res = await edit(product, {
    stock: undefined,
    sizes: ["M", "L"],
    variants: [
      { size: "M", color: "", stock: 10, stockBaseline: 10 },
      { size: "L", color: "", stock: 5 },
    ],
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const current = await Product.findById(product._id).lean();
  assert.deepEqual(current.variants.map((variant) => [variant.size, variant.stock]), [["M", 6], ["L", 5]]);
  assert.equal(current.stock, null);
});

test("concurrent reserve during a variant edit is preserved", opts, async () => {
  const product = await createProduct({ variants: [{ size: "M", color: "", stock: 20 }] });
  const form = { stock: undefined, sizes: ["M"], variants: [{ size: "M", color: "", stock: 20, stockBaseline: 20 }] };
  const results = await Promise.all([
    ...Array.from({ length: 8 }, () => reserve(product, 1, { size: "M", color: "" })),
    edit(product, { ...form, description: "A" }),
    edit(product, { ...form, description: "B" }),
  ]);
  const current = await Product.findById(product._id).lean();
  assert.equal(current.variants[0].stock, 12);
  assert.ok(results.slice(-2).some((res) => res.statusCode === 200));
});

test("the quick stock endpoints apply deltas and refuse to go below reserved units", opts, async () => {
  const product = await createProduct({ stock: 10, variants: [] });
  await reserve(product, 3); // live 7
  let res = makeRes();
  await updateProductStock({ user: {}, params: { id: String(product._id) }, body: { stock: 12, expectedStock: 10 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stock, 9);

  res = makeRes();
  await updateProductStock({ user: {}, params: { id: String(product._id) }, body: { stock: 0, expectedStock: 20 } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal((await Product.findById(product._id).lean()).stock, 9);

  const variantProduct = await createProduct({ variants: [{ size: "S", color: "", stock: 10 }] });
  await reserve(variantProduct, 3, { size: "S", color: "" });
  res = makeRes();
  await updateProductVariantStock({ user: {}, params: { id: String(variantProduct._id) }, body: { size: "S", color: "", stock: 12, expectedStock: 10 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal((await Product.findById(variantProduct._id).lean()).variants[0].stock, 9);
});

test("a reservation landing between the admin's read and write is not lost (conditional write retries)", opts, async (t) => {
  const product = await createProduct({ stock: 10 });
  const original = Product.findOneAndUpdate.bind(Product);
  let interjected = false;
  t.mock.method(Product, "findOneAndUpdate", async (...args) => {
    if (!interjected) {
      interjected = true;
      await Product.updateOne({ _id: product._id }, { $inc: { stock: -3 } }); // customer reserves 3
    }
    return original(...args);
  });
  const res = await edit(product, { stock: 10, description: "Changed during a reservation" });
  t.mock.restoreAll();
  assert.equal(res.statusCode, 200);
  const current = await Product.findById(product._id).lean();
  assert.equal(current.stock, 7);
  assert.equal(current.description, "Changed during a reservation");
});

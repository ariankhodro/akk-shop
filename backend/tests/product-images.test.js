import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import cloudinary from "../lib/cloudinary.js";
import Product from "../models/product.model.js";
import AuditLog from "../models/audit-log.model.js";
import { createProduct, deleteProduct, updateProduct } from "../controllers/product.controller.js";
import { resolveManagedImageList, ImageUploadError } from "../lib/image-upload.js";

const CLOUD = "democloud";
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCkAAAAAASUVORK5CYII=";
const managed = (id, folder = "products", ext = ".png") =>
  "https://res.cloudinary.com/" + CLOUD + "/image/upload/v1700000000/" + folder + "/" + id + ext;

const saved = {};
let uploads;
let destroyed;
let created;
let failCreateWith;

const stub = (target, name, value) => {
  saved[target.constructor?.name + ":" + name + ":" + Math.random()] = [target, name, target[name]];
  target[name] = value;
};

beforeEach(() => {
  process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  uploads = [];
  destroyed = [];
  created = [];
  failCreateWith = null;
  stub(cloudinary.uploader, "upload", async (value, options) => {
    uploads.push({ value, options });
    return { secure_url: managed("uploaded" + uploads.length, options.folder) };
  });
  stub(cloudinary.uploader, "destroy", async (publicId) => {
    destroyed.push(publicId);
    return { result: "ok" };
  });
  stub(AuditLog, "create", async () => ({}));
  stub(Product, "create", async (doc) => {
    if (failCreateWith) throw failCreateWith;
    created.push(doc);
    return { _id: "64f123456789abcdef123456", isFeatured: false, isActive: true, ...doc };
  });
  stub(Product, "find", () => {
    const chain = { sort: () => chain, limit: () => chain, maxTimeMS: () => chain, lean: async () => [] };
    return chain;
  });
});

afterEach(() => {
  for (const [target, name, original] of Object.values(saved)) target[name] = original;
  for (const key of Object.keys(saved)) delete saved[key];
});

const makeRes = () => ({
  statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});

const validBody = (extra = {}) => ({
  name: "Shirt", description: "Cotton shirt", price: 1000, category: "shirts", stock: 3, ...extra,
});
const request = (body, params = {}) => ({ body, params, user: { _id: "u1", name: "Admin" }, get: () => "", ip: "127.0.0.1", method: "POST", path: "/" });

test("create rejects local paths, remote schemes, SVG and foreign hosts without touching storage", async () => {
  const unsafe = [
    "/etc/hostname",
    "C:\\Windows\\win.ini",
    "http://127.0.0.1/x.png",
    "ftp://example.com/x.png",
    "s3://bucket/key.png",
    "gs://bucket/key.png",
    "file:///etc/passwd",
    "//evil.example/x.png",
    "https://evil.example/tracking.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PGgxPng8L2gxPg==",
    managed("abc", "categories"),
    managed("abc", "products", ".svg"),
    "https://res.cloudinary.com/othercloud/image/upload/products/abc.png",
    "https://res.cloudinary.com/" + CLOUD + "/image/upload/products/../secrets/abc.png",
  ];
  for (const value of unsafe) {
    for (const body of [validBody({ images: [value] }), validBody({ image: value })]) {
      const res = makeRes();
      await createProduct(request(body), res);
      assert.equal(res.statusCode, 400, value);
    }
  }
  assert.equal(uploads.length, 0);
  assert.equal(created.length, 0);
  assert.equal(destroyed.length, 0);
});

test("create uploads validated data URLs into the products folder and keeps managed HTTPS URLs", async () => {
  const existing = managed("already");
  const res = makeRes();
  await createProduct(request(validBody({ images: [tinyPng, existing, existing] })), res);
  assert.equal(res.statusCode, 201);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options.folder, "products");
  assert.deepEqual(created[0].images, [managed("uploaded1"), existing]);
  assert.equal(created[0].image, managed("uploaded1"));
});

test("create removes uploaded assets when persistence fails, and answers 400 for schema errors", async () => {
  failCreateWith = Object.assign(new Error("invalid"), { name: "ValidationError" });
  const res = makeRes();
  await createProduct(request(validBody({ images: [tinyPng] })), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(destroyed, ["products/uploaded1"]);
});

test("create removes earlier uploads when a later image is rejected", async () => {
  const res = makeRes();
  await createProduct(request(validBody({ images: [tinyPng, "/etc/passwd"] })), res);
  assert.equal(res.statusCode, 400);
  assert.equal(created.length, 0);
  assert.deepEqual(destroyed, ["products/uploaded1"]);
});

test("create enforces the 8 image cap and non-string entries", async () => {
  const tooMany = Array.from({ length: 9 }, (_, index) => managed("m" + index));
  const res = makeRes();
  await createProduct(request(validBody({ images: tooMany })), res);
  assert.equal(res.statusCode, 400);
  const res2 = makeRes();
  await createProduct(request(validBody({ images: [{ url: "x" }] })), res2);
  assert.equal(res2.statusCode, 400);
  const res3 = makeRes();
  await createProduct(request(validBody({ images: "https://res.cloudinary.com/x" })), res3);
  assert.equal(res3.statusCode, 400);
});

const makeStoredProduct = (images, overrides = {}) => {
  const product = {
    _id: "64f123456789abcdef123456",
    name: "Shirt", description: "Cotton shirt", price: 1000, category: "shirts", categoryId: null,
    image: images[0] || "", images: [...images], attributes: {}, sizes: [], colors: [], variants: [],
    fit: { type: "regular" }, sizeChart: [], stock: 3, isFeatured: false, isActive: true,
    saveCalls: 0, saveError: null,
    async save() { if (this.saveError) throw this.saveError; this.saveCalls += 1; },
    ...overrides,
  };
  product.toObject = () => ({ ...product, variants: [...product.variants] });
  stub(Product, "findById", async () => product);
  // updateProduct now writes through a conditional findOneAndUpdate (stock deltas, BIZ-5)
  // instead of document.save(); the stub applies the $set to the in-memory product.
  stub(Product, "findOneAndUpdate", async (_filter, update) => {
    if (product.saveError) throw product.saveError;
    product.saveCalls += 1;
    Object.assign(product, update.$set);
    return product;
  });
  return product;
};

test("update keeps already-stored URLs (including legacy ones) but rejects new unmanaged references", async () => {
  const kept = managed("kept");
  const removed = managed("removed");
  const legacy = "https://legacy.example/old.jpg";
  const product = makeStoredProduct([legacy, kept, removed]);

  const bad = makeRes();
  await updateProduct(request(validBody({ images: [legacy, kept, "/etc/hostname"] }), { id: product._id }), bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(product.saveCalls, 0);
  assert.equal(destroyed.length, 0);

  const alsoBad = makeRes();
  await updateProduct(request(validBody({ images: ["https://legacy.example/other.jpg"] }), { id: product._id }), alsoBad);
  assert.equal(alsoBad.statusCode, 400);

  const ok = makeRes();
  await updateProduct(request(validBody({ images: [legacy, kept, tinyPng] }), { id: product._id }), ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(product.images, [legacy, kept, managed("uploaded1")]);
  assert.equal(product.image, legacy);
  // Only the managed asset that was dropped is destroyed; the foreign URL is never touched.
  assert.deepEqual(destroyed, ["products/removed"]);
});

test("update without image fields leaves the gallery intact", async () => {
  const product = makeStoredProduct([managed("a"), managed("b")]);
  const res = makeRes();
  await updateProduct(request(validBody(), { id: product._id }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(product.images, [managed("a"), managed("b")]);
  assert.equal(destroyed.length, 0);
});

test("update removes freshly uploaded assets if the save fails and keeps the old ones", async () => {
  const product = makeStoredProduct([managed("a")], { saveError: new Error("db down") });
  const res = makeRes();
  await updateProduct(request(validBody({ images: [tinyPng] }), { id: product._id }), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(destroyed, ["products/uploaded1"]);
});

test("delete removes every managed image (including dotted ids) and ignores foreign URLs", async () => {
  const product = makeStoredProduct(
    [managed("one"), managed("two.v2"), "https://elsewhere.example/products/victim.jpg", "/jeans.jpg"],
    { isActive: false }
  );
  stub(Product, "findByIdAndDelete", async () => product);
  const res = makeRes();
  await deleteProduct(request({}, { id: product._id }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(destroyed.sort(), ["products/one", "products/two.v2"].sort());
});

test("resolveManagedImageList accepts only products-folder assets with image extensions", async () => {
  const options = { folder: "products", cloudName: CLOUD, uploader: { async upload() { throw new Error("no"); } } };
  assert.deepEqual((await resolveManagedImageList([managed("ok", "products", ".webp"), managed("noext", "products", "")], options)).urls,
    [managed("ok", "products", ".webp"), managed("noext", "products", "")]);
  for (const value of [managed("x", "products", ".svg"), managed("x", "products", ".html"), "https://res.cloudinary.com/" + CLOUD + "/image/upload/c_scale,w_10/products/x.png"]) {
    await assert.rejects(resolveManagedImageList([value], options), ImageUploadError, value);
  }
});

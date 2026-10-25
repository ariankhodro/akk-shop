import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { assertDisposableDatabase, startApp, testSecrets, withDatabase, withRedisDb } from "./helpers/http-app.js";

const mongoUri = process.env.MONGO_TEST_URI ? withDatabase(process.env.MONGO_TEST_URI, "wholesale_integration_test") : "";
const redisUrl = process.env.REDIS_TEST_URL ? withRedisDb(process.env.REDIS_TEST_URL, 5) : "";
const enabled = Boolean(mongoUri && redisUrl);
assertDisposableDatabase(process.env.MONGO_TEST_URI || "");

let server; let User; let Product; let AuditLog; let redis; let tokens;
const STRONG = "Zq!7vK-Lm2#Rt9xW";
const STRONG2 = "Pv@4nR-Tc8!Lq3sY";

before(async () => {
  if (!enabled) return;
  Object.assign(process.env, testSecrets, {
    REDIS_URL: redisUrl, NODE_ENV: "test", RATE_LIMIT_KEY_SALT: "integration-test-salt-0123456789",
    CLIENT_URL: "https://shop.example.ir", ALLOW_INSECURE_COOKIES: "true", BCRYPT_COST: "10",
  });
  await mongoose.connect(mongoUri);
  ({ default: User } = await import("../models/user.model.js"));
  ({ default: Product } = await import("../models/product.model.js"));
  ({ default: AuditLog } = await import("../models/audit-log.model.js"));
  ({ redis } = await import("../lib/redis.js"));
  if (redis.status !== "ready") await new Promise((resolve) => redis.once("ready", resolve));
  tokens = await import("../lib/auth-tokens.js");
  const { default: expressApp } = await import("../app.js");
  server = await startApp(expressApp);
  await Product.init();
});

after(async () => {
  if (!enabled) return;
  await server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  if (!enabled) return;
  await Promise.all([User.deleteMany({}), Product.deleteMany({}), AuditLog.deleteMany({})]);
  await redis.flushdb();
});

const opts = { skip: enabled ? false : "MONGO_TEST_URI and REDIS_TEST_URL are required" };
const mkUser = (overrides = {}) => User.create({ name: "Test User", email: `u${Math.random().toString(16).slice(2)}@example.com`, password: STRONG, ...overrides });
const cookiesFor = (user) => ({ accessToken: tokens.signAccessToken(user) });
const mkPart = (overrides = {}) => Product.create({
  name: "لنت ترمز جلو تیگو ۵", description: "لنت ترمز جلو اصلی", price: 1_000_000, wholesalePrice: 700_000, wholesaleMinQuantity: 3,
  category: "brakes", stock: 50, sku: "T21-3501080", oemNumbers: ["T21-3501080BA"], brand: "Chery", quality: "genuine",
  fitments: [{ make: "چری", model: "تیگو ۵", yearFrom: 2015, yearTo: 2022 }], isActive: true, ...overrides,
});

test("wholesale prices never appear in public responses for anonymous or retail viewers", opts, async () => {
  const part = await mkPart();
  const retail = await mkUser();
  for (const client of [server.client(), server.client({ cookies: cookiesFor(retail) })]) {
    for (const path of [`/api/products/${part._id}`, "/api/products/search?q=T213501080", "/api/products/newest", "/api/products/category/brakes", "/api/products/lookup?codes=T21-3501080BA"]) {
      const response = await client.get(path);
      assert.equal(response.status, 200, path);
      assert.doesNotMatch(response.text, /wholesale|700000/i, path + " leaks wholesale data");
    }
  }
});

test("wholesale customers see their own unit price, and personalised responses are private", opts, async () => {
  const part = await mkPart();
  const buyer = await mkUser({ accountType: "wholesale", wholesaleProfile: { companyName: "لوازم یدکی نمونه", discountPercent: 10 } });
  const client = server.client({ cookies: cookiesFor(buyer) });
  const response = await client.get(`/api/products/${part._id}`);
  assert.equal(response.status, 200);
  assert.equal(response.json.price, 1_000_000);
  assert.equal(response.json.wholesaleUnitPrice, 630_000);
  assert.equal(response.json.wholesaleMinQuantity, 3);
  assert.equal(response.json.wholesalePrice, undefined);
  assert.match(response.headers.get("cache-control") || "", /private/);
  const lookup = await client.get("/api/products/lookup?codes=t21 3501080");
  assert.equal(lookup.json.results[0].product.wholesaleUnitPrice, 630_000);
});

test("search matches part numbers with or without separators and filters by vehicle", opts, async () => {
  await mkPart();
  await mkPart({ sku: "J-100", oemNumbers: [], name: "فیلتر روغن جک", fitments: [{ make: "جک", model: "J5" }] });
  const client = server.client();
  assert.equal((await client.get("/api/products/search?q=t213501080ba")).json.products.length, 1);
  assert.equal((await client.get("/api/products/search?make=" + encodeURIComponent("جک"))).json.products[0].sku, "J-100");
  assert.equal((await client.get("/api/products/search?make=" + encodeURIComponent("چری") + "&year=2010")).json.products.length, 0);
  const vehicles = await client.get("/api/products/vehicles");
  assert.deepEqual(vehicles.json.makes.map((entry) => entry.make).sort(), ["جک", "چری"].sort());
});

test("public signup can never create a wholesale or admin account", opts, async () => {
  const response = await server.client().post("/api/auth/signup", {
    name: "Mallory", email: "mallory@example.com", password: STRONG,
    accountType: "wholesale", role: "admin", wholesaleProfile: { discountPercent: 50 },
  });
  assert.equal(response.status, 201);
  const user = await User.findOne({ email: "mallory@example.com" }).lean();
  assert.equal(user.accountType, "retail");
  assert.equal(user.role, "customer");
  assert.equal(user.wholesaleProfile, undefined);
});

test("creating wholesale accounts requires wholesale.manage and never touches administrators", opts, async () => {
  const support = await mkUser({ role: "admin", permissions: ["customers.manage"] });
  const sales = await mkUser({ role: "admin", permissions: ["customers.manage", "wholesale.manage"] });
  const otherAdmin = await mkUser({ role: "admin", permissions: ["catalogue.manage"] });
  const payload = { name: "فروشگاه همکار", email: "partner@example.com", password: STRONG, wholesaleProfile: { companyName: "قطعات پارس", discountPercent: 5 } };

  assert.equal((await server.client({ cookies: cookiesFor(support) }).post("/api/admin/customers", payload)).status, 403);
  const client = server.client({ cookies: cookiesFor(sales) });
  const created = await client.post("/api/admin/customers", payload);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.customer.accountType, "wholesale");
  assert.equal(created.json.customer.mustChangePassword, true);
  assert.equal(created.json.customer.password, undefined);
  assert.equal((await client.post("/api/admin/customers", { ...payload, role: "admin" })).status, 409, "duplicate email");
  const stored = await User.findOne({ email: "partner@example.com" }).lean();
  assert.equal(stored.role, "customer");

  // Admin targets are invisible to these endpoints.
  assert.equal((await client.post(`/api/admin/customers/${otherAdmin._id}/password`, { password: STRONG2 })).status, 404);
  assert.equal((await client.patch(`/api/admin/customers/${otherAdmin._id}/wholesale`, { accountType: "wholesale", wholesaleProfile: { companyName: "x" } })).status, 404);
  assert.ok(await AuditLog.exists({ action: "customer.account_created" }));
});

test("changing wholesale terms revokes the customer's existing sessions", opts, async () => {
  const sales = await mkUser({ role: "admin", permissions: ["wholesale.manage"] });
  const buyer = await mkUser({ accountType: "wholesale", wholesaleProfile: { companyName: "قطعات پارس", discountPercent: 5 } });
  const buyerClient = server.client({ cookies: cookiesFor(buyer) });
  assert.equal((await buyerClient.get("/api/auth/profile")).status, 200);
  const update = await server.client({ cookies: cookiesFor(sales) }).patch(`/api/admin/customers/${buyer._id}/wholesale`, { wholesaleProfile: { discountPercent: 12.5 } });
  assert.equal(update.status, 200, update.text);
  assert.equal(update.json.customer.wholesaleProfile.discountPercent, 12.5);
  assert.equal((await buyerClient.get("/api/auth/profile")).status, 401);
  const bad = await server.client({ cookies: cookiesFor(sales) }).patch(`/api/admin/customers/${buyer._id}/wholesale`, { wholesaleProfile: { discountPercent: 90 } });
  assert.equal(bad.status, 400);
});

test("temporary passwords must be changed and the change keeps only the current session", opts, async () => {
  const sales = await mkUser({ role: "admin", permissions: ["wholesale.manage"] });
  const buyer = await mkUser({ accountType: "wholesale", wholesaleProfile: { companyName: "قطعات پارس" } });
  const set = await server.client({ cookies: cookiesFor(sales) }).post(`/api/admin/customers/${buyer._id}/password`, { password: STRONG2 });
  assert.equal(set.status, 200, set.text);
  const client = server.client();
  const login = await client.post("/api/auth/login", { email: buyer.email, password: STRONG2 });
  assert.equal(login.status, 200);
  assert.equal(login.json.mustChangePassword, true);
  assert.equal(login.json.accountType, "wholesale");
  assert.equal((await client.post("/api/auth/change-password", { currentPassword: "wrong-password-123!", newPassword: STRONG })).status, 400);
  const changed = await client.post("/api/auth/change-password", { currentPassword: STRONG2, newPassword: STRONG });
  assert.equal(changed.status, 200, changed.text);
  const profile = await client.get("/api/auth/profile");
  assert.equal(profile.status, 200, "current session continues with fresh tokens");
  assert.equal(profile.json.mustChangePassword, false);
});

test("admin product listing includes wholesale terms; validation rejects bad part data", opts, async () => {
  await mkPart();
  const editor = await mkUser({ role: "admin", permissions: ["catalogue.manage"] });
  const client = server.client({ cookies: cookiesFor(editor) });
  const list = await client.get("/api/products");
  assert.equal(list.json.products[0].wholesalePrice, 700_000);
  const bad = await client.post("/api/products", { name: "x", description: "y", price: 1000, wholesalePrice: 5000, category: "brakes", stock: 1 });
  assert.equal(bad.status, 400);
  const dup = await client.post("/api/products", { name: "x", description: "y", price: 1000, category: "brakes", stock: 1, sku: "t21-3501080" });
  assert.equal(dup.status, 409);
});

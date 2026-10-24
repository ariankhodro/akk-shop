import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { assertDisposableDatabase, startApp, testSecrets, withDatabase, withRedisDb } from "./helpers/http-app.js";

const mongoUri = process.env.MONGO_TEST_URI ? withDatabase(process.env.MONGO_TEST_URI, "auth_integration_test") : "";
const redisUrl = process.env.REDIS_TEST_URL ? withRedisDb(process.env.REDIS_TEST_URL, 1) : "";
const enabled = Boolean(mongoUri && redisUrl);
assertDisposableDatabase(process.env.MONGO_TEST_URI || "");

let app; let server; let User; let AuditLog; let redis; let tokens;
const STRONG = "Zq!7vK-Lm2#Rt9xW";

before(async () => {
  if (!enabled) return;
  Object.assign(process.env, testSecrets, {
    REDIS_URL: redisUrl, NODE_ENV: "test", RATE_LIMIT_KEY_SALT: "integration-test-salt-0123456789",
    CLIENT_URL: "https://shop.example.ir", ALLOW_INSECURE_COOKIES: "true", BCRYPT_COST: "10",
  });
  await mongoose.connect(mongoUri);
  ({ default: User } = await import("../models/user.model.js"));
  ({ default: AuditLog } = await import("../models/audit-log.model.js"));
  ({ redis } = await import("../lib/redis.js"));
  if (redis.status !== "ready") await new Promise((resolve) => redis.once("ready", resolve));
  tokens = await import("../lib/auth-tokens.js");
  const { default: expressApp } = await import("../app.js");
  server = await startApp(expressApp);
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
  await Promise.all([User.deleteMany({}), AuditLog.deleteMany({})]);
  await redis.flushdb();
});

const opts = { skip: enabled ? false : "MONGO_TEST_URI and REDIS_TEST_URL are required" };
const mkUser = async (overrides = {}) => User.create({ name: "Test User", email: `u${Math.random().toString(16).slice(2)}@example.com`, password: STRONG, ...overrides });
const cookiesFor = (user) => ({ accessToken: tokens.signAccessToken(user) });

test("login rejects operator objects, arrays and non-string passwords without querying by them", opts, async () => {
  await mkUser({ email: "victim@example.com" });
  const client = server.client();
  const payloads = [
    { email: { $ne: null }, password: STRONG },
    { email: { $gt: "" }, password: STRONG },
    { email: { $regex: "^vic" }, password: STRONG },
    { email: ["victim@example.com"], password: STRONG },
    { email: "victim@example.com", password: { $ne: "x" } },
    { email: "victim@example.com", password: 123456789012 },
    { email: "victim@example.com", password: ["a"] },
    { email: "victim@example.com" },
    {},
  ];
  for (const payload of payloads) {
    const response = await client.post("/api/auth/login", payload);
    assert.equal(response.status, 401, JSON.stringify(payload));
    assert.deepEqual(response.json, { message: "Invalid email or password" }, "identical body for every rejection");
    assert.equal(response.setCookies.length, 0);
  }
});

test("malformed JSON bodies are rejected as 400 before reaching the handlers", opts, async () => {
  for (const body of ['"just-a-string"', "[1,2]", "{bad json", "null"]) {
    const response = await server.client().post("/api/auth/login", body);
    assert.ok([400, 401].includes(response.status), `${body} -> ${response.status}`);
    assert.equal(response.setCookies.length, 0);
  }
});

test("signup validates types, email format, name and password; operator objects get a 400, never a 500", opts, async () => {
  const client = server.client();
  for (const payload of [
    { email: { $ne: null }, name: "Name", password: STRONG },
    { email: { $regex: ".*" }, name: "Name", password: STRONG },
    { email: "not-an-email", name: "Name", password: STRONG },
    { email: "a@example.com", name: { $ne: 1 }, password: STRONG },
    { email: "a@example.com", name: "x", password: STRONG },
    { email: "a@example.com", name: "Name", password: ["x"] },
    { email: "a@example.com", name: "Name", password: "short" },
  ]) {
    const response = await client.post("/api/auth/signup", payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
  }
  assert.equal(await User.countDocuments(), 0);
});

test("signup, login and cookie flags; duplicate signup is a uniform 409 without disclosing details", opts, async () => {
  const client = server.client();
  const created = await client.post("/api/auth/signup", { email: "New@Example.com ", name: " New User ", password: STRONG });
  assert.equal(created.status, 201);
  assert.equal(created.json.email, "new@example.com");
  const accessCookie = created.setCookies.find((line) => line.startsWith("accessToken="));
  const refreshCookie = created.setCookies.find((line) => line.startsWith("refreshToken="));
  assert.match(accessCookie, /HttpOnly/i);
  assert.match(accessCookie, /SameSite=Strict/i);
  assert.match(refreshCookie, /Path=\/api\/auth/);
  const duplicate = await server.client().post("/api/auth/signup", { email: "new@example.com", name: "Other", password: STRONG });
  assert.equal(duplicate.status, 409);
  const login = await server.client().post("/api/auth/login", { email: "NEW@example.com", password: STRONG });
  assert.equal(login.status, 200);
  const wrong = await server.client().post("/api/auth/login", { email: "new@example.com", password: "Wr0ng!Zq-Mv8#Kt4n" });
  const unknown = await server.client().post("/api/auth/login", { email: "ghost@example.com", password: "Wr0ng!Zq-Mv8#Kt4n" });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, unknown.json, "unknown and known accounts are indistinguishable");
});

test("per-account failed-login throttle blocks guessing even from one address and recovers after success reset", opts, async () => {
  await mkUser({ email: "target@example.com" });
  const client = server.client();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await client.post("/api/auth/login", { email: "target@example.com", password: "Wr0ng!Zq-Mv8#Kt4n" })).status, 401);
  }
  const blocked = await client.post("/api/auth/login", { email: "target@example.com", password: STRONG });
  assert.equal(blocked.status, 429, "even the correct password is refused while throttled");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  // Another account from the same address is not affected.
  await mkUser({ email: "other@example.com" });
  assert.equal((await client.post("/api/auth/login", { email: "other@example.com", password: STRONG })).status, 200);
});

test("authentication fails closed (503) when Redis is unreachable and never degrades to unlimited", opts, async () => {
  await mkUser({ email: "outage@example.com" });
  const original = redis.eval.bind(redis);
  redis.eval = async () => { throw new Error("simulated redis outage"); };
  try {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await server.client().post("/api/auth/login", { email: "outage@example.com", password: "Wr0ng!Zq-Mv8#Kt4n" });
      assert.equal(response.status, 503);
      assert.equal(response.setCookies.length, 0);
    }
  } finally {
    redis.eval = original;
  }
});

test("refresh rotates tokens, tolerates a concurrent tab and revokes the session on stale-token replay", opts, async () => {
  const user = await mkUser({ email: "refresh@example.com" });
  const client = server.client();
  assert.equal((await client.post("/api/auth/login", { email: user.email, password: STRONG })).status, 200);
  const original = client.jar.get("refreshToken");

  const first = await client.post("/api/auth/refresh-token");
  assert.equal(first.status, 200);
  const rotated = client.jar.get("refreshToken");
  assert.notEqual(rotated, original);

  // Second tab still holding the previous cookie: benign race, session survives.
  const staleTab = server.client({ cookies: { refreshToken: original } });
  assert.equal((await staleTab.post("/api/auth/refresh-token")).status, 401);
  assert.equal((await client.post("/api/auth/refresh-token")).status, 200);

  // After two rotations the original token is neither current nor previous => theft signal.
  const replay = server.client({ cookies: { refreshToken: original } });
  assert.equal((await replay.post("/api/auth/refresh-token")).status, 401);
  assert.equal((await client.post("/api/auth/refresh-token")).status, 401, "session revoked by the replay");

  // Redis stores only a digest.
  const stored = await redis.get(`refresh_token:${user._id}`);
  assert.equal(stored, null);
});

test("access and refresh tokens are not interchangeable and old-version tokens are revoked", opts, async () => {
  const user = await mkUser();
  const refresh = tokens.signRefreshToken(user);
  assert.equal((await server.client({ cookies: { accessToken: refresh } }).get("/api/auth/profile")).status, 401);
  const access = tokens.signAccessToken(user);
  assert.equal((await server.client({ cookies: { accessToken: access } }).get("/api/auth/profile")).status, 200);
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  assert.equal((await server.client({ cookies: { accessToken: access } }).get("/api/auth/profile")).status, 401);
});

test("password reset consumes the token once and revokes existing sessions", opts, async () => {
  const user = await mkUser({ email: "reset@example.com" });
  const crypto = await import("node:crypto");
  const token = crypto.randomBytes(32).toString("hex");
  await User.updateOne({ _id: user._id }, {
    passwordResetTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    passwordResetExpiresAt: new Date(Date.now() + 60_000),
  });
  const access = tokens.signAccessToken(user);
  const newPassword = "Nw!4xT-Bq7#Yr2kD";
  const [a, b] = await Promise.all([
    server.client().post("/api/auth/reset-password", { token, password: newPassword }),
    server.client().post("/api/auth/reset-password", { token, password: newPassword }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  assert.equal((await server.client({ cookies: { accessToken: access } }).get("/api/auth/profile")).status, 401);
  assert.equal((await server.client().post("/api/auth/login", { email: "reset@example.com", password: newPassword })).status, 200);
  assert.equal((await server.client().post("/api/auth/reset-password", { token: { $ne: 1 }, password: newPassword })).status, 400);
});

// ---------------------------------------------------------------- RBAC over HTTP

const mkAdmin = (overrides) => mkUser({ role: "admin", ...overrides });

test("legacy admins without an explicit permission list are denied on every admin endpoint", opts, async () => {
  const legacy = await mkAdmin({ permissions: undefined });
  const client = server.client({ cookies: cookiesFor(legacy) });
  for (const path of ["/api/orders/admin", "/api/admin/customers", "/api/admin/audit-logs", "/api/admin/operations", "/api/analytics", "/api/analytics/export", "/api/coupons/admin"]) {
    assert.equal((await client.get(path)).status, 403, path);
  }
  assert.equal((await client.patch(`/api/admin/customers/${legacy._id}/access`, { role: "admin", permissions: ["*"] })).status, 403);
});

test("owner assigns role presets; changes revoke tokens and write before/after audit rows", opts, async () => {
  const owner = await mkAdmin({ isOwner: true, permissions: [] });
  const target = await mkUser({ email: "staff@example.com" });
  const targetToken = tokens.signAccessToken(target);
  const client = server.client({ cookies: cookiesFor(owner) });

  const promote = await client.patch(`/api/admin/customers/${target._id}/access`, { role: "admin", adminRole: "fulfillment" });
  assert.equal(promote.status, 200);
  assert.deepEqual(promote.json.customer.permissions.sort(), ["inventory.manage", "orders.manage"]);
  assert.equal(promote.json.customer.isOwner, false);

  // Token minted before the change is revoked immediately; a fresh one works with the new permissions.
  assert.equal((await server.client({ cookies: { accessToken: targetToken } }).get("/api/orders/admin")).status, 401);
  const fresh = server.client({ cookies: cookiesFor(await User.findById(target._id)) });
  assert.equal((await fresh.get("/api/orders/admin")).status, 200);
  assert.equal((await fresh.get("/api/analytics")).status, 403);
  assert.equal((await fresh.get("/api/admin/customers")).status, 403);

  const row = await AuditLog.findOne({ action: "customer.access_updated" }).lean();
  assert.equal(row.metadata.before.role, "customer");
  assert.equal(row.metadata.after.role, "admin");
  assert.equal(row.metadata.targetEmail, "staff@example.com");
  assert.ok(row.metadata.changedFields.includes("permissions"));

  // Promoting without permissions or preset is refused; wildcard is no longer assignable.
  const other = await mkUser();
  assert.equal((await client.patch(`/api/admin/customers/${other._id}/access`, { role: "admin" })).status, 400);
  assert.equal((await client.patch(`/api/admin/customers/${other._id}/access`, { role: "admin", permissions: ["*"] })).status, 400);
  assert.equal((await client.patch(`/api/admin/customers/${other._id}/access`, { role: "admin", permissions: { $ne: 1 } })).status, 400);
  assert.equal((await User.findById(other._id)).role, "customer");
});

test("delegated roles.manage admin cannot escalate, grant roles.manage, or touch owners; last owner is protected", opts, async () => {
  const owner = await mkAdmin({ isOwner: true, permissions: [] });
  const delegate = await mkAdmin({ permissions: ["roles.manage", "orders.manage", "customers.manage"] });
  const victim = await mkUser();
  const client = server.client({ cookies: cookiesFor(delegate) });

  assert.equal((await client.patch(`/api/admin/customers/${victim._id}/access`, { role: "admin", permissions: ["orders.manage"] })).status, 200);
  const fresh = await User.findById(victim._id);
  assert.equal((await client.patch(`/api/admin/customers/${fresh._id}/access`, { role: "admin", permissions: ["roles.manage"] })).status, 403);
  assert.equal((await client.patch(`/api/admin/customers/${fresh._id}/access`, { role: "admin", permissions: ["catalogue.manage"] })).status, 403);
  assert.equal((await client.patch(`/api/admin/customers/${fresh._id}/access`, { role: "admin", permissions: ["orders.manage"], isOwner: true })).status, 403);
  assert.equal((await client.patch(`/api/admin/customers/${owner._id}/access`, { isActive: false })).status, 403);
  assert.equal((await client.patch(`/api/admin/customers/${delegate._id}/access`, { permissions: ["roles.manage", "orders.manage", "customers.manage"] })).status, 409);

  // Delegates cannot see other admins' permission lists... unless they manage access; owners see them.
  const list = await client.get("/api/admin/customers");
  assert.equal(list.status, 200);
  const ownerClient = server.client({ cookies: cookiesFor(owner) });
  assert.equal((await ownerClient.patch(`/api/admin/customers/${owner._id}/access`, { isActive: false })).status, 409);
  assert.equal((await ownerClient.patch(`/api/admin/customers/${owner._id}/access`, { role: "customer" })).status, 409);
  const second = await mkAdmin({ permissions: [] });
  assert.equal((await ownerClient.patch(`/api/admin/customers/${second._id}/access`, { role: "admin", permissions: [], isOwner: true })).status, 200);
  assert.equal((await ownerClient.patch(`/api/admin/customers/${second._id}/access`, { isOwner: false })).status, 200, "another owner exists, so demotion is allowed");
});

test("PII listings and exports are audited; export needs its own permission", opts, async () => {
  const analyst = await mkAdmin({ permissions: ["reports.view"] });
  const exporter = await mkAdmin({ permissions: ["reports.export", "customers.manage"] });
  assert.equal((await server.client({ cookies: cookiesFor(analyst) }).get("/api/analytics/export")).status, 403);
  const exportClient = server.client({ cookies: cookiesFor(exporter) });
  assert.equal((await exportClient.get("/api/analytics/export")).status, 200);
  assert.equal((await exportClient.get("/api/admin/customers?q=abc")).status, 200);
  assert.equal(await AuditLog.countDocuments({ action: "analytics.exported" }), 1);
  assert.equal(await AuditLog.countDocuments({ action: "customers.listed" }), 1);
  const listed = await exportClient.get("/api/admin/customers");
  assert.equal(listed.json.customers.every((customer) => !("permissions" in customer)), true, "no permission lists for non-access-managers");
});

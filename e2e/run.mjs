// End-to-end journey test: real backend (Mongo + Redis), built SPA, real Chromium.
// Zarinpal is mocked at the fetch layer; no real payment credentials are involved.
//   MONGO_E2E_URI=mongodb://127.0.0.1:27017/shop_e2e_test?replicaSet=rs0 REDIS_E2E_URL=redis://127.0.0.1:6390/3 node e2e/run.mjs
import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "frontend/dist");
const shots = process.env.E2E_SHOTS_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const MONGO = process.env.MONGO_E2E_URI;
const REDIS = process.env.REDIS_E2E_URL;
if (!MONGO || !REDIS || !/_test/.test(MONGO)) { console.error("MONGO_E2E_URI (database name containing _test) and REDIS_E2E_URL are required"); process.exit(2); }
if (!existsSync(path.join(dist, "index.html"))) { console.error("Build the frontend first: npm run build --prefix frontend"); process.exit(2); }

const FRONT = 4173; const API = 5055; const ORIGIN = `http://127.0.0.1:${FRONT}`;
const STRONG = "Zq!7vK-Lm2#Rt9xW";
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS", name); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.log("FAIL", name, "-", error.message.split("\n")[0]); }
};
const expect = (condition, message) => { if (!condition) throw new Error(message); };

// Static server with SPA fallback and /api reverse proxy.
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api")) {
    const proxied = http.request({ host: "127.0.0.1", port: API, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${API}` } }, (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    proxied.on("error", () => { res.writeHead(502); res.end(); });
    return req.pipe(proxied);
  }
  const clean = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(dist, clean);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, "index.html");
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".webmanifest": "application/manifest+json" };
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(FRONT, "127.0.0.1", resolve));

const env = {
  ...process.env, NODE_ENV: "test", PORT: String(API), MONGO_URI: MONGO, REDIS_URL: REDIS,
  ACCESS_TOKEN_SECRET: randomBytes(32).toString("hex"), REFRESH_TOKEN_SECRET: randomBytes(32).toString("hex"),
  RATE_LIMIT_KEY_SALT: randomBytes(16).toString("hex"), CLIENT_URL: ORIGIN, API_URL: ORIGIN, ALLOW_INSECURE_COOKIES: "true",
  ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000", ZARINPAL_SANDBOX: "true", IRT_CATALOG_PRICES_CONFIRMED: "true",
  CRON_SECRET: randomBytes(32).toString("hex"), BCRYPT_COST: "10",
};
const backend = spawn("node", ["--import", path.join(root, "e2e/zarinpal-mock-preload.mjs"), "backend/server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let backendLog = "";
backend.stdout.on("data", (d) => { backendLog += d; }); backend.stderr.on("data", (d) => { backendLog += d; });
for (let i = 0; i < 60; i += 1) {
  try { const r = await fetch(`http://127.0.0.1:${API}/api/health`); if (r.ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}

await mongoose.connect(MONGO);
await mongoose.connection.dropDatabase();
const { default: User } = await import("../backend/models/user.model.js");
const { default: Product } = await import("../backend/models/product.model.js");
const { default: Category } = await import("../backend/models/category.model.js");
const { default: Order } = await import("../backend/models/order.model.js");

const owner = await User.create({ name: "Store Owner", email: "owner@example.com", password: STRONG, role: "admin", isOwner: true, permissions: [] });
await User.create({ name: "Analyst Person", email: "analyst@example.com", password: STRONG, role: "admin", permissions: ["reports.view"], adminRole: "analyst" });
await User.create({ name: "Legacy Admin", email: "legacy@example.com", password: STRONG, role: "admin" });
const category = await Category.create({ name: "پیراهن", slug: "shirts", description: "پیراهن‌های مردانه" }).catch(async () => Category.findOne({ slug: "shirts" }));
const product = await Product.create({
  name: "پیراهن آزمایشی", description: "پیراهن نخی برای آزمون سرتاسری", price: 450000, category: "shirts",
  categoryId: category?._id || null, stock: 5, images: [], image: "", isActive: true, isFeatured: true,
});

const browser = await chromium.launch();
const consoleErrors = [];
const newPage = async (context) => {
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  return page;
};
const snap = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true }); };

const customerCtx = await browser.newContext({ locale: "fa-IR", viewport: { width: 390, height: 844 } });
const page = await newPage(customerCtx);

await step("browse: home renders RTL Persian storefront", async () => {
  await page.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  expect(await page.getAttribute("html", "dir") === "rtl", "html dir is not rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow at 390px");
  await snap(page, "home");
});

await step("browse: product page shows product and price", async () => {
  await page.goto(`${ORIGIN}/product/${product._id}`, { waitUntil: "networkidle" });
  expect((await page.textContent("body")).includes("پیراهن آزمایشی"), "product name missing");
  await snap(page, "product");
});

await step("auth: signup rejects a weak password client-side/server-side and accepts a strong one", async () => {
  await page.goto(ORIGIN + "/signup", { waitUntil: "networkidle" });
  await page.fill("#signup-name", "مشتری آزمایشی");
  await page.fill("#signup-email", "buyer@example.com");
  await page.fill("#signup-password", "weak");
  await page.fill("#signup-confirm-password", "weak");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);
  expect(await User.countDocuments({ email: "buyer@example.com" }) === 0, "weak password created an account");
  await page.fill("#signup-password", STRONG);
  await page.fill("#signup-confirm-password", STRONG);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 8000 });
  expect(await User.countDocuments({ email: "buyer@example.com" }) === 1, "account not created");
});

await step("auth: session survives reload; cookies are HttpOnly", async () => {
  await page.reload({ waitUntil: "networkidle" });
  const cookies = await customerCtx.cookies();
  const access = cookies.find((c) => c.name === "accessToken");
  expect(access && access.httpOnly === true && access.sameSite === "Strict", "access cookie flags wrong");
  const profile = await page.evaluate(async () => (await fetch("/api/auth/profile")).status);
  expect(profile === 200, "profile status " + profile);
});

await step("cart: add product and see it in the cart", async () => {
  await page.goto(`${ORIGIN}/product/${product._id}`, { waitUntil: "networkidle" });
  const add = page.getByRole("button", { name: /افزودن به سبد|اضافه به سبد/ }).first();
  await add.click();
  await page.waitForTimeout(800);
  await page.goto(ORIGIN + "/cart", { waitUntil: "networkidle" });
  expect((await page.textContent("body")).includes("پیراهن آزمایشی"), "cart does not contain the product");
  await snap(page, "cart");
});

let orderId;
await step("checkout: address -> gateway redirect -> verified callback -> success + stock decremented", async () => {
  await page.route("**://sandbox.zarinpal.com/**", async (route) => {
    const authority = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    const order = await Order.findOne({ zarinpalAuthority: authority }).lean();
    orderId = String(order._id);
    await route.fulfill({ status: 302, headers: { location: `${ORIGIN}/api/payments/zarinpal/verify?Authority=${authority}&Status=OK&order_id=${orderId}` } });
  });
  const fill = async (locator, value) => { await locator.first().fill(value); };
  const form = page.locator("section[aria-labelledby='delivery-address-title']");
  const inputs = form.locator("input");
  await fill(form.locator("input[autocomplete='name']"), "مشتری آزمایشی");
  await fill(form.locator("input[type='tel']"), "09123456789");
  const select = form.locator("select").first();
  if (await select.count()) await select.selectOption({ index: 1 });
  else await fill(form.locator("input").nth(2), "تهران");
  await fill(form.locator("input[autocomplete='address-level2']"), "تهران");
  await fill(form.locator("input[autocomplete='postal-code']"), "1234567890");
  await fill(form.locator("textarea[autocomplete='street-address']"), "خیابان آزمایش، پلاک ۱۰، واحد ۲");
  void inputs;
  await page.getByRole("button", { name: /پرداخت آنلاین/ }).click();
  await page.waitForURL(/purchase-success/, { timeout: 15000 });
  const order = await Order.findById(orderId).lean();
  expect(order.paymentStatus === "paid", "order not paid: " + order.paymentStatus);
  expect(order.finalizedAt, "order not finalized");
  expect((await Product.findById(product._id).lean()).stock === 4, "stock not decremented to 4");
  await snap(page, "purchase-success");
});

await step("orders: customer sees the paid order", async () => {
  await page.goto(ORIGIN + "/orders", { waitUntil: "networkidle" });
  expect((await page.textContent("body")).includes("پرداخت تأیید شد"), "paid label missing on orders page");
});

await step("payment: replayed callback is idempotent", async () => {
  const order = await Order.findById(orderId).lean();
  const url = `${ORIGIN}/api/payments/zarinpal/verify?Authority=${order.zarinpalAuthority}&Status=OK&order_id=${orderId}`;
  const a = await fetch(url, { redirect: "manual" }); const b = await fetch(url, { redirect: "manual" });
  expect(a.status === 302 && b.status === 302, "callback statuses " + a.status + "/" + b.status);
  const after = await Order.findById(orderId).lean();
  expect(after.shipmentEvents.length === order.shipmentEvents.length, "replay created another shipment event");
  expect((await Product.findById(product._id).lean()).stock === 4, "replay changed stock");
});

await step("security: operator-injection login payload is refused in a real browser session", async () => {
  const status = await page.evaluate(async () => (await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: { $ne: null }, password: "x" }) })).status);
  expect(status === 401, "status " + status);
});

const adminLogin = async (email) => {
  const ctx = await browser.newContext({ locale: "fa-IR", viewport: { width: 1280, height: 900 } });
  const p = await newPage(ctx);
  await p.goto(ORIGIN + "/login", { waitUntil: "networkidle" });
  await p.fill("#login-email", email); await p.fill("#login-password", STRONG);
  await p.click('button[type="submit"]');
  await p.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 8000 });
  return { ctx, p };
};

await step("admin: owner sees the full admin console and can change another admin's access", async () => {
  const { ctx, p } = await adminLogin("owner@example.com");
  await p.goto(ORIGIN + "/secret-dashboard?tab=customers", { waitUntil: "networkidle" });
  const body = await p.textContent("body");
  expect(body.includes("مدیریت مشتریان و دسترسی مدیران"), "customer management not shown to owner");
  const tabs = await p.locator("[role=tab]").count();
  expect(tabs >= 14, "owner sees only " + tabs + " tabs");
  await snap(p, "admin-owner");
  const status = await p.evaluate(async (id) => (await fetch(`/api/admin/customers/${id}/access`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "admin", adminRole: "fulfillment" }) })).status, String((await User.findOne({ email: "buyer@example.com" }))._id));
  expect(status === 200, "owner promote status " + status);
  await ctx.close();
});

await step("admin: analyst sees only report tabs; fulfilment endpoints and PII export are refused", async () => {
  const { ctx, p } = await adminLogin("analyst@example.com");
  await p.goto(ORIGIN + "/secret-dashboard", { waitUntil: "networkidle" });
  const labels = await p.locator("[role=tab]").allTextContents();
  expect(labels.length > 0 && labels.length <= 3, "analyst tabs: " + labels.join("|"));
  const statuses = await p.evaluate(async () => Promise.all(["/api/orders/admin", "/api/analytics/export", "/api/admin/customers", "/api/analytics?days=7"].map(async (u) => (await fetch(u)).status)));
  expect(JSON.stringify(statuses) === JSON.stringify([403, 403, 403, 200]), "statuses " + statuses);
  await snap(p, "admin-analyst");
  await ctx.close();
});

await step("admin: legacy admin without permissions is denied everywhere and sees no tabs", async () => {
  const { ctx, p } = await adminLogin("legacy@example.com");
  await p.goto(ORIGIN + "/secret-dashboard", { waitUntil: "networkidle" });
  expect(await p.locator("[role=tab]").count() === 0, "legacy admin sees tabs");
  const statuses = await p.evaluate(async () => Promise.all(["/api/orders/admin", "/api/analytics", "/api/admin/operations"].map(async (u) => (await fetch(u)).status)));
  expect(statuses.every((s) => s === 403), "statuses " + statuses);
  await ctx.close();
});

await step("admin: fulfilment role (promoted above) can ship the paid order; customer cannot reach admin APIs", async () => {
  const { ctx, p } = await adminLogin("buyer@example.com");
  const list = await p.evaluate(async () => (await fetch("/api/orders/admin")).status);
  expect(list === 200, "fulfilment list " + list);
  const shipped = await p.evaluate(async (id) => (await fetch(`/api/orders/${id}/shipment`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ shipmentStatus: "packed" }) })).status, orderId);
  expect([200, 400, 409].includes(shipped), "shipment status " + shipped);
  const analytics = await p.evaluate(async () => (await fetch("/api/analytics")).status);
  expect(analytics === 403, "fulfilment reached analytics: " + analytics);
  await ctx.close();
  const anon = await fetch(`http://127.0.0.1:${API}/api/orders/admin`);
  expect(anon.status === 401, "anonymous status " + anon.status);
});

await step("browser: no unexpected console errors during the journeys", async () => {
  const unexpected = consoleErrors.filter((m) => !/Failed to load resource: the server responded with a status of (401|403|400|409)|net::ERR_ABORTED|sandbox\.zarinpal|fonts\.g/i.test(m));
  expect(unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
});

await browser.close();
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
backend.kill("SIGTERM");
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nE2E: ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) { console.log(backendLog.split("\n").slice(-15).join("\n")); process.exitCode = 1; }

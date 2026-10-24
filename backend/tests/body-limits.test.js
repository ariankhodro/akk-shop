import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import productRoutes from "../routes/product.route.js";
import categoryRoutes from "../routes/category.route.js";
import campaignRoutes from "../routes/campaign.route.js";
import { createReadyHandler } from "../lib/ready-handler.js";
import {
  globalJsonBody,
  isLargeJsonRoute,
  largeJsonBody,
} from "../middleware/body-parsers.middleware.js";

const withServer = async (app, callback) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { return await callback(server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
};

const request = (port, { method = "POST", path, headers = {}, body }) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json; try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end(body);
  });

const errorHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.status === 413) return res.status(413).json({ message: "Request body is too large" });
  return res.status(500).json({ message: "error" });
};

const buildApp = () => {
  const app = express();
  app.use("/api", globalJsonBody);
  app.use(cookieParser());
  app.use("/api/products", productRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/campaigns", campaignRoutes);
  app.use(errorHandler);
  return app;
};

const bigJson = (megabytes) => JSON.stringify({ image: "A".repeat(megabytes * 1024 * 1024) });
const ID = "64f123456789abcdef123456";

test("anonymous 9 MB write requests get 401 and the body is never JSON-parsed", async () => {
  const originalParse = JSON.parse;
  let largestParsed = 0;
  JSON.parse = function (text, ...rest) {
    if (typeof text === "string") largestParsed = Math.max(largestParsed, text.length);
    return originalParse.call(this, text, ...rest);
  };
  try {
    await withServer(buildApp(), async (port) => {
      const body = bigJson(9);
      for (const [method, path] of [
        ["POST", "/api/products"],
        ["PUT", "/api/products/" + ID],
        ["POST", "/api/categories"],
        ["PATCH", "/api/categories/" + ID],
        ["POST", "/api/campaigns"],
        ["PATCH", "/api/campaigns/" + ID],
      ]) {
        const response = await request(port, {
          method, path, body,
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        });
        assert.equal(response.status, 401, method + " " + path);
      }
    });
  } finally {
    JSON.parse = originalParse;
  }
  assert.ok(largestParsed < 1024 * 1024, "no large body may be parsed before authentication (parsed " + largestParsed + ")");
});

test("every large-body route mounts the 10 MB parser after protectRoute and adminRoute", () => {
  const expected = [
    [productRoutes, "post", "/"], [productRoutes, "put", "/:id"],
    [categoryRoutes, "post", "/"], [categoryRoutes, "patch", "/:id"],
    [campaignRoutes, "post", "/"], [campaignRoutes, "patch", "/:id"],
  ];
  for (const [router, method, path] of expected) {
    const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
    assert.ok(layer, method + " " + path);
    const handlers = layer.route.stack.map((entry) => entry.handle);
    const parserIndex = handlers.indexOf(largeJsonBody);
    assert.ok(parserIndex >= 2, method + " " + path + " must parse after protectRoute and adminRoute");
    assert.equal(parserIndex, handlers.length - 2, "parser directly precedes the controller");
  }
});

test("the global parser skips exactly the routes that mount the large parser", () => {
  const req = (method, path) => ({ method, path });
  assert.equal(isLargeJsonRoute(req("POST", "/products")), true);
  assert.equal(isLargeJsonRoute(req("PUT", "/products/" + ID)), true);
  assert.equal(isLargeJsonRoute(req("PATCH", "/categories/" + ID)), true);
  assert.equal(isLargeJsonRoute(req("PATCH", "/campaigns/" + ID)), true);
  // Stock/featured toggles and unrelated routes keep the 1 MB limit.
  assert.equal(isLargeJsonRoute(req("PATCH", "/products/" + ID)), false);
  assert.equal(isLargeJsonRoute(req("PATCH", "/products/" + ID + "/stock")), false);
  assert.equal(isLargeJsonRoute(req("POST", "/auth/login")), false);
  assert.equal(isLargeJsonRoute(req("PUT", "/categories/" + ID)), false);
});

test("global parser enforces 1 MB while the route-level parser accepts payloads up to 10 MB", async () => {
  const app = express();
  app.use("/api", globalJsonBody);
  app.post("/api/other", (req, res) => res.json({ size: req.body.image.length }));
  app.post("/api/products", (_req, _res, next) => next(), largeJsonBody, (req, res) => res.json({ size: req.body.image.length }));
  app.use(errorHandler);
  await withServer(app, async (port) => {
    const send = (path, body) => request(port, {
      path, body, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    });
    assert.equal((await send("/api/other", bigJson(2))).status, 413);
    assert.equal((await send("/api/other", bigJson(0).replace("{}", "{}"))).status, 200);
    const accepted = await send("/api/products", bigJson(3));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.size, 3 * 1024 * 1024);
    assert.equal((await send("/api/products", bigJson(11))).status, 413);
  });
});

const readyDeps = (overrides = {}) => ({
  connectDB: async () => {},
  getReadinessStatus: async () => ({ status: "ready", database: "connected", redis: "connected" }),
  isDatabaseReady: () => true,
  redisClient: {},
  ...overrides,
});

const callReady = async (handler, headers = {}) => {
  const res = {
    headers: {}, statusCode: 200, body: undefined,
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  await handler({ get: (name) => lower[name.toLowerCase()], headers: lower }, res);
  return res;
};

test("/api/ready without READINESS_TOKEN returns only the status to anonymous callers", async () => {
  delete process.env.READINESS_TOKEN;
  const ready = await callReady(createReadyHandler(readyDeps()));
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.body, { status: "ready" });

  const notReady = await callReady(createReadyHandler(readyDeps({
    getReadinessStatus: async () => ({ status: "not_ready", database: "disconnected", redis: "connected" }),
  })));
  assert.equal(notReady.statusCode, 503);
  assert.deepEqual(notReady.body, { status: "not_ready" });
});

test("/api/ready requires the shared secret when READINESS_TOKEN is set", async () => {
  process.env.READINESS_TOKEN = "s3cret-token-value";
  try {
    let connectCalls = 0;
    const handler = createReadyHandler(readyDeps({ connectDB: async () => { connectCalls += 1; } }));

    const anonymous = await callReady(handler);
    assert.equal(anonymous.statusCode, 401);
    assert.equal(JSON.stringify(anonymous.body).includes("database"), false);
    assert.equal((await callReady(handler, { "X-Readiness-Token": "wrong-token-value!" })).statusCode, 401);
    assert.equal((await callReady(handler, { "X-Readiness-Token": "short" })).statusCode, 401);
    assert.equal(connectCalls, 0, "unauthenticated callers must not trigger dependency checks");

    const viaHeader = await callReady(handler, { "X-Readiness-Token": "s3cret-token-value" });
    assert.equal(viaHeader.statusCode, 200);
    assert.deepEqual(viaHeader.body, { status: "ready", database: "connected", redis: "connected" });
    const viaBearer = await callReady(handler, { Authorization: "Bearer s3cret-token-value" });
    assert.equal(viaBearer.statusCode, 200);
    assert.equal(connectCalls, 2);
  } finally {
    delete process.env.READINESS_TOKEN;
  }
});

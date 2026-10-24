import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { withRedisDb } from "./helpers/http-app.js";

const redisUrl = process.env.REDIS_TEST_URL ? withRedisDb(process.env.REDIS_TEST_URL, 2) : "";
const opts = { skip: redisUrl ? false : "REDIS_TEST_URL is required" };
let limiterModule; let redis;

before(async () => {
  if (!redisUrl) return;
  process.env.REDIS_URL = redisUrl;
  process.env.RATE_LIMIT_KEY_SALT = "rate-limit-integration-salt-0123";
  ({ redis } = await import("../lib/redis.js"));
  limiterModule = await import("../middleware/rate-limit.middleware.js");
  if (redis.status !== "ready") await new Promise((resolve) => redis.once("ready", resolve));
  await redis.flushdb();
});
after(async () => { if (redis?.disconnect) redis.disconnect(); });

const makeRes = () => ({
  statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
  status(code) { this.statusCode = code; return this; }, json() { return this; },
});
const hit = async (limiter, ip) => { const res = makeRes(); await limiter({ ip }, res, () => {}); return res.statusCode; };

test("two independently created limiters (simulated instances) share one Redis budget", opts, async () => {
  const config = { name: "shared", limit: 4, windowSeconds: 60, failMode: limiterModule.FAIL_MODE.CLOSED };
  const instanceA = limiterModule.createRateLimiter(config);
  const instanceB = limiterModule.createRateLimiter(config);
  const results = [];
  for (let index = 0; index < 6; index += 1) results.push(await hit(index % 2 ? instanceA : instanceB, "198.51.100.7"));
  assert.deepEqual(results, [200, 200, 200, 200, 429, 429]);
});

test("window keys expire so a blocked client is released", opts, async () => {
  const limiter = limiterModule.createRateLimiter({ name: "expiry", limit: 1, windowSeconds: 1, failMode: limiterModule.FAIL_MODE.CLOSED });
  assert.equal(await hit(limiter, "198.51.100.8"), 200);
  assert.equal(await hit(limiter, "198.51.100.8"), 429);
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(await hit(limiter, "198.51.100.8"), 200);
});

test("rotating addresses inside one IPv6 /64 does not bypass the limit", opts, async () => {
  const limiter = limiterModule.createRateLimiter({ name: "v6", limit: 2, windowSeconds: 60, failMode: limiterModule.FAIL_MODE.CLOSED });
  const results = [];
  for (let index = 1; index <= 5; index += 1) results.push(await hit(limiter, `2001:db8:1:2:${index}::${index}`));
  assert.deepEqual(results, [200, 200, 429, 429, 429]);
});

test("a counter without TTL (crash between INCR and EXPIRE) is repaired instead of blocking forever", opts, async () => {
  const key = Object.keys(await (async () => { await redis.set("probe", "1"); return { probe: 1 }; })())[0];
  assert.equal(key, "probe");
  const limiter = limiterModule.createRateLimiter({ name: "ttl-repair", limit: 1, windowSeconds: 30, failMode: limiterModule.FAIL_MODE.CLOSED });
  await hit(limiter, "198.51.100.9");
  const keys = await redis.keys("rate-limit:ttl-repair:*");
  assert.equal(keys.length, 1);
  await redis.persist(keys[0]);
  await hit(limiter, "198.51.100.9");
  assert.ok(await redis.ttl(keys[0]) > 0);
});

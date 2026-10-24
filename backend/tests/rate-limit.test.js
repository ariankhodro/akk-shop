import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, FAIL_MODE, normalizeClientAddress, __resetMemoryWindowsForTests } from "../middleware/rate-limit.middleware.js";

// This file runs in its own process without REDIS_URL, so every Redis call
// throws: exactly the "Redis outage" condition.

const makeRes = () => ({
  statusCode: 200, headers: {}, body: undefined,
  set(key, value) { this.headers[key] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const call = async (limiter, ip) => {
  const res = makeRes();
  let nexted = false;
  await limiter({ ip }, res, () => { nexted = true; });
  return { nexted, res };
};

test("fail-closed limiters reject with 503 during a Redis outage, for every client, without counting in memory", async () => {
  __resetMemoryWindowsForTests();
  const limiter = createRateLimiter({ name: "t-closed", limit: 3, windowSeconds: 60, failMode: FAIL_MODE.CLOSED });
  for (let index = 0; index < 20; index += 1) {
    const { nexted, res } = await call(limiter, `10.0.0.${index}`);
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["Retry-After"], "30");
  }
});

test("memory-mode limiters keep limiting (not unlimited) during a Redis outage and are bounded per client", async () => {
  __resetMemoryWindowsForTests();
  const limiter = createRateLimiter({ name: "t-memory", limit: 3, windowSeconds: 60, failMode: FAIL_MODE.MEMORY });
  const outcomes = [];
  for (let index = 0; index < 5; index += 1) outcomes.push((await call(limiter, "10.1.1.1")).res.statusCode);
  assert.deepEqual(outcomes, [200, 200, 200, 429, 429]);
  assert.equal((await call(limiter, "10.1.1.2")).nexted, true, "another client is unaffected");
});

test("IPv6 clients are bucketed by /64 and IPv4-mapped addresses collapse to IPv4", () => {
  assert.equal(normalizeClientAddress("2001:db8:abcd:12::1"), normalizeClientAddress("2001:db8:abcd:12:ffff:ffff:ffff:ffff"));
  assert.notEqual(normalizeClientAddress("2001:db8:abcd:12::1"), normalizeClientAddress("2001:db8:abcd:13::1"));
  assert.equal(normalizeClientAddress("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeClientAddress("203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeClientAddress(undefined), "unknown");
});

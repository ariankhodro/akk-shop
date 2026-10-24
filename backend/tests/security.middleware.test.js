import test from "node:test";
import assert from "node:assert/strict";
import { browserOriginAndCors, securityHeaders } from "../middleware/security.middleware.js";

const makeResponse = () => {
  const headers = {};
  const response = {
    statusCode: 200,
    body: undefined,
    ended: false,
    set(name, value) { headers[name.toLowerCase()] = value; return this; },
    vary(value) { headers.vary = headers.vary ? headers.vary + ", " + value : value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; },
    headers,
  };
  return response;
};

const makeRequest = ({ method = "GET", headers = {}, secure = false } = {}) => ({
  method,
  secure,
  get(name) {
    const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : undefined;
  },
});

const withEnv = async (values, callback) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try { await callback(); }
  finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
};

test("security headers are explicit and HSTS is only emitted for production HTTPS", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const response = makeResponse();
    let calledNext = false;
    securityHeaders(makeRequest({ secure: true }), response, () => { calledNext = true; });
    assert.equal(calledNext, true);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["referrer-policy"], "strict-origin-when-cross-origin");
    assert.match(response.headers["content-security-policy"], /default-src 'none'/);
    assert.equal(response.headers["strict-transport-security"], "max-age=15552000");

    const httpResponse = makeResponse();
    securityHeaders(makeRequest({ secure: false }), httpResponse, () => {});
    assert.equal(httpResponse.headers["strict-transport-security"], undefined);
  });
});

test("configured storefront origin receives credentialed CORS headers", async () => {
  await withEnv({
    NODE_ENV: "production",
    CLIENT_URL: "https://shop.example.ir/path",
    FRONTEND_URL: undefined,
    CORS_ALLOWED_ORIGINS: "https://admin.example.ir,https://other.invalid/path",
  }, async () => {
    const response = makeResponse();
    let calledNext = false;
    browserOriginAndCors(makeRequest({
      method: "GET",
      headers: { Origin: "https://shop.example.ir" },
    }), response, () => { calledNext = true; });
    assert.equal(calledNext, true);
    assert.equal(response.headers["access-control-allow-origin"], "https://shop.example.ir");
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    assert.equal(response.headers.vary, "Origin");
  });
});

test("untrusted origin is blocked on state-changing requests", async () => {
  await withEnv({ NODE_ENV: "production", CLIENT_URL: "https://shop.example.ir", CORS_ALLOWED_ORIGINS: "" }, async () => {
    const response = makeResponse();
    let calledNext = false;
    browserOriginAndCors(makeRequest({
      method: "POST",
      headers: { Origin: "https://attacker.invalid", "Sec-Fetch-Site": "cross-site" },
    }), response, () => { calledNext = true; });
    assert.equal(calledNext, false);
    assert.equal(response.statusCode, 403);
  });
});

test("allowed CORS preflight returns configured methods and credentials", async () => {
  await withEnv({ NODE_ENV: "production", CLIENT_URL: "https://shop.example.ir", CORS_ALLOWED_ORIGINS: "" }, async () => {
    const response = makeResponse();
    browserOriginAndCors(makeRequest({
      method: "OPTIONS",
      headers: { Origin: "https://shop.example.ir", "Access-Control-Request-Method": "POST" },
    }), response, () => assert.fail("preflight should not continue to routes"));
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], "https://shop.example.ir");
    assert.match(response.headers["access-control-allow-methods"], /PATCH/);
  });
});

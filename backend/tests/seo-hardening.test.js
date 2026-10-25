import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharePreviewHandler from "../../api/share-preview.js";
import pageShellHandler from "../../api/page-shell.js";
import { getInternalOrigin, resetShellCache } from "../../seo/server-utils.js";
import { HTML_SECURITY_HEADERS } from "../../seo/security-headers.js";

const SITE = "https://shop.example";
const API = "https://api.example";
const SHELL = '<!doctype html><html lang="fa"><head><meta charset="utf-8"><title>x</title><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';

const ENV_KEYS = ["PUBLIC_SITE_URL", "VERCEL_URL", "VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "API_BASE_URL", "VITE_API_URL", "NODE_ENV"];
const savedEnv = {};
const originalFetch = globalThis.fetch;
let fetched;

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.PUBLIC_SITE_URL = SITE;
  process.env.API_BASE_URL = API + "/api";
  fetched = [];
  resetShellCache();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const html = (body = SHELL) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const makeReq = (query, host = "evil.example") => ({
  method: "GET", headers: { host, "x-forwarded-proto": "https" }, url: "/", query,
});
const makeRes = () => {
  const res = {
    statusCode: 200, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = String(value); return this; },
  };
  return res;
};

test("getInternalOrigin prefers VERCEL_URL, then PUBLIC_SITE_URL, and ignores request headers when deployed", () => {
  assert.equal(getInternalOrigin("https://evil.example"), SITE);
  process.env.VERCEL_URL = "my-app-git-main.vercel.app";
  assert.equal(getInternalOrigin("https://evil.example"), "https://my-app-git-main.vercel.app");
  process.env.VERCEL_URL = "evil.example/path?x";
  assert.throws(() => getInternalOrigin("https://x.example"));
  delete process.env.VERCEL_URL;
  delete process.env.PUBLIC_SITE_URL;
  // Local development / tests only: fall back to the request origin.
  assert.equal(getInternalOrigin("http://localhost:3000"), "http://localhost:3000");
  process.env.VERCEL = "1";
  assert.throws(() => getInternalOrigin("https://evil.example"), /No configured site origin/);
  delete process.env.VERCEL;
  process.env.NODE_ENV = "production";
  assert.throws(() => getInternalOrigin("https://evil.example"), /No configured site origin/);
});

test("the shell is fetched from the configured origin, never from a forged Host header", async () => {
  globalThis.fetch = async (input) => {
    fetched.push(String(input));
    return html();
  };
  const res = makeRes();
  await pageShellHandler(makeReq({ path: "/login" }, "169.254.169.254"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(fetched, [SITE + "/index.html"]);
  assert.ok(!fetched.some((url) => url.includes("169.254")));
});

test("a deployed instance without any configured origin refuses to fetch instead of trusting Host", async () => {
  delete process.env.PUBLIC_SITE_URL;
  process.env.VERCEL = "1";
  globalThis.fetch = async (input) => { fetched.push(String(input)); return html(); };
  const res = makeRes();
  await pageShellHandler(makeReq({ path: "/login" }), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(fetched, []);
  assert.equal(res.headers["retry-after"], "30");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.match(res.headers["content-type"], /text\/html/);
});

test("relative API bases are also resolved against the configured origin", async () => {
  delete process.env.API_BASE_URL;
  process.env.VERCEL_URL = "deploy.vercel.app";
  globalThis.fetch = async (input) => {
    fetched.push(String(input));
    if (String(input).endsWith("/index.html")) return html();
    return json({ _id: "64f123456789abcdef123456", name: "Shirt", description: "d", price: 1, isActive: true, category: "jeans" });
  };
  const res = makeRes();
  await sharePreviewHandler(makeReq({ type: "product", id: "64f123456789abcdef123456" }, "evil.example"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(fetched.every((url) => url.startsWith("https://deploy.vercel.app/")), fetched.join(","));
});

test("category previews keep filter values containing r or n and drop CR/LF values", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    fetched.push(url);
    if (url.pathname === "/index.html") return html();
    if (url.pathname === "/api/categories/jeans") return json({ category: { slug: "jeans", name: { fa: "جین" }, description: { fa: "d" }, isActive: true } });
    if (url.pathname === "/api/products/category/jeans") return json({ products: [] });
    throw new Error("unexpected " + url);
  };
  const res = makeRes();
  await sharePreviewHandler(makeReq({
    type: "category", id: "jeans", brand: "nike", color: ["red", "bl\nue"], q: "jeans\r\nX", size: "m", fit: "regular",
  }, "shop.example"), res);
  assert.equal(res.statusCode, 200);
  const upstream = fetched.find((url) => url.pathname === "/api/products/category/jeans");
  assert.equal(upstream.searchParams.get("brand"), "nike");
  assert.deepEqual(upstream.searchParams.getAll("color"), ["red"]);
  assert.equal(upstream.searchParams.get("fit"), "regular");
  assert.equal(upstream.searchParams.has("q"), false, "values with CR/LF are dropped");
  assert.equal(upstream.searchParams.get("size"), "m");
});

test("shop previews keep search terms containing r or n", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    fetched.push(url);
    if (url.pathname === "/index.html") return html();
    return json({ products: [] });
  };
  const res = makeRes();
  await sharePreviewHandler(makeReq({ type: "collection", id: "shop", q: "brown", category: "jeans" }, "shop.example"), res);
  assert.equal(res.statusCode, 200);
  const upstream = fetched.find((url) => url.pathname === "/api/products/search");
  assert.equal(upstream.searchParams.get("q"), "brown");
  assert.equal(upstream.searchParams.get("category"), "jeans");
});

test("a failing shell fetch never causes an unhandled rejection and still yields a 503 page", async () => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/index.html") throw new Error("shell down");
      await new Promise((resolve) => setTimeout(resolve, 30)); // API slower than the shell failure
      return json({ message: "boom" }, 500);
    };
    const res = makeRes();
    await sharePreviewHandler(makeReq({ type: "product", id: "64f123456789abcdef123456" }, "shop.example"), res);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(res.statusCode, 503);
    assert.deepEqual(rejections, []);
    assert.equal(res.headers["retry-after"], "60");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("when only the shell fails, the product page still answers with an error document instead of crashing", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/index.html") throw new Error("shell down");
    return json({ _id: "64f123456789abcdef123456", name: "Shirt", description: "d", price: 1, isActive: true, category: "jeans" });
  };
  const res = makeRes();
  await sharePreviewHandler(makeReq({ type: "product", id: "64f123456789abcdef123456" }, "shop.example"), res);
  assert.equal(res.statusCode, 503);
});

test("the last known good shell is served when a later fetch fails", async () => {
  let fail = false;
  globalThis.fetch = async () => {
    if (fail) throw new Error("shell down");
    return html();
  };
  const first = makeRes();
  await pageShellHandler(makeReq({ path: "/login" }), first);
  assert.equal(first.statusCode, 200);
  fail = true;
  const second = makeRes();
  await pageShellHandler(makeReq({ path: "/login" }), second);
  assert.equal(second.statusCode, 200);
  assert.match(second.body, /<div id="root">/);
});

test("campaign previews never render a host-escaping href", async () => {
  const campaign = (href) => ({ campaign: { slug: "sale", title: "Sale", description: "d", href, productIds: [] } });
  for (const [href, expected] of [["/\\evil.example", "/shop"], ["/\t/evil.example", "/shop"], ["//evil.example", "/shop"], ["/category/jeans", "/category/jeans"]]) {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return url.pathname === "/index.html" ? html() : json(campaign(href));
    };
    const res = makeRes();
    await sharePreviewHandler(makeReq({ type: "campaign", id: "sale" }, "shop.example"), res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('<a href="' + expected + '" style="color:#c2410c">مشاهده پیشنهاد</a>'), href);
    assert.ok(!res.body.includes("evil.example"), href);
  }
});

test("SEO function responses carry the HTML security headers and skip view counting upstream", async () => {
  let campaignHeaders;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/index.html") return html();
    campaignHeaders = init?.headers;
    return json({ campaign: { slug: "sale", title: "Sale", description: "d", href: "/shop", productIds: [] } });
  };
  const res = makeRes();
  await sharePreviewHandler(makeReq({ type: "campaign", id: "sale" }, "shop.example"), res);
  for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) assert.equal(res.headers[name.toLowerCase()], value, name);
  assert.equal(campaignHeaders["X-Skip-View-Count"], "1");

  const shellRes = makeRes();
  await pageShellHandler(makeReq({ path: "/login" }), shellRes);
  assert.equal(shellRes.headers["content-security-policy"], HTML_SECURITY_HEADERS["Content-Security-Policy"]);
});

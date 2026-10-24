import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { HTML_SECURITY_HEADERS, CONTENT_SECURITY_POLICY } from "../../seo/security-headers.js";
import { sendHtml } from "../../seo/server-utils.js";

const rootFile = (name) => fileURLToPath(new URL("../../" + name, import.meta.url));
const vercel = JSON.parse(fs.readFileSync(rootFile("vercel.json"), "utf8"));

const parseCsp = (policy) => Object.fromEntries(policy.split(";").map((part) => {
  const [name, ...values] = part.trim().split(/\s+/);
  return [name, values];
}));

test("vercel.json sends the full security header set on HTML routes", () => {
  const rule = vercel.headers.find((entry) => entry.source.includes("(?!api/)"));
  assert.ok(rule, "a header rule covering non-API paths must exist");
  const headers = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
  assert.deepEqual(headers, { ...HTML_SECURITY_HEADERS });
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(headers["Strict-Transport-Security"], /^max-age=63072000; includeSubDomains/);
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
  // The API proxy must not receive the HTML CSP (it sets its own).
  assert.equal(new RegExp("^" + rule.source + "$").test("/api/products"), false);
  assert.equal(new RegExp("^" + rule.source + "$").test("/login"), true);
});

test("CSP is restrictive and only allows the hosts the storefront needs", () => {
  const csp = parseCsp(CONTENT_SECURITY_POLICY);
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.ok(!CONTENT_SECURITY_POLICY.includes("'unsafe-eval'"));
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["form-action"], ["'self'", "https://www.zarinpal.com", "https://sandbox.zarinpal.com"]);
  assert.ok(csp["img-src"].includes("https://res.cloudinary.com"));
  assert.ok(!csp["img-src"].includes("https:") && !csp["img-src"].includes("*"));
  assert.deepEqual(csp["connect-src"], ["'self'"]);
  assert.ok(csp["style-src"].includes("https://fonts.googleapis.com"));
  assert.ok(csp["font-src"].includes("https://fonts.gstatic.com"));
});

test("frontend/index.html contains no inline executable script", () => {
  const html = fs.readFileSync(rootFile("frontend/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 2);
  for (const [, attributes, body] of scripts) {
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]?.toLowerCase();
    if (type === "application/ld+json") continue;
    assert.match(attributes, /\bsrc\s*=\s*["'][^"']+["']/i, "scripts must be external: " + attributes);
    assert.equal(body.trim(), "", "external scripts must have an empty body");
  }
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline event handlers");
  assert.ok(fs.existsSync(rootFile("frontend/public/theme-init.js")));
});

test("sendHtml applies the same security headers as vercel.json", () => {
  const headers = new Map();
  const res = {
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; },
  };
  sendHtml(res, 200, "<html></html>", { cacheControl: "no-store" });
  for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) {
    assert.equal(headers.get(name.toLowerCase()), value, name);
  }
  assert.equal(headers.get("cache-control"), "no-store");
});

test(".gitignore ignores env variants and .vercel but keeps .env.example", () => {
  const lines = fs.readFileSync(rootFile(".gitignore"), "utf8").split(/\r?\n/).map((line) => line.trim());
  assert.ok(lines.includes(".env.*"));
  assert.ok(lines.includes("!.env.example"));
  assert.ok(lines.includes(".vercel"));
});

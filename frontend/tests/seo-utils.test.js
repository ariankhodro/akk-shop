import test from "node:test";
import assert from "node:assert/strict";
import {
  absoluteUrlFor,
  buildProductStructuredData,
  buildSiteStructuredData,
  canonicalUrlFor,
  canonicalUrlForQuery,
  getSchemaAvailability,
  normalizeSeoText,
  hasIndexExcludedQuery,
} from "../src/lib/seo-utils.js";
import { getCanonicalOrigin, renderHtmlShell } from "../../seo/server-utils.js";

test("SEO text collapses whitespace without damaging Persian text", () => {
  assert.equal(normalizeSeoText("  پیراهن\n\n   آبی  ", "fallback", 100), "پیراهن آبی");
  assert.equal(normalizeSeoText("", "fallback text", 8), "fallback");
  assert.equal(normalizeSeoText("الف   ب", "", 3), "الف");
});

test("canonical URLs use the configured origin and discard query/hash duplicates", () => {
  assert.equal(
    canonicalUrlFor("/category/jeans?color=blue#products", "https://preview.example", "https://shop.example/path/"),
    "https://shop.example/category/jeans"
  );
  assert.equal(canonicalUrlFor("//evil.example/path", "https://shop.example"), "https://shop.example/");
});

test("pagination gets a page-specific canonical while filters stay excluded", () => {
  assert.equal(
    canonicalUrlForQuery("/category/jeans", { page: "2", type: "category", id: "jeans" }, "https://preview.example", "https://shop.example"),
    "https://shop.example/category/jeans?page=2"
  );
  assert.equal(
    canonicalUrlForQuery("/category/jeans", { page: "2", q: "shirt", type: "category", id: "jeans" }, "https://shop.example"),
    "https://shop.example/category/jeans"
  );
  assert.equal(hasIndexExcludedQuery({ page: "2" }), false);
  assert.equal(hasIndexExcludedQuery({ page: "2", q: "shirt" }), true);
  assert.equal(hasIndexExcludedQuery({ sort: "newest" }), false);
  assert.equal(hasIndexExcludedQuery({ sort: "priceAsc" }), true);
});

test("organization markup uses OnlineStore and only a configured valid support contact", () => {
  const withoutContact = buildSiteStructuredData("https://shop.example");
  assert.equal(withoutContact[0]["@type"], "OnlineStore");
  assert.equal(withoutContact[0].url, "https://shop.example/");
  assert.equal(withoutContact[0].contactPoint, undefined);

  const withContact = buildSiteStructuredData("https://shop.example", { supportEmail: "support@example.com" });
  assert.deepEqual(withContact[0].contactPoint, {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "support@example.com",
  });
  const invalidContact = buildSiteStructuredData("https://shop.example", { supportEmail: "not-an-email" });
  assert.equal(invalidContact[0].contactPoint, undefined);
});

test("server canonicals fail closed unless a production origin is known", () => {
  const keys = ["PUBLIC_SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_ENV"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.VERCEL_ENV = "production";
    assert.equal(getCanonicalOrigin("https://arbitrary-host.example"), "");

    process.env.VERCEL_PROJECT_PRODUCTION_URL = "shop.example";
    assert.equal(getCanonicalOrigin("https://preview.example"), "https://shop.example");
    process.env.PUBLIC_SITE_URL = "https://www.shop.example/";
    assert.equal(getCanonicalOrigin("https://preview.example"), "https://www.shop.example");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("relative images become absolute, safe HTTP(S) URLs", () => {
  assert.equal(absoluteUrlFor("/images/shirt.jpg", "https://shop.example/path"), "https://shop.example/images/shirt.jpg");
  assert.equal(absoluteUrlFor("javascript:alert(1)", "https://shop.example"), "");
  assert.equal(absoluteUrlFor("", "https://shop.example"), "");
});

test("untracked stock does not produce a falsely available Product Offer", () => {
  const schema = buildProductStructuredData({
    product: { _id: "abc123", name: "پیراهن", price: 125000, stock: null, description: "پیراهن آبی" },
    title: "پیراهن",
    description: "جزئیات محصول",
    image: "/shirt.jpg",
    canonical: "https://shop.example/product/abc123",
    origin: "https://shop.example",
  });
  assert.equal(schema.name, "پیراهن");
  assert.equal(schema.offers, undefined);
  assert.deepEqual(schema.image, ["https://shop.example/shirt.jpg"]);
});

test("tracked stock is reflected in Product Offer availability", () => {
  const schema = buildProductStructuredData({
    product: {
      _id: "abc123",
      name: "پیراهن",
      price: 125000,
      stock: 0,
      sizes: ["M", "L"],
      colors: [{ name: "آبی" }],
    },
    title: "پیراهن",
    description: "جزئیات محصول",
    canonical: "https://shop.example/product/abc123",
    origin: "https://shop.example",
  });
  assert.equal(schema.offers.priceCurrency, "IRR");
  assert.equal(schema.offers.price, 1250000);
  assert.equal(schema.offers.availability, "https://schema.org/OutOfStock");
  assert.deepEqual(schema.additionalProperty, [
    { "@type": "PropertyValue", name: "سایز", value: "M" },
    { "@type": "PropertyValue", name: "سایز", value: "L" },
    { "@type": "PropertyValue", name: "رنگ", value: "آبی" },
  ]);
});

test("variant availability reflects whether at least one combination is purchasable", () => {
  assert.equal(getSchemaAvailability({ variants: [{ stock: 0 }, { stock: 2 }] }), "https://schema.org/InStock");
  assert.equal(getSchemaAvailability({ variants: [{ stock: 0 }], stock: null }), "https://schema.org/OutOfStock");
  assert.equal(getSchemaAvailability({ isActive: false, stock: 5 }), "https://schema.org/Discontinued");
});

test("server HTML transform keeps the app bundle and injects unique Persian metadata and content", () => {
  const source = '<!doctype html><html lang="fa" dir="rtl"><head><title>default</title><meta name="description" content="old"><meta name="robots" content="index, follow"><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';
  const rendered = renderHtmlShell(source, {
    title: "پیراهن\n آبی",
    description: "توضیح محصول",
    canonical: "https://shop.example/product/abc123",
    siteOrigin: "https://shop.example",
    robots: "index, follow",
    type: "product",
    structuredData: { "@type": "Product", name: "پیراهن" },
    rootContent: "<main><h1>پیراهن آبی</h1></main>",
  });
  assert.match(rendered, /<title>پیراهن آبی \| میبا<\/title>/);
  assert.match(rendered, /<link rel="canonical" href="https:\/\/shop\.example\/product\/abc123">/);
  assert.match(rendered, /<div id="root"><main><h1>پیراهن آبی<\/h1><\/main><\/div>/);
  assert.match(rendered, /src="\/assets\/app\.js"/);
  assert.equal((rendered.match(/<title>/g) || []).length, 1);
  assert.equal((rendered.match(/name="description"/g) || []).length, 1);
});

test("server HTML escapes user-provided text before placing it in metadata", () => {
  const rendered = renderHtmlShell(
    '<html><head><title>old</title></head><body><div id="root"></div></body></html>',
    { title: 'Shirt <script>alert("x")</script>', description: "a & b", rootContent: "" }
  );
  assert.match(rendered, /Shirt &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(rendered, /content="a &amp; b"/);
  assert.doesNotMatch(rendered, /<title>Shirt <script>/);
});

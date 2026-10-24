import test from "node:test";
import assert from "node:assert/strict";
import sharePreviewHandler from "../../api/share-preview.js";
import pageShellHandler from "../../api/page-shell.js";
import robotsHandler from "../../api/robots.js";
import sitemapHandler from "../../api/sitemap.js";
import sitemapProductsHandler from "../../api/sitemap-products.js";
import sitemapStaticHandler from "../../api/sitemap-static.js";

const SHOP_ORIGIN = "https://shop.example";
const PREVIEW_ORIGIN = "https://preview.example";
const API_ORIGIN = "https://api.example";
const PRODUCT_ID = "64f123456789abcdef123456";
const SECOND_PRODUCT_ID = "64f123456789abcdef123457";
const SHELL = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>default</title><meta name="description" content="default"><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';

const product = {
  _id: PRODUCT_ID,
  name: "پیراهن آبی",
  description: "پیراهن نخی آبی با تن‌خور معمولی.",
  price: 125000,
  stock: 0,
  category: "jeans",
  image: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
  images: ["https://res.cloudinary.com/demo/image/upload/sample.jpg"],
  sizes: ["M", "L"],
  colors: [{ name: "آبی", hex: "#0000ff" }],
  variants: [],
  isActive: true,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
};

const category = {
  _id: "64f123456789abcdef123499",
  slug: "jeans",
  name: { fa: "شلوار جین", en: "Jeans" },
  description: { fa: "شلوار جین برای استفاده روزمره و استایل‌های متنوع." },
  image: "/jeans.jpg",
  isActive: true,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
};

const campaigns = [{
  _id: "64f123456789abcdef123488",
  slug: "new-sale",
  title: "پیشنهاد ویژه",
  description: "تخفیف روی محصولات منتخب.",
  image: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
  href: "/shop",
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-11-01T00:00:00.000Z",
  isActive: true,
  productIds: [product],
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
}];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body == null ? "" : String(body);
      return this;
    },
  };
}

function createRequest(path, query = {}, method = "GET") {
  return {
    method,
    headers: { host: "preview.example", "x-forwarded-proto": "https" },
    url: path,
    query,
  };
}

function mockedFetch(apiResponder) {
  return async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin === SHOP_ORIGIN && url.pathname === "/index.html") {
      return new Response(SHELL, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.origin === API_ORIGIN && url.pathname.startsWith("/api/")) {
      return apiResponder(url);
    }
    throw new Error("Unexpected test fetch URL: " + url.toString());
  };
}

async function withSeoEnvironment(apiResponder, run) {
  const keys = [
    "PUBLIC_SITE_URL",
    "API_BASE_URL",
    "VITE_API_URL",
    "VERCEL_ENV",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.PUBLIC_SITE_URL = SHOP_ORIGIN;
  process.env.API_BASE_URL = API_ORIGIN + "/api";
  delete process.env.VITE_API_URL;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  globalThis.fetch = mockedFetch(apiResponder);
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function apiResponder(url) {
  const path = url.pathname;
  if (path === "/api/products/" + PRODUCT_ID) return jsonResponse(product);
  if (path === "/api/products/" + SECOND_PRODUCT_ID) return jsonResponse(product);
  if (path === "/api/categories/jeans") return jsonResponse({ category });
  if (path === "/api/categories/t-shirts") return jsonResponse({ message: "Category not found" }, 404);
  if (path === "/api/products/category/jeans") {
    return jsonResponse({ products: [product], pagination: { page: 1, limit: 8, total: 1, pages: 1 } });
  }
  if (path === "/api/products/category/t-shirts") {
    return jsonResponse({ products: [{ ...product, category: "t-shirts" }], pagination: { page: 1, limit: 8, total: 1, pages: 1 } });
  }
  if (path === "/api/products/search") {
    return jsonResponse({ products: [product], pagination: { page: Number(url.searchParams.get("page") || 1), limit: Number(url.searchParams.get("limit") || 24), total: 2, totalPages: 2 } });
  }
  if (path === "/api/products/newest") return jsonResponse({ products: [product] });
  if (path === "/api/products/bestsellers") return jsonResponse({ products: [product] });
  if (path === "/api/products/featured") return jsonResponse([product]);
  if (path === "/api/categories") return jsonResponse({ categories: [category] });
  if (path === "/api/campaigns") return jsonResponse({ campaigns });
  if (path === "/api/campaigns/new-sale") return jsonResponse({ campaign: campaigns[0] });
  return jsonResponse({ message: "Not found" }, 404);
}

test("server SEO handlers return rendered HTML, accurate statuses, and dynamic sitemaps", async () => {
  await withSeoEnvironment(apiResponder, async () => {
    const productResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/product/" + PRODUCT_ID, { type: "product", id: PRODUCT_ID }),
      productResponse
    );
    assert.equal(productResponse.statusCode, 200);
    assert.match(productResponse.body, /<title>پیراهن آبی \| تیک بوتیک<\/title>/);
    assert.match(productResponse.body, /پیراهن نخی آبی با تن‌خور معمولی/);
    assert.match(productResponse.body, /سایزها:/);
    assert.match(productResponse.body, /<link rel="canonical" href="https:\/\/shop\.example\/product\/64f123456789abcdef123456">/);
    assert.match(productResponse.body, /"price":1250000/);
    assert.match(productResponse.body, /"availability":"https:\/\/schema\.org\/OutOfStock"/);
    assert.match(productResponse.body, /<div id="root"><main/);

    const categoryResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/category/jeans", { type: "category", id: "jeans" }),
      categoryResponse
    );
    assert.equal(categoryResponse.statusCode, 200);
    assert.match(categoryResponse.body, /شلوار جین/);
    assert.match(categoryResponse.body, /شلوار جین برای استفاده روزمره/);
    assert.match(categoryResponse.body, /پیراهن آبی/);

    const legacyCategoryResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/category/t-shirts", { type: "category", id: "t-shirts" }),
      legacyCategoryResponse
    );
    assert.equal(legacyCategoryResponse.statusCode, 200);
    assert.match(legacyCategoryResponse.body, /تی‌شرت/);
    assert.match(legacyCategoryResponse.body, /پیراهن آبی/);

    const paginatedCategoryResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/category/jeans?page=2", { type: "category", id: "jeans", page: "2" }),
      paginatedCategoryResponse
    );
    assert.equal(paginatedCategoryResponse.statusCode, 200);
    assert.match(paginatedCategoryResponse.body, /href="https:\/\/shop\.example\/category\/jeans\?page=2"/);
    assert.match(paginatedCategoryResponse.body, /name="robots" content="index, follow, max-image-preview:large"/);

    const missingProductResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/product/64f123456789abcdef123400", { type: "product", id: "64f123456789abcdef123400" }),
      missingProductResponse
    );
    assert.equal(missingProductResponse.statusCode, 404);
    assert.equal(missingProductResponse.headers["X-Robots-Tag"], "noindex, nofollow");
    assert.match(missingProductResponse.body, /صفحه موردنظر پیدا نشد/);

    const missingCategoryResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/category/missing", { type: "category", id: "missing" }),
      missingCategoryResponse
    );
    assert.equal(missingCategoryResponse.statusCode, 404);

    const shopResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/shop?q=پیراهن", { type: "collection", id: "shop", q: "پیراهن" }),
      shopResponse
    );
    assert.equal(shopResponse.statusCode, 200);
    assert.match(shopResponse.body, /پیراهن آبی/);
    assert.match(shopResponse.body, /name="robots" content="noindex, follow"/);
    assert.match(shopResponse.body, /href="https:\/\/shop\.example\/shop"/);

    const campaignListResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/campaigns", { type: "collection", id: "campaigns" }),
      campaignListResponse
    );
    assert.equal(campaignListResponse.statusCode, 200);
    assert.match(campaignListResponse.body, /پیشنهاد ویژه/);
    assert.match(campaignListResponse.body, /\/campaign\/new-sale/);

    const campaignDetailResponse = createResponse();
    await sharePreviewHandler(
      createRequest("/campaign/new-sale", { type: "campaign", id: "new-sale" }),
      campaignDetailResponse
    );
    assert.equal(campaignDetailResponse.statusCode, 200);
    assert.match(campaignDetailResponse.body, /پیشنهاد ویژه/);
    assert.match(campaignDetailResponse.body, /پیراهن آبی/);
    assert.match(campaignDetailResponse.body, /"@type":"Product"/);

    const unknownPageResponse = createResponse();
    await pageShellHandler(
      createRequest("/page-that-does-not-exist", { path: "/page-that-does-not-exist" }),
      unknownPageResponse
    );
    assert.equal(unknownPageResponse.statusCode, 404);
    assert.equal(unknownPageResponse.headers["X-Robots-Tag"], "noindex, nofollow");

    const robotsResponse = createResponse();
    await robotsHandler(createRequest("/robots.txt"), robotsResponse);
    assert.equal(robotsResponse.statusCode, 200);
    assert.match(robotsResponse.body, /Sitemap: https:\/\/shop\.example\/sitemap\.xml/);

    const sitemapIndexResponse = createResponse();
    await sitemapHandler(createRequest("/sitemap.xml"), sitemapIndexResponse);
    assert.equal(sitemapIndexResponse.statusCode, 200);
    assert.match(sitemapIndexResponse.body, /<sitemapindex/);
    assert.match(sitemapIndexResponse.body, /sitemap-static\.xml/);
    assert.match(sitemapIndexResponse.body, /sitemap-products\.xml\?page=2/);

    const sitemapProductsResponse = createResponse();
    await sitemapProductsHandler(createRequest("/sitemap-products.xml", { page: "1" }), sitemapProductsResponse);
    assert.equal(sitemapProductsResponse.statusCode, 200);
    assert.match(sitemapProductsResponse.body, /<urlset/);
    assert.match(sitemapProductsResponse.body, /https:\/\/shop\.example\/product\/64f123456789abcdef123456/);
    assert.match(sitemapProductsResponse.body, /<lastmod>2026-10-10T10:00:00\.000Z<\/lastmod>/);

    const sitemapStaticResponse = createResponse();
    await sitemapStaticHandler(createRequest("/sitemap-static.xml"), sitemapStaticResponse);
    assert.equal(sitemapStaticResponse.statusCode, 200);
    assert.match(sitemapStaticResponse.body, /https:\/\/shop\.example\/category\/jeans/);
    assert.match(sitemapStaticResponse.body, /https:\/\/shop\.example\/campaign\/new-sale/);
    assert.doesNotMatch(sitemapStaticResponse.body, /https:\/\/shop\.example\/(?:cart|login|secret-dashboard|profile|orders)(?:<|\/)/);
  });
});

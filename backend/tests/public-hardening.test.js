import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Product from "../models/product.model.js";
import Category from "../models/category.model.js";
import Order from "../models/order.model.js";
import Campaign from "../models/campaign.model.js";
import AuditLog from "../models/audit-log.model.js";
import { redis } from "../lib/redis.js";
import {
  createProduct,
  getBestsellingProducts,
  getProductsByCategory,
  getSearchedProducts,
} from "../controllers/product.controller.js";
import { getCampaignById, trackCampaignView } from "../controllers/campaign.controller.js";

const restores = [];
const stub = (target, name, value) => {
  restores.push([target, name, target[name]]);
  target[name] = value;
};
afterEach(() => {
  while (restores.length) {
    const [target, name, original] = restores.pop();
    target[name] = original;
  }
  delete process.env.CAMPAIGN_VIEWS_ON_GET;
});

const makeRes = () => ({
  statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});

// Chainable query double that records the calls made on it.
const makeQuery = (result, record = {}) => {
  const query = {
    select(value) { record.select = value; return query; },
    sort(value) { record.sort = value; return query; },
    skip(value) { record.skip = value; return query; },
    limit(value) { record.limit = value; return query; },
    maxTimeMS() { return query; },
    populate(value) { record.populate = value; return query; },
    option() { return query; },
    lean: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

let cacheWrites;
beforeEach(() => {
  cacheWrites = [];
  stub(redis, "get", async () => null);
  stub(redis, "set", async (key) => { cacheWrites.push(key); return "OK"; });
});

test("search sort uses own properties only and the public page number is capped", async () => {
  for (const sort of ["__proto__", "constructor", "toString", "hasOwnProperty", ["priceAsc"], "priceAsc"]) {
    const record = {};
    stub(Product, "find", () => makeQuery([], record));
    stub(Product, "countDocuments", () => makeQuery(0));
    const res = makeRes();
    await getSearchedProducts({ query: { sort, page: "100000", limit: "24" } }, res);
    assert.equal(res.statusCode, 200, String(sort));
    assert.ok(record.sort && typeof record.sort === "object" && !Array.isArray(record.sort), String(sort));
    assert.deepEqual(record.sort, sort === "priceAsc" ? { price: 1, _id: 1 } : { createdAt: -1, _id: -1 });
    assert.equal(record.skip, 199 * 24, "page is capped at 200");
    assert.equal(record.select, "-__v");
  }
});

test("category listing caps page numbers", async () => {
  const record = {};
  stub(Category, "findOne", () => makeQuery({ _id: "c1", slug: "shirts" }));
  stub(Category, "find", () => makeQuery([{ _id: "c1", slug: "shirts", isActive: true, ancestors: [] }]));
  stub(Product, "find", () => makeQuery([], record));
  stub(Product, "countDocuments", () => makeQuery(0));
  stub(Product, "aggregate", () => makeQuery([]));
  const res = makeRes();
  await getProductsByCategory({ params: { category: "shirts" }, query: { page: "99999", limit: "60" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(record.skip, 199 * 60);
});

test("unknown category slugs return 404 without aggregation or cache writes", async () => {
  let aggregated = 0;
  stub(Category, "findOne", () => makeQuery(null));
  stub(Product, "exists", async () => null);
  stub(Product, "aggregate", () => { aggregated += 1; return makeQuery([]); });
  stub(Product, "find", () => makeQuery([]));
  for (let index = 0; index < 50; index += 1) {
    const res = makeRes();
    await getProductsByCategory({ params: { category: "random-" + index }, query: {} }, res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(aggregated, 0);
  assert.deepEqual(cacheWrites, []);
});

test("legacy slugs that have products still work and are the only ones cached", async () => {
  stub(Category, "findOne", () => makeQuery(null));
  stub(Product, "exists", async () => ({ _id: "p1" }));
  stub(Product, "aggregate", () => makeQuery([{}]));
  stub(Product, "find", () => makeQuery([]));
  stub(Product, "countDocuments", () => makeQuery(0));
  const res = makeRes();
  await getProductsByCategory({ params: { category: "jeans" }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(cacheWrites, ["category_filter_facets_v2:jeans"]);
});

test("best-sellers never expose sales volume and use a new cache key", async () => {
  let pipeline;
  stub(Order, "aggregate", (stages) => { pipeline = stages; return makeQuery([{ _id: "p1", name: "Shirt" }]); });
  const res = makeRes();
  await getBestsellingProducts({ query: { limit: "8" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(cacheWrites, ["bestselling_products_v2:8"]);
  const tail = JSON.stringify(pipeline.slice(-3));
  assert.ok(!/mergeObjects/.test(tail));
  assert.ok(pipeline.at(-1).$project, "final stage projects fields away");
  assert.ok(pipeline.at(-2).$replaceRoot.newRoot === "$product");
});

const baseProduct = { name: "Shirt", description: "Cotton", price: 1000, category: "shirts", stock: 1 };
const createWith = async (attributes) => {
  stub(AuditLog, "create", async () => ({}));
  stub(Product, "create", async (doc) => ({ _id: "p1", ...doc }));
  const res = makeRes();
  await createProduct({ body: { ...baseProduct, attributes }, user: { _id: "u" }, get: () => "" }, res);
  return res;
};

test("free-form product attributes are size- and shape-limited", async () => {
  assert.equal((await createWith({ brand: "Acme", fabric: ["cotton"], organic: true, weight: 2 })).statusCode, 201);
  assert.equal((await createWith(Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["k" + i, "v"])))).statusCode, 400);
  assert.equal((await createWith({ nested: { deep: { deeper: [1] } } })).statusCode, 400);
  assert.equal((await createWith({ big: "x".repeat(501) })).statusCode, 400);
  assert.equal((await createWith({ "$where": "1" })).statusCode, 400);
  assert.equal((await createWith(JSON.parse('{"__proto__": "x"}'))).statusCode, 400);
});

const activeCampaign = { slug: "sale", title: "Sale", description: "", image: "", href: "/shop", productIds: [] };
const campaignReq = (headers = {}, method = "GET") => ({
  method, params: { id: "sale" }, get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? "", headers,
});

test("GET /campaigns/:id counts views by default, but not for prefetch, HEAD or server-side renderers; counters are never returned", async () => {
  let increments = 0;
  let projection;
  stub(Campaign, "findOneAndUpdate", (_filter, update) => {
    if (update?.$inc?.views) increments += 1;
    return makeQuery({ ...activeCampaign, views: 9, clicks: 3 }, { });
  });
  stub(Campaign, "findOne", () => {
    const record = {};
    const query = makeQuery({ ...activeCampaign }, record);
    projection = record;
    return query;
  });
  const human = makeRes();
  await getCampaignById(campaignReq({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/130" }), human);
  assert.equal(human.statusCode, 200);
  assert.equal(increments, 1);

  for (const headers of [{ "sec-purpose": "prefetch" }, { purpose: "prefetch" }, { "user-agent": "node" }, { "user-agent": "Googlebot/2.1" }, { "x-skip-view-count": "1" }]) {
    await getCampaignById(campaignReq(headers), makeRes());
  }
  await getCampaignById(campaignReq({}, "HEAD"), makeRes());
  assert.equal(increments, 1);
  assert.ok(projection);
});

test("public campaign projection omits views and clicks", async () => {
  const record = {};
  stub(Campaign, "findOneAndUpdate", () => makeQuery(activeCampaign, record));
  await getCampaignById(campaignReq({ "user-agent": "Mozilla/5.0 Chrome/130" }), makeRes());
  assert.ok(!/views|clicks/.test(record.select), record.select);
});

test("CAMPAIGN_VIEWS_ON_GET=false makes GET read-only and POST /view counts instead", async () => {
  process.env.CAMPAIGN_VIEWS_ON_GET = "false";
  let increments = 0;
  stub(Campaign, "findOneAndUpdate", () => { increments += 1; return makeQuery({ _id: "c1" }); });
  stub(Campaign, "findOne", () => makeQuery({ ...activeCampaign }));
  const read = makeRes();
  await getCampaignById(campaignReq({ "user-agent": "Mozilla/5.0 Chrome/130" }), read);
  assert.equal(read.statusCode, 200);
  assert.equal(increments, 0);
  const view = makeRes();
  await trackCampaignView(campaignReq({}, "POST"), view);
  assert.deepEqual(view.body, { success: true });
  assert.equal(increments, 1);
});

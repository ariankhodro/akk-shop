import test from "node:test";
import assert from "node:assert/strict";
import { isSafeInternalHref } from "../lib/internal-href.js";
import { isSafeInternalHref as seoCopy } from "../../seo/internal-href.js";
import Campaign from "../models/campaign.model.js";
import { createCampaign } from "../controllers/campaign.controller.js";

const good = ["/", "/shop", "/category/jeans?color=red&size=m", "/product/64f123456789abcdef123456", "/campaigns#top", "/category/%D9%84%D8%A8%D8%A7%D8%B3", "/category/لباس"];
const bad = [
  "", "shop", "//evil.example", "///evil.example", "/\\evil.example", "/\\\\evil.example", "\\\\evil.example",
  "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000", "/ /evil.example", "/ /evil.example",
  "https://evil.example", "http://evil.example/", "javascript:alert(1)", "data:text/html,x", "/\u007f", "/a\\b",
  "/" + "a".repeat(2100), null, undefined, 12, {}, ["/shop"],
];

test("isSafeInternalHref accepts storefront paths and rejects every host-escaping shape", () => {
  for (const value of good) assert.equal(isSafeInternalHref(value), true, String(value));
  for (const value of bad) assert.equal(isSafeInternalHref(value), false, JSON.stringify(value));
});

test("the SEO function copy behaves identically to the backend implementation", () => {
  for (const value of [...good, ...bad]) assert.equal(seoCopy(value), isSafeInternalHref(value), JSON.stringify(value));
});

test("the campaign model validator uses the same rule", () => {
  const make = (href) => new Campaign({ title: "t", href, endsAt: new Date(Date.now() + 1000) }).validateSync();
  assert.equal(make("/shop"), undefined);
  assert.ok(make("/\\evil.example")?.errors?.href);
  assert.ok(make("/\t/evil.example")?.errors?.href);
  assert.ok(make("//evil.example")?.errors?.href);
});

const makeRes = () => ({
  statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});
const campaignBody = (extra = {}) => ({
  title: "Sale", href: "/shop", endsAt: new Date(Date.now() + 86400000).toISOString(), productIds: [], ...extra,
});

test("createCampaign rejects bypass hrefs and non-ObjectId product ids with 400 before any lookup", async () => {
  for (const body of [
    campaignBody({ href: "/\\evil.example" }),
    campaignBody({ href: "/\t/evil.example" }),
    campaignBody({ href: "//evil.example" }),
    campaignBody({ productIds: [123456789012] }),
    campaignBody({ productIds: ["abcdefghijkl"] }),
    campaignBody({ productIds: [{ $ne: null }] }),
  ]) {
    const res = makeRes();
    await createCampaign({ body, user: { _id: "u1" } }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

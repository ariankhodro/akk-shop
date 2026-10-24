import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import NewsletterSubscriber, { effectiveNewsletterStatus } from "../models/newsletter-subscriber.model.js";
import {
  confirmNewsletterSubscription,
  getNewsletterSubscribers,
  showNewsletterConfirmation,
  showNewsletterUnsubscribe,
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
} from "../controllers/newsletter.controller.js";
import {
  createConfirmationToken,
  createUnsubscribeToken,
  hashToken,
  verifyUnsubscribeToken,
} from "../lib/newsletter-tokens.js";

const testUri = process.env.MONGO_TEST_URI || "";
const dbName = (() => {
  try { return new URL(testUri).pathname.replace(/^\//, "").split("?")[0]; }
  catch { return ""; }
})();
if (testUri && !/(^|[_-])test($|[_-])/i.test(dbName)) {
  throw new Error("MONGO_TEST_URI must point to a dedicated disposable database whose name includes 'test'.");
}
const dbTest = (name, fn) => test(name, { skip: testUri ? false : "MONGO_TEST_URI is not set" }, fn);

const SECRET = "x".repeat(40);
const MAIL_ENV = { RESEND_API_KEY: "re_test", EMAIL_FROM: "shop@example.com", APP_URL: "https://shop.example" };
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let sentMails;

const makeRes = () => ({
  statusCode: 200, body: undefined, headers: {}, contentType: "json",
  set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  type(value) { this.contentType = value; return this; },
  json(value) { this.body = value; return this; },
  send(value) { this.body = value; return this; },
});
const makeReq = ({ body = {}, query = {}, html = false } = {}) => ({
  body, query, accepts: () => (html ? "html" : "json"),
});
const enableMail = () => Object.assign(process.env, MAIL_ENV, { NEWSLETTER_TOKEN_SECRET: SECRET });
const disableMail = () => {
  for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "APP_URL", "FRONTEND_URL", "NEWSLETTER_TOKEN_SECRET"]) delete process.env[key];
};
const tokenFromMail = (mail) => new URL(/href="([^"]+)"/.exec(mail.html)[1]).searchParams.get("token");

before(async () => {
  if (testUri) {
    await mongoose.connect(testUri);
    await NewsletterSubscriber.init();
  }
});
beforeEach(() => {
  sentMails = [];
  globalThis.fetch = async (_url, options) => {
    sentMails.push(JSON.parse(options.body));
    return { ok: true, status: 200 };
  };
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  Object.assign(process.env, originalEnv);
  disableMail();
  if (testUri && mongoose.connection.readyState === 1) await NewsletterSubscriber.deleteMany({});
});
after(async () => {
  if (testUri && mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("signed unsubscribe tokens verify, reject tampering and fail closed without a secret", () => {
  process.env.NEWSLETTER_TOKEN_SECRET = SECRET;
  const id = "64f123456789abcdef123456";
  const token = createUnsubscribeToken(id);
  assert.equal(verifyUnsubscribeToken(token), id);
  assert.equal(verifyUnsubscribeToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A")), null);
  assert.equal(verifyUnsubscribeToken("64f123456789abcdef123457." + token.split(".")[1]), null);
  assert.equal(verifyUnsubscribeToken("garbage"), null);
  process.env.NEWSLETTER_TOKEN_SECRET = "short";
  assert.equal(createUnsubscribeToken(id), null);
  assert.equal(verifyUnsubscribeToken(token), null);
  delete process.env.NEWSLETTER_TOKEN_SECRET;
  assert.equal(verifyUnsubscribeToken(token), null);
});

test("confirmation tokens are random and only their hash is derivable", () => {
  const a = createConfirmationToken();
  const b = createConfirmationToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(hashToken(a), a);
  assert.equal(hashToken(a), hashToken(a));
});

test("legacy rows without status never count as consent", () => {
  assert.equal(effectiveNewsletterStatus({ isSubscribed: true }), "pending");
  assert.equal(effectiveNewsletterStatus({ isSubscribed: false, unsubscribedAt: new Date() }), "unsubscribed");
  assert.equal(effectiveNewsletterStatus({ status: "subscribed" }), "subscribed");
});

test("subscribe validates input", async () => {
  const bad = makeRes();
  await subscribeToNewsletter(makeReq({ body: { email: "nope", consent: true } }), bad);
  assert.equal(bad.statusCode, 400);
  const noConsent = makeRes();
  await subscribeToNewsletter(makeReq({ body: { email: "a@example.com" } }), noConsent);
  assert.equal(noConsent.statusCode, 400);
});

dbTest("without an email transport subscribe stays pending, sends nothing and stores no token", async () => {
  disableMail();
  const res = makeRes();
  await subscribeToNewsletter(makeReq({ body: { email: "Pending@Example.com", consent: true } }), res);
  assert.equal(res.statusCode, 200);
  const row = await NewsletterSubscriber.findOne({ email: "pending@example.com" }).select("+confirmTokenHash").lean();
  assert.equal(row.status, "pending");
  assert.equal(row.isSubscribed, false);
  assert.equal(row.confirmTokenHash, undefined);
  assert.equal(sentMails.length, 0);
});

dbTest("double opt-in: pending until the emailed token is confirmed with a POST; token is single use and stored hashed", async () => {
  enableMail();
  const res = makeRes();
  await subscribeToNewsletter(makeReq({ body: { email: "new@example.com", consent: true } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sentMails.length, 1);
  assert.deepEqual(sentMails[0].to, ["new@example.com"]);
  const token = tokenFromMail(sentMails[0]);

  const stored = await NewsletterSubscriber.findOne({ email: "new@example.com" }).select("+confirmTokenHash").lean();
  assert.equal(stored.status, "pending");
  assert.equal(stored.isSubscribed, false);
  assert.equal(stored.confirmTokenHash, hashToken(token));
  assert.notEqual(stored.confirmTokenHash, token);

  // Opening the link (GET) must not confirm.
  const page = makeRes();
  showNewsletterConfirmation(makeReq({ query: { token }, html: true }), page);
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<form method="post"/);
  assert.equal((await NewsletterSubscriber.findOne({ email: "new@example.com" }).lean()).status, "pending");

  const wrong = makeRes();
  await confirmNewsletterSubscription(makeReq({ query: { token: createConfirmationToken() } }), wrong);
  assert.equal(wrong.statusCode, 400);

  const confirmed = makeRes();
  await confirmNewsletterSubscription(makeReq({ query: { token }, html: true }), confirmed);
  assert.equal(confirmed.statusCode, 200);
  const active = await NewsletterSubscriber.findOne({ email: "new@example.com" }).select("+confirmTokenHash").lean();
  assert.equal(active.status, "subscribed");
  assert.equal(active.isSubscribed, true);
  assert.equal(active.confirmTokenHash, undefined);

  const replay = makeRes();
  await confirmNewsletterSubscription(makeReq({ body: { token } }), replay);
  assert.equal(replay.statusCode, 400);
});

dbTest("expired confirmation tokens are rejected", async () => {
  enableMail();
  await subscribeToNewsletter(makeReq({ body: { email: "late@example.com", consent: true } }), makeRes());
  const token = tokenFromMail(sentMails[0]);
  await NewsletterSubscriber.updateOne({ email: "late@example.com" }, { $set: { confirmTokenExpiresAt: new Date(Date.now() - 1000) } });
  const res = makeRes();
  await confirmNewsletterSubscription(makeReq({ body: { token } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal((await NewsletterSubscriber.findOne({ email: "late@example.com" }).lean()).status, "pending");
});

dbTest("repeat requests inside the cooldown window do not send more mail", async () => {
  enableMail();
  for (let index = 0; index < 4; index += 1) {
    const res = makeRes();
    await subscribeToNewsletter(makeReq({ body: { email: "flood@example.com", consent: true } }), res);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(sentMails.length, 1);
});

dbTest("an opted-out address is never re-subscribed without confirmation", async () => {
  enableMail();
  const created = await NewsletterSubscriber.create({
    email: "gone@example.com", status: "unsubscribed", isSubscribed: false, consentedAt: new Date(), unsubscribedAt: new Date(),
  });
  const res = makeRes();
  await subscribeToNewsletter(makeReq({ body: { email: "gone@example.com", consent: true } }), res);
  assert.equal(res.statusCode, 200);
  let row = await NewsletterSubscriber.findById(created._id).lean();
  assert.equal(row.status, "unsubscribed");
  assert.equal(row.isSubscribed, false);
  assert.ok(row.unsubscribedAt);
  assert.equal(sentMails.length, 1);

  // Without a transport nothing changes at all.
  disableMail();
  await subscribeToNewsletter(makeReq({ body: { email: "gone@example.com", consent: true } }), makeRes());
  row = await NewsletterSubscriber.findById(created._id).lean();
  assert.equal(row.status, "unsubscribed");

  // Only confirming the emailed link reverses the opt-out.
  const confirm = makeRes();
  await confirmNewsletterSubscription(makeReq({ body: { token: tokenFromMail(sentMails[0]) } }), confirm);
  assert.equal(confirm.statusCode, 200);
  row = await NewsletterSubscriber.findById(created._id).lean();
  assert.equal(row.status, "subscribed");
  assert.equal(row.unsubscribedAt, null);
});

dbTest("a subscribed address is not modified or mailed by a repeat subscribe", async () => {
  enableMail();
  const created = await NewsletterSubscriber.create({
    email: "ok@example.com", status: "subscribed", isSubscribed: true, consentedAt: new Date(0), confirmedAt: new Date(0),
  });
  const res = makeRes();
  await subscribeToNewsletter(makeReq({ body: { email: "ok@example.com", consent: true } }), res);
  assert.equal(res.statusCode, 200);
  const row = await NewsletterSubscriber.findById(created._id).select("+confirmTokenHash").lean();
  assert.equal(row.status, "subscribed");
  assert.equal(row.consentedAt.getTime(), 0);
  assert.equal(row.confirmTokenHash, undefined);
  assert.equal(sentMails.length, 0);
});

dbTest("unsubscribe with only an email never changes state; a signed token does", async () => {
  enableMail();
  const created = await NewsletterSubscriber.create({
    email: "victim@example.com", status: "subscribed", isSubscribed: true, consentedAt: new Date(), confirmedAt: new Date(),
  });

  const emailOnly = makeRes();
  await unsubscribeFromNewsletter(makeReq({ body: { email: "victim@example.com" } }), emailOnly);
  assert.equal(emailOnly.statusCode, 200);
  assert.equal((await NewsletterSubscriber.findById(created._id).lean()).status, "subscribed");
  // The signed link goes only to the address owner.
  assert.equal(sentMails.length, 1);
  assert.deepEqual(sentMails[0].to, ["victim@example.com"]);
  const link = new URL(/href="([^"]+)"/.exec(sentMails[0].html)[1]);
  assert.equal(link.pathname, "/api/newsletter/unsubscribe");
  const token = link.searchParams.get("token");

  // The response is identical for unknown addresses.
  const unknown = makeRes();
  await unsubscribeFromNewsletter(makeReq({ body: { email: "nobody@example.com" } }), unknown);
  assert.deepEqual(unknown.body, emailOnly.body);
  assert.equal(sentMails.length, 1);

  const forged = makeRes();
  await unsubscribeFromNewsletter(makeReq({ body: { token: created._id + "." + "A".repeat(43) } }), forged);
  assert.equal(forged.statusCode, 400);
  assert.equal((await NewsletterSubscriber.findById(created._id).lean()).status, "subscribed");

  const page = makeRes();
  showNewsletterUnsubscribe(makeReq({ query: { token }, html: true }), page);
  assert.equal(page.statusCode, 200);
  assert.equal((await NewsletterSubscriber.findById(created._id).lean()).status, "subscribed");

  const done = makeRes();
  await unsubscribeFromNewsletter(makeReq({ query: { token }, html: true }), done);
  assert.equal(done.statusCode, 200);
  const row = await NewsletterSubscriber.findById(created._id).lean();
  assert.equal(row.status, "unsubscribed");
  assert.equal(row.isSubscribed, false);
  assert.ok(row.unsubscribedAt);
});

dbTest("without a transport or secret an email-only unsubscribe changes nothing", async () => {
  disableMail();
  const created = await NewsletterSubscriber.create({
    email: "stay@example.com", status: "subscribed", isSubscribed: true, consentedAt: new Date(), confirmedAt: new Date(),
  });
  const res = makeRes();
  await unsubscribeFromNewsletter(makeReq({ body: { email: "stay@example.com" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal((await NewsletterSubscriber.findById(created._id).lean()).status, "subscribed");
  assert.equal(sentMails.length, 0);
});

dbTest("admin list reports legacy unverified rows as pending, not active", async () => {
  await NewsletterSubscriber.collection.insertOne({
    email: "legacy@example.com", isSubscribed: true, consentedAt: new Date(), unsubscribedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  await NewsletterSubscriber.create({
    email: "real@example.com", status: "subscribed", isSubscribed: true, consentedAt: new Date(), confirmedAt: new Date(),
  });
  const res = makeRes();
  await getNewsletterSubscribers({}, res);
  assert.deepEqual(res.body.summary, { total: 2, subscribed: 1, pending: 1, unsubscribed: 0 });
  const legacy = res.body.subscribers.find((row) => row.email === "legacy@example.com");
  assert.equal(legacy.status, "pending");
  assert.equal(legacy.isSubscribed, false);
  assert.equal(res.body.emailDeliveryConfigured, false);
});

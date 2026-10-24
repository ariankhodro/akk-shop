import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  classifyRequestResponse,
  classifyVerifyResponse,
  extractZarinpalCode,
  maskCardPan,
  ZARINPAL_UNPAID_TERMINAL_CODES,
} from "../lib/zarinpal-codes.js";

const dir = new URL("./fixtures/zarinpal/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name + ".json", dir), "utf8"));
const verify = (name, expectedAmountRial = 1_000_000) => {
  const { http, body } = fixture(name);
  return classifyVerifyResponse({ status: http, payload: body, expectedAmountRial });
};

test("every fixture is labelled as constructed, not recorded", () => {
  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const data = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    assert.match(data._provenance, /NOT RECORDED FROM A LIVE SANDBOX/);
  }
});

test("error codes are read from errors.code and from legacy data.code", () => {
  assert.deepEqual(extractZarinpalCode(fixture("verify-error-51").body), { code: -51, location: "errors" });
  assert.deepEqual(extractZarinpalCode(fixture("verify-legacy-data-code-51").body), { code: -51, location: "data" });
  assert.deepEqual(extractZarinpalCode(fixture("verify-success-100").body), { code: 100, location: "data" });
  assert.deepEqual(extractZarinpalCode({ data: [], errors: [] }), { code: null, location: null });
  assert.deepEqual(extractZarinpalCode(null), { code: null, location: null });
});

test("verify 100 and 101 are paid and carry masked card and fee metadata", () => {
  const paid = verify("verify-success-100");
  assert.equal(paid.outcome, "paid");
  assert.equal(paid.refId, "201");
  assert.equal(paid.cardPan, "502229******5995");
  assert.equal(paid.fee, 0);
  assert.equal(paid.feeType, "Merchant");
  assert.equal(verify("verify-already-101").outcome, "paid");
  assert.equal(verify("verify-already-101").alreadyVerified, true);
});

test("a definitive unpaid code is terminal under errors.code and under data.code", () => {
  assert.equal(verify("verify-error-51").outcome, "unpaid");
  assert.equal(verify("verify-error-54").outcome, "unpaid");
  assert.equal(verify("verify-legacy-data-code-51").outcome, "unpaid");
});

test("rate-limit, merchant, auth and unexpected codes are never terminal", () => {
  for (const code of [-9, -10, -11, -12, -15, -16, -52, -53, -55, -21, -22, -42, 7]) {
    const result = classifyVerifyResponse({ status: 200, payload: { data: [], errors: { code } }, expectedAmountRial: 10 });
    assert.equal(result.outcome, "uncertain", "code " + code);
  }
  assert.equal(verify("verify-error-12-rate-limit").outcome, "uncertain");
  assert.equal(verify("verify-error-11-merchant").outcome, "uncertain");
  assert.deepEqual([...ZARINPAL_UNPAID_TERMINAL_CODES].sort((a, b) => a - b), [-54, -51]);
});

test("amount mismatch is flagged, never paid and never unpaid", () => {
  assert.equal(verify("verify-error-50").outcome, "amount_mismatch");
  const echoed = classifyVerifyResponse({
    status: 200,
    payload: { data: { code: 100, ref_id: 5, amount: 999 }, errors: [] },
    expectedAmountRial: 1000,
  });
  assert.equal(echoed.outcome, "amount_mismatch");
  const matching = classifyVerifyResponse({
    status: 200,
    payload: { data: { code: 100, ref_id: 5, amount: 1000 }, errors: [] },
    expectedAmountRial: 1000,
  });
  assert.equal(matching.outcome, "paid");
});

test("5xx, 4xx-with-success-code, timeouts and garbage are uncertain", () => {
  assert.equal(verify("verify-http-500").outcome, "uncertain");
  assert.equal(classifyVerifyResponse({ status: 500, payload: fixture("verify-error-51").body }).outcome, "uncertain");
  assert.equal(classifyVerifyResponse({ status: 0, payload: null }).outcome, "uncertain");
  assert.equal(classifyVerifyResponse({ status: 200, payload: "<html>" }).outcome, "uncertain");
  assert.equal(classifyVerifyResponse({
    status: 403, payload: fixture("verify-success-100").body, expectedAmountRial: 1_000_000,
  }).outcome, "uncertain");
  // A success code under errors.code is not a payment confirmation.
  assert.equal(classifyVerifyResponse({ status: 200, payload: { data: [], errors: { code: 100 } } }).outcome, "uncertain");
});

test("request responses classify as accepted, rejected or ambiguous", () => {
  const ok = fixture("request-success");
  assert.deepEqual(classifyRequestResponse({ status: ok.http, payload: ok.body }),
    { outcome: "accepted", code: 100, authority: "A00000000000000000000000000000000001" });
  const rejected = fixture("request-error-9");
  assert.equal(classifyRequestResponse({ status: rejected.http, payload: rejected.body }).outcome, "rejected");
  assert.equal(classifyRequestResponse({ status: 422, payload: rejected.body }).outcome, "rejected");
  assert.equal(classifyRequestResponse({ status: 503, payload: rejected.body }).outcome, "ambiguous");
  assert.equal(classifyRequestResponse({ status: 200, payload: {} }).outcome, "ambiguous");
  assert.equal(classifyRequestResponse({ status: 200, payload: { data: { code: 100 }, errors: [] } }).outcome, "ambiguous");
});

test("card PAN is masked to first six and last four digits", () => {
  assert.equal(maskCardPan("5022291234565995"), "502229******5995");
  assert.equal(maskCardPan("502229******5995"), "502229******5995");
  assert.equal(maskCardPan("123"), "");
  assert.equal(maskCardPan(undefined), "");
});

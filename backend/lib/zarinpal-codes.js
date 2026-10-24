// Single source of truth for interpreting Zarinpal v4 responses.
// See docs/security/zarinpal-contract.md. The code table was constructed from the
// official docs as recalled by the author; it has NOT been confirmed against a live
// sandbox. Change the sets below only together with the contract doc and fixtures.

export const ZARINPAL_PAID_CODE = 100;
export const ZARINPAL_ALREADY_VERIFIED_CODE = 101;

// Definitive "this session was not paid / is not a valid paid session" answers.
// Only these may move an order to failed/expired and release stock and coupons.
export const ZARINPAL_UNPAID_TERMINAL_CODES = new Set([
  -51, // payment failed / not completed by the payer
  -54, // authority invalid (unknown, or its lifetime has passed without payment)
]);

// The gateway says the paid amount differs from the verify amount. Money may have moved:
// never mark failed, never mark paid; hold and flag for manual review.
export const ZARINPAL_AMOUNT_MISMATCH_CODES = new Set([-50]);

// Documented for operators; none of the "uncertain" codes is proof of non-payment.
export const ZARINPAL_CODE_INFO = Object.freeze({
  100: { kind: "paid", note: "verified" },
  101: { kind: "paid", note: "already verified" },
  [-9]: { kind: "uncertain", note: "validation error in the request" },
  [-10]: { kind: "uncertain", note: "invalid IP or merchant_id (merchant-side)" },
  [-11]: { kind: "uncertain", note: "merchant inactive (merchant-side)" },
  [-12]: { kind: "uncertain", note: "too many attempts / rate limit (transient)" },
  [-15]: { kind: "uncertain", note: "terminal suspended (merchant-side)" },
  [-16]: { kind: "uncertain", note: "merchant access level too low (merchant-side)" },
  [-50]: { kind: "amount_mismatch", note: "paid amount differs from verify amount" },
  [-51]: { kind: "unpaid", note: "payment failed" },
  [-52]: { kind: "uncertain", note: "unexpected provider error (transient)" },
  [-53]: { kind: "uncertain", note: "authority does not belong to this merchant (config)" },
  [-54]: { kind: "unpaid", note: "invalid authority" },
  [-55]: { kind: "uncertain", note: "transaction not found; meaning unconfirmed, treated as uncertain" },
});

const isInt = (value) => Number.isInteger(value);

// v4 reports failures as {"data":[],"errors":{"code":-51,...}} and successes as
// {"data":{"code":100,...},"errors":[]}. Older shapes put the code under data.code.
export const extractZarinpalCode = (payload) => {
  if (!payload || typeof payload !== "object") return { code: null, location: null };
  const errors = payload.errors;
  if (errors && !Array.isArray(errors) && typeof errors === "object" && isInt(errors.code)) {
    return { code: errors.code, location: "errors" };
  }
  const data = payload.data;
  if (data && !Array.isArray(data) && typeof data === "object" && isInt(data.code)) {
    return { code: data.code, location: "data" };
  }
  return { code: null, location: null };
};

export const maskCardPan = (pan) => {
  const digits = typeof pan === "string" ? pan.replace(/[^0-9*]/g, "") : "";
  if (digits.length < 10) return "";
  return `${digits.slice(0, 6)}${"*".repeat(digits.length - 10)}${digits.slice(-4)}`;
};

// outcome: paid | unpaid | amount_mismatch | uncertain
// "paid" needs HTTP 2xx, code 100/101 under data.code and, when the provider echoes an
// amount, an amount equal to the one we asked to verify. A structured terminal-unpaid
// code is trusted on HTTP 4xx too (re-verification on a later callback protects a
// wrong call); 5xx, timeouts (status 0) and unparseable bodies are always uncertain.
export const classifyVerifyResponse = ({ status = 0, payload = null, expectedAmountRial } = {}) => {
  const { code, location } = extractZarinpalCode(payload);
  const base = { code, location, refId: "", cardPan: "", fee: null, feeType: "" };
  if (code === null) return { ...base, outcome: "uncertain", reason: "unparseable_response" };
  if (status >= 500 || status === 0) return { ...base, outcome: "uncertain", reason: "http_" + status };

  if ((code === ZARINPAL_PAID_CODE || code === ZARINPAL_ALREADY_VERIFIED_CODE) && location === "data") {
    if (status < 200 || status >= 300) return { ...base, outcome: "uncertain", reason: "http_" + status };
    const data = payload.data;
    const echoed = data.amount === undefined || data.amount === null ? null : Number(data.amount);
    if (echoed !== null && (!Number.isFinite(echoed) || echoed !== expectedAmountRial)) {
      return { ...base, outcome: "amount_mismatch", reason: "echoed_amount_differs" };
    }
    const fee = data.fee === undefined || data.fee === null ? null : Number(data.fee);
    return {
      ...base,
      outcome: "paid",
      alreadyVerified: code === ZARINPAL_ALREADY_VERIFIED_CODE,
      refId: data.ref_id === undefined || data.ref_id === null ? "" : String(data.ref_id),
      cardPan: maskCardPan(data.card_pan),
      fee: Number.isFinite(fee) ? fee : null,
      feeType: typeof data.fee_type === "string" ? data.fee_type.slice(0, 40) : "",
    };
  }
  if (ZARINPAL_AMOUNT_MISMATCH_CODES.has(code)) return { ...base, outcome: "amount_mismatch", reason: "code_" + code };
  if (ZARINPAL_UNPAID_TERMINAL_CODES.has(code)) return { ...base, outcome: "unpaid", reason: "code_" + code };
  return { ...base, outcome: "uncertain", reason: "code_" + code };
};

// outcome: accepted | rejected | ambiguous. "rejected" means the provider explicitly
// refused to create a session, so releasing stock is safe. 5xx, timeouts and
// unparseable bodies stay ambiguous.
export const classifyRequestResponse = ({ status = 0, payload = null } = {}) => {
  const { code, location } = extractZarinpalCode(payload);
  if (status >= 200 && status < 300 && location === "data" && code === ZARINPAL_PAID_CODE &&
      typeof payload.data.authority === "string" && payload.data.authority) {
    return { outcome: "accepted", code, authority: payload.data.authority };
  }
  if (code !== null && code < 0 && status > 0 && status < 500) {
    return { outcome: "rejected", code, reason: "code_" + code };
  }
  return { outcome: "ambiguous", code, reason: code === null ? "unparseable_response" : "code_" + code };
};

import assert from "node:assert/strict";
import test from "node:test";
import Order from "../models/order.model.js";
import { STORE_CURRENCY, formatPrice, getCurrencyLabel } from "../../frontend/src/lib/commerce.js";

test("the storefront has exactly one configured currency", () => {
  assert.equal(STORE_CURRENCY, "IRT");
  assert.deepEqual(Order.schema.path("currency").enumValues, ["IRT"]);
  assert.equal(Order.schema.path("currency").defaultValue, "IRT");
});

test("Toman is the only displayed price format", () => {
  assert.equal(getCurrencyLabel(), "تومان");
  assert.equal(formatPrice(125000), "۱۲۵٬۰۰۰ تومان");
  assert.equal(formatPrice(Number.NaN), "—");
});

test("Zarinpal is the only permitted order payment provider", () => {
  assert.deepEqual(Order.schema.path("paymentProvider").enumValues, ["zarinpal"]);
  assert.equal(Order.schema.path("paymentProvider").defaultValue, "zarinpal");
});

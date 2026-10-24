import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDigits, toLatinDigits } from "../src/lib/normalize-digits.js";
import { normalizePersianText } from "../src/lib/persian-search.js";

test("normalizeDigits converts Persian, Arabic-Indic and full-width digits", () => {
  assert.equal(normalizeDigits("۰۹۱۲۳۴۵۶۷۸۹"), "09123456789");
  assert.equal(normalizeDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(normalizeDigits("１２３"), "123");
  assert.equal(normalizeDigits(null), "");
  assert.equal(toLatinDigits("TIK۲۰"), "TIK20");
});

test("normalizePersianText folds Arabic letters and strips diacritics, tatweel and zero-width marks", () => {
  assert.equal(normalizePersianText("كتاب"), "کتاب");
  assert.equal(normalizePersianText("علي"), "علی");
  assert.equal(normalizePersianText("مُحَمَّد"), "محمد");
  assert.equal(normalizePersianText("کــتاب"), "کتاب");
  assert.equal(normalizePersianText("می‌خواهم"), "می خواهم");
  assert.equal(normalizePersianText("ab​c"), "abc");
  assert.equal(normalizePersianText("  شلوار ۲۰ - جین  "), "شلوار 20 جین");
});

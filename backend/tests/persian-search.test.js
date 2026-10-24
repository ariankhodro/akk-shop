import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNormalizedProductSearchText,
  escapeSearchRegex,
  normalizePersianText,
} from "../lib/persian-search.js";
import { normalizePersianText as normalizeFrontendPersianText } from "../../frontend/src/lib/persian-search.js";

test("normalizes Arabic/Persian letter variants and diacritics", () => {
  assert.equal(normalizePersianText("ي كِتاب"), "ی کتاب");
  assert.equal(normalizePersianText("آذَرْبایجان"), "اذربایجان");
});

test("normalizes Persian and Arabic digits", () => {
  assert.equal(normalizePersianText("قیمت ۱۲۳"), "قیمت 123");
  assert.equal(normalizePersianText("قیمت ١٢٣"), "قیمت 123");
});

test("treats zero-width non-joiners as word boundaries", () => {
  assert.equal(normalizePersianText("کت‌و‌شلوار"), "کت و شلوار");
  assert.equal(normalizePersianText("می‌خوام"), "می خوام");
});

test("includes localized category aliases and product options in the search text", () => {
  const normalized = buildNormalizedProductSearchText({
    name: "تی‌شرت ساده",
    description: "لباس روزمره",
    category: "t-shirts",
    sizes: ["XL"],
    colors: [{ name: "آبی" }],
    variants: [{ size: "XL", color: "آبی" }],
  });
  assert.match(normalized, /تی شرت/);
  assert.match(normalized, /t shirts/);
  assert.match(normalized, new RegExp(escapeSearchRegex(normalizePersianText("آبی"))));
  assert.match(normalized, /xl/);
});

test("escapes regex metacharacters supplied in search text", () => {
  const expression = new RegExp(escapeSearchRegex("test.()"));
  assert.equal(expression.test("test.()"), true);
  assert.equal(expression.test("testXYZ"), false);
});

test("frontend and backend normalize Persian search text identically", () => {
  const inputs = [
    "ي كِتاب",
    "آذَرْبایجان",
    "قیمت ۱۲۳",
    "قیمت ١٢٣",
    "کت‌و‌شلوار",
    "می‌خوام",
    "تی‌شرت آبی XL",
  ];
  for (const input of inputs) {
    assert.equal(normalizePersianText(input), normalizeFrontendPersianText(input), input);
  }
});

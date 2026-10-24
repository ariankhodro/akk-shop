import test from "node:test";
import assert from "node:assert/strict";
import {
  isWholesaleViewer, maxLineQuantityFor, presentProductForViewer, stripWholesaleFields, unitPriceFor, wholesaleUnitPrice,
} from "../lib/pricing.js";
import { normalizePartFields, normalizeWholesaleTerms } from "../lib/part-fields.js";

const wholesale = (discountPercent = 0, extra = {}) => ({ role: "customer", accountType: "wholesale", isActive: true, wholesaleProfile: { discountPercent }, ...extra });
const product = { _id: "p1", price: 100_000, wholesalePrice: 80_000, wholesaleMinQuantity: 5 };

test("only active non-admin wholesale accounts are wholesale viewers", () => {
  assert.equal(isWholesaleViewer(null), false);
  assert.equal(isWholesaleViewer({ accountType: "retail" }), false);
  assert.equal(isWholesaleViewer(wholesale(0, { isActive: false })), false);
  assert.equal(isWholesaleViewer(wholesale(0, { role: "admin" })), false);
  assert.equal(isWholesaleViewer(wholesale()), true);
  assert.equal(maxLineQuantityFor(null), 100);
  assert.equal(maxLineQuantityFor(wholesale()), 1000);
});

test("retail viewers always pay the retail price", () => {
  assert.equal(unitPriceFor(product, null, 50), 100_000);
  assert.equal(unitPriceFor(product, { accountType: "retail" }, 50), 100_000);
});

test("wholesale price applies from the minimum quantity, with the account discount on top", () => {
  assert.equal(unitPriceFor(product, wholesale(), 4), 100_000);
  assert.equal(unitPriceFor(product, wholesale(), 5), 80_000);
  assert.equal(unitPriceFor(product, wholesale(10), 5), 72_000);
  // No wholesale price: the discount applies to the retail price.
  assert.equal(unitPriceFor({ price: 1001 }, wholesale(10), 1), 901);
});

test("wholesale prices are whole Toman and never above retail", () => {
  assert.equal(wholesaleUnitPrice({ price: 999, wholesalePrice: 5000 }, wholesale()), 999);
  assert.ok(Number.isSafeInteger(wholesaleUnitPrice({ price: 333, wholesalePrice: 333 }, wholesale(33.33))));
  assert.equal(wholesaleUnitPrice(product, wholesale(500)), 40_000, "discount is capped at 50%");
});

test("confidential fields never reach non-wholesale viewers", () => {
  assert.deepEqual(Object.keys(stripWholesaleFields(product)).sort(), ["_id", "price"]);
  const retail = presentProductForViewer(product, null);
  assert.equal(retail.wholesalePrice, undefined);
  assert.equal(retail.wholesaleUnitPrice, undefined);
  const shown = presentProductForViewer(product, wholesale(10));
  assert.equal(shown.wholesalePrice, undefined, "raw catalogue wholesale price stays on the server");
  assert.equal(shown.wholesaleUnitPrice, 72_000);
  assert.equal(shown.wholesaleMinQuantity, 5);
});

test("part fields are normalised and validated", () => {
  const ok = normalizePartFields({
    sku: " a11-1109111 ", oemNumbers: "A11-1109111, ۱۲۳۴۵۶", brand: "Chery", quality: "genuine", warrantyMonths: "۶",
    fitments: [{ make: "چری", model: "تیگو ۵", yearFrom: "2015", yearTo: 2020 }, { make: "چری", model: "تیگو ۵", yearFrom: 2015, yearTo: 2020 }],
  });
  assert.equal(ok.values.sku, "A11-1109111");
  assert.deepEqual(ok.values.oemNumbers, ["A11-1109111", "123456"]);
  assert.equal(ok.values.warrantyMonths, 6);
  assert.equal(ok.values.fitments.length, 1, "duplicates are dropped");
  assert.ok(normalizePartFields({ sku: "<script>" }).error);
  assert.ok(normalizePartFields({ quality: "fake" }).error);
  assert.ok(normalizePartFields({ fitments: [{ make: "" }] }).error);
  assert.ok(normalizePartFields({ fitments: [{ make: "JAC", yearFrom: 2020, yearTo: 2010 }] }).error);
  assert.ok(normalizePartFields({ fitments: { $gt: "" } }).error);
  assert.ok(normalizeWholesaleTerms({ wholesalePrice: 2000 }, 1000).error, "wholesale above retail is rejected");
  assert.ok(normalizeWholesaleTerms({ wholesalePrice: 10.5 }, 1000).error);
  assert.deepEqual(normalizeWholesaleTerms({ wholesalePrice: "", wholesaleMinQuantity: "" }, 1000).values, { wholesalePrice: null, wholesaleMinQuantity: 1 });
});

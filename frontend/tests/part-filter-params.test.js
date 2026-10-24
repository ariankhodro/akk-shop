import test from "node:test";
import assert from "node:assert/strict";
import { applyPartFilterPatch, readPartFilters } from "../src/lib/part-filter-params.js";
import { effectiveUnitPrice, fitmentSummary, formatFitment, lineTotal, wholesaleOffer } from "../src/lib/commerce.js";

test("part filters round-trip through the URL and reset pagination", () => {
  const start = new URLSearchParams("q=pad&page=3");
  const next = applyPartFilterPatch(start, { make: "چری", model: "تیگو ۵", quality: ["genuine", "oem"], inStock: true });
  assert.equal(next.get("page"), null);
  assert.equal(next.get("q"), "pad");
  assert.deepEqual(readPartFilters(next), { make: "چری", model: "تیگو ۵", year: "", quality: ["genuine", "oem"], partBrand: [], inStock: true });
  const cleared = applyPartFilterPatch(next, { make: "", inStock: false });
  assert.equal(cleared.get("model"), null, "a model without a make is dropped");
  assert.equal(cleared.get("inStock"), null);
});

test("effective price follows the wholesale threshold and never applies to retail viewers", () => {
  const retail = { price: 1000, wholesaleUnitPrice: 700, wholesaleMinQuantity: 5 };
  assert.equal(effectiveUnitPrice(retail, 10), 1000, "no pricingTier: retail");
  const wholesale = { ...retail, pricingTier: "wholesale" };
  assert.equal(effectiveUnitPrice(wholesale, 4), 1000);
  assert.equal(effectiveUnitPrice(wholesale, 5), 700);
  assert.equal(lineTotal({ ...wholesale, quantity: 6 }), 4200);
  assert.equal(wholesaleOffer({ ...wholesale, wholesaleUnitPrice: 1000 }), null, "no offer when not cheaper");
});

test("fitments are summarised for cards and tables", () => {
  const fitments = [{ make: "چری", model: "تیگو ۵", yearFrom: 2015, yearTo: 2020 }, { make: "ام‌وی‌ام", model: "X55" }, { make: "جک", model: "J5" }];
  assert.equal(formatFitment(fitments[0]), "چری تیگو ۵ (2015–2020)");
  assert.match(fitmentSummary(fitments), /^چری تیگو ۵، ام‌وی‌ام X55 و ۱ خودروی دیگر$/);
  assert.equal(fitmentSummary([]), "");
});

test("quick-order text is parsed into merged part lines", async () => {
  const { parseQuickOrder } = await import("../src/lib/quick-order.js");
  const rows = parseQuickOrder("T11-3501080  10\nt11 3501080, ۲\nA11-1109111\n\nab\n481H-1012010\t50");
  assert.deepEqual(rows, [
    { code: "T11-3501080", key: "t113501080", quantity: 12 },
    { code: "A11-1109111", key: "a111109111", quantity: 1 },
    { code: "481H-1012010", key: "481h1012010", quantity: 50 },
  ]);
});

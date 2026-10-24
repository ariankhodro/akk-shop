import test from "node:test";
import assert from "node:assert/strict";
import { getKnownProductStock, hasConfiguredInventory } from "../lib/inventory-stock.js";

test("null, missing, and empty stock remain unknown instead of becoming zero", () => {
  assert.equal(getKnownProductStock({ stock: null }), null);
  assert.equal(getKnownProductStock({}), null);
  assert.equal(getKnownProductStock({ stock: "" }), null);
});

test("known product stock is preserved, including an actual zero", () => {
  assert.equal(getKnownProductStock({ stock: 0 }), 0);
  assert.equal(getKnownProductStock({ stock: "4" }), null);
});

test("variant totals stay unknown until every variant quantity is configured", () => {
  assert.equal(getKnownProductStock({ variants: [{ stock: 2 }, { stock: null }] }), null);
  assert.equal(getKnownProductStock({ variants: [{ stock: 2 }, { stock: 3 }] }), 5);
  assert.equal(getKnownProductStock({ variants: [{ stock: "2" }, { stock: 3 }] }), null);
  assert.equal(getKnownProductStock({ variants: [], stock: 4 }), 4);
});


test("checkout inventory is configured only for explicit non-negative integer quantities", () => {
  assert.equal(hasConfiguredInventory({ stock: 0 }), true);
  assert.equal(hasConfiguredInventory({ stock: 3 }), true);
  assert.equal(hasConfiguredInventory({ stock: null }), false);
  assert.equal(hasConfiguredInventory({}), false);
  assert.equal(hasConfiguredInventory({ stock: 1.5 }), false);
  assert.equal(hasConfiguredInventory({ stock: -1 }), false);
  assert.equal(hasConfiguredInventory({ stock: "3" }), false);
});

test("all variant quantities must be configured before checkout is allowed", () => {
  assert.equal(hasConfiguredInventory({ stock: null, variants: [{ stock: 2 }, { stock: 0 }] }), true);
  assert.equal(hasConfiguredInventory({ stock: null, variants: [{ stock: 2 }, { stock: null }] }), false);
  assert.equal(hasConfiguredInventory({ variants: [{ stock: 2 }, {}] }), false);
});

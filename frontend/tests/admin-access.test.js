import test from "node:test";
import assert from "node:assert/strict";
import { TAB_PERMISSIONS, canOpenTab, hasAnyPermission } from "../src/lib/admin-access.js";

test("no permissions, malformed lists and unknown tabs open nothing (deny by default)", () => {
  for (const permissions of [null, undefined, [], "orders.manage", ["*"], {}]) {
    for (const tab of Object.keys(TAB_PERMISSIONS)) assert.equal(canOpenTab(permissions, tab), false, `${JSON.stringify(permissions)} ${tab}`);
  }
  assert.equal(canOpenTab(["orders.manage"], "__proto__"), false);
  assert.equal(canOpenTab(["orders.manage"], "constructor"), false);
});

test("tabs follow the server permission table", () => {
  assert.equal(canOpenTab(["orders.manage"], "orders"), true);
  assert.equal(canOpenTab(["orders.manage"], "analytics"), false);
  assert.equal(canOpenTab(["reports.view"], "dashboard"), true, "analysts see the overview");
  assert.equal(canOpenTab(["marketing.manage"], "create"), false);
  assert.equal(canOpenTab(["refunds.manage"], "service-cases"), true);
  assert.equal(canOpenTab(["wholesale.manage"], "customers"), true, "wholesale managers reach the customer accounts tab");
  assert.equal(canOpenTab(["wholesale.manage"], "products"), false);
  assert.equal(hasAnyPermission(["a"], ["b", "a"]), true);
});

test("UI tab permissions and role presets only reference permissions the server knows", async () => {
  const { PERMISSIONS } = await import("../../backend/lib/rbac.js");
  for (const [tab, required] of Object.entries(TAB_PERMISSIONS)) {
    for (const permission of required) assert.ok(PERMISSIONS.includes(permission), `${tab} -> ${permission}`);
  }
});

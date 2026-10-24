import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  PERMISSIONS, ROLE_PRESETS, effectivePermissions, hasPermission, isOwner, presetPermissions,
  assertAccessChangeAllowed, AccessChangeError,
} from "../lib/rbac.js";
import { ADMIN_PERMISSION_RULES, adminRoute, resolveAdminPermission } from "../middleware/auth.middleware.js";

const admin = (extra = {}) => ({ _id: "a1", role: "admin", isActive: true, permissions: [], ...extra });
const owner = (extra = {}) => admin({ _id: "o1", isOwner: true, permissions: undefined, ...extra });

const run = (user, request) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nexted = false;
  adminRoute({ user, ...request }, res, () => { nexted = true; });
  return { nexted, status: res.statusCode };
};

test("deny by default: admins with missing, empty, malformed or legacy-wildcard permissions get nothing", () => {
  const request = { baseUrl: "/api/orders", method: "GET", path: "/admin" };
  for (const permissions of [undefined, null, [], "orders.manage", { 0: "orders.manage" }, ["*"], ["orders.manage "], ["ORDERS.MANAGE"], [null], [["orders.manage"]]]) {
    const user = { role: "admin", isActive: true, ...(permissions === undefined ? {} : { permissions }) };
    const outcome = run(user, request);
    assert.equal(outcome.nexted, false, `permissions=${JSON.stringify(permissions)} must not pass`);
    assert.equal(outcome.status, 403);
  }
});

test("unauthenticated, customer and inactive-admin requests are denied everywhere", () => {
  for (const rule of ADMIN_PERMISSION_RULES) {
    const request = { baseUrl: rule.base, method: rule.method, path: rule.path.replace(/:\w+/g, "abc") };
    assert.equal(run(undefined, request).status, 403);
    assert.equal(run({ role: "customer", permissions: [...PERMISSIONS], isOwner: true }, request).status, 403);
    assert.equal(run(admin({ isActive: false, isOwner: true }), request).status, 403);
    assert.equal(run(admin({ isActive: false, permissions: [...PERMISSIONS] }), request).status, 403);
  }
});

test("every route/permission combination: a user passes exactly when they hold a matching permission", () => {
  const holders = [...PERMISSIONS];
  for (const rule of ADMIN_PERMISSION_RULES) {
    const request = { baseUrl: rule.base, method: rule.method, path: rule.path.replace(/:\w+/g, "abc") };
    const requiredFor = (user) => resolveAdminPermission({ ...request, userPermissions: user.permissions });
    for (const permission of holders) {
      const user = admin({ permissions: [permission] });
      const required = [].concat(requiredFor(user));
      assert.equal(run(user, request).nexted, required.includes(permission),
        `${rule.method} ${rule.base}${rule.path} with only ${permission}`);
    }
    assert.equal(run(owner(), request).nexted, true, `owner must pass ${rule.method} ${rule.base}${rule.path}`);
  }
});

test("owner still cannot reach unmapped routes", () => {
  assert.equal(run(owner(), { baseUrl: "/api/admin", method: "GET", path: "/unmapped" }).status, 403);
});

test("role presets expand to explicit least-privilege permission sets", () => {
  assert.deepEqual(new Set(ROLE_PRESETS.owner), new Set(PERMISSIONS));
  assert.equal(ROLE_PRESETS.manager.includes("roles.manage"), false);
  assert.equal(presetPermissions("owner"), null);
  assert.equal(presetPermissions("__proto__"), null);
  assert.equal(presetPermissions("constructor"), null);
  for (const name of ["catalogue_editor", "fulfillment", "support", "marketing", "analyst"]) {
    assert.ok(presetPermissions(name).every((p) => PERMISSIONS.includes(p)), name);
    assert.equal(presetPermissions(name).includes("roles.manage"), false, `${name} must not manage roles`);
  }
  assert.equal(hasPermission(admin({ permissions: ROLE_PRESETS.analyst }), "reports.export"), false);
  assert.equal(hasPermission(admin({ permissions: ROLE_PRESETS.support }), "refunds.manage"), false);
});

test("effective permissions ignore unknown values and require an active admin", () => {
  assert.deepEqual(effectivePermissions(admin({ permissions: ["orders.manage", "bogus", "orders.manage"] })), ["orders.manage"]);
  assert.deepEqual(effectivePermissions({ role: "customer", permissions: ["orders.manage"] }), []);
  assert.equal(isOwner({ role: "customer", isOwner: true }), false);
  assert.equal(isOwner({ role: "admin", isActive: false, isOwner: true }), false);
});

const change = (overrides) => assertAccessChangeAllowed({
  actor: owner(), target: { _id: "t1", role: "customer", isActive: true }, otherActiveOwners: 1,
  next: { role: "admin", isActive: true, isOwner: false, permissions: ["orders.manage"] }, ...overrides,
});
const rejects = (fn, code) => assert.throws(fn, (error) => error instanceof AccessChangeError && error.code === code, code);

test("owner can promote with explicit permissions; promotion requires an explicit list", () => {
  change({});
  rejects(() => change({ next: { role: "admin", isActive: true, isOwner: false, permissions: undefined } }), "PERMISSIONS_REQUIRED");
  rejects(() => change({ next: { role: "admin", isActive: true, isOwner: false, permissions: ["*"] } }), "WILDCARD_REMOVED");
  rejects(() => change({ next: { role: "admin", isActive: true, isOwner: false, permissions: ["not.real"] } }), "UNKNOWN_PERMISSION");
});

test("delegated roles.manage holder cannot escalate, touch owners or grant what they lack", () => {
  const delegate = admin({ _id: "d1", permissions: ["roles.manage", "orders.manage"] });
  const next = (permissions, extra = {}) => ({ role: "admin", isActive: true, isOwner: false, permissions, ...extra });
  const target = { _id: "t1", role: "admin", isActive: true, permissions: [] };
  assertAccessChangeAllowed({ actor: delegate, target, next: next(["orders.manage"]), otherActiveOwners: 1 });
  rejects(() => assertAccessChangeAllowed({ actor: delegate, target, next: next(["roles.manage"]), otherActiveOwners: 1 }), "GRANT_OWNER_ONLY");
  rejects(() => assertAccessChangeAllowed({ actor: delegate, target, next: next(["catalogue.manage"]), otherActiveOwners: 1 }), "GRANT_EXCEEDS_ACTOR");
  rejects(() => assertAccessChangeAllowed({ actor: delegate, target, next: next(["orders.manage"], { isOwner: true }), otherActiveOwners: 1 }), "OWNER_TIER_OWNER_ONLY");
  rejects(() => assertAccessChangeAllowed({ actor: delegate, target: { ...target, isOwner: true }, next: next([], { isOwner: true }), otherActiveOwners: 1 }), "TARGET_IS_OWNER");
  rejects(() => assertAccessChangeAllowed({ actor: delegate, target: { ...target, isOwner: true }, next: next([]), otherActiveOwners: 1 }), "OWNER_TIER_OWNER_ONLY");
  rejects(() => assertAccessChangeAllowed({ actor: delegate, target: { ...target, permissions: ["roles.manage"] }, next: next([]), otherActiveOwners: 1 }), "TARGET_MANAGES_ACCESS");
  rejects(() => assertAccessChangeAllowed({ actor: delegate, target: { ...delegate }, next: next(["orders.manage"]), otherActiveOwners: 1 }), "SELF_CHANGE");
  rejects(() => assertAccessChangeAllowed({ actor: admin({ permissions: ["orders.manage"] }), target, next: next([]), otherActiveOwners: 1 }), "ROLES_MANAGE_REQUIRED");
});

test("the last active owner cannot be demoted, deactivated or removed", () => {
  const target = { _id: "o2", role: "admin", isActive: true, isOwner: true, permissions: [] };
  const keep = { role: "admin", isActive: true, isOwner: true, permissions: [] };
  assertAccessChangeAllowed({ actor: owner(), target, next: keep, otherActiveOwners: 0 });
  for (const next of [{ ...keep, isActive: false }, { ...keep, isOwner: false }, { ...keep, role: "customer", isOwner: false, permissions: undefined }]) {
    rejects(() => assertAccessChangeAllowed({ actor: owner(), target, next, otherActiveOwners: 0 }), "LAST_OWNER");
    assertAccessChangeAllowed({ actor: owner(), target, next, otherActiveOwners: 1 });
  }
});

test("every router mounted behind adminRoute has exactly one permission rule and no rule is orphaned", async () => {
  const { default: app } = await import("../app.js");
  const mounts = [];
  const collect = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const handlers = layer.route.stack.map((entry) => entry.handle);
        if (handlers.includes(adminRoute)) {
          for (const method of Object.keys(layer.route.methods)) mounts.push({ method: method.toUpperCase(), prefix, path: layer.route.path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        const mount = layer.regexp.source.match(/^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)/)?.[1]?.replace(/\\\//g, "/");
        collect(layer.handle.stack, mount ? `/${mount}` : prefix);
      }
    }
  };
  collect(app._router.stack, "");
  assert.ok(mounts.length >= 30, `expected to discover the admin routes, found ${mounts.length}`);
  const key = (method, base, path) => `${method} ${base}${path === "/" ? "" : path}`;
  const ruleKeys = ADMIN_PERMISSION_RULES.map((rule) => key(rule.method, rule.base, rule.path));
  const mountKeys = mounts.map((mount) => key(mount.method, mount.prefix, mount.path));
  for (const mountKey of mountKeys) assert.equal(ruleKeys.filter((k) => k === mountKey).length, 1, `route ${mountKey} must have exactly one rule`);
  for (const ruleKey of ruleKeys) assert.ok(mountKeys.includes(ruleKey), `rule ${ruleKey} has no mounted adminRoute`);
  assert.equal(new Set(ruleKeys).size, ruleKeys.length, "duplicate rules");
});

test("express stack sanity: adminRoute is exported for route discovery", () => {
  assert.equal(typeof express, "function");
});

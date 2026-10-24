import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import mongoose from "mongoose";
import { planAdminMigration } from "../lib/admin-migration.js";
import { ROLE_PRESETS } from "../lib/rbac.js";
import { assertDisposableDatabase, withDatabase } from "./helpers/http-app.js";

test("planner never grants owner or full access to legacy administrators", () => {
  const plan = planAdminMigration([
    { _id: 1, email: "legacy@x.com", role: "admin" },
    { _id: 2, email: "wild@x.com", role: "admin", permissions: ["*", "reports.view"] },
    { _id: 3, email: "ok@x.com", role: "admin", permissions: ["orders.manage"] },
    { _id: 4, email: "dirty@x.com", role: "admin", permissions: ["orders.manage", "bogus"] },
    { _id: 5, email: "cust@x.com", role: "customer" },
    { _id: 6, email: "bad@x.com", role: "admin", permissions: "orders.manage" },
  ]);
  const byEmail = Object.fromEntries(plan.map((change) => [change.email, change]));
  assert.deepEqual(byEmail["legacy@x.com"].after.permissions, []);
  assert.equal(byEmail["wild@x.com"].after.permissions.includes("roles.manage"), false);
  assert.deepEqual(new Set(byEmail["wild@x.com"].after.permissions), new Set(ROLE_PRESETS.manager));
  assert.equal(byEmail["ok@x.com"], undefined, "valid explicit lists are untouched");
  assert.deepEqual(byEmail["dirty@x.com"].after.permissions, ["orders.manage"]);
  assert.deepEqual(byEmail["bad@x.com"].after.permissions, []);
  assert.equal(byEmail["cust@x.com"], undefined);
  assert.ok(plan.every((change) => !("isOwner" in change.after)));
});

test("explicit assignments are the only way legacy admins gain access; owner cannot be assigned", () => {
  const admins = [{ _id: 1, email: "legacy@x.com", role: "admin" }];
  assert.deepEqual(planAdminMigration(admins, { "legacy@x.com": "support" })[0].after.permissions, ROLE_PRESETS.support);
  assert.throws(() => planAdminMigration(admins, { "legacy@x.com": "owner" }));
  assert.throws(() => planAdminMigration(admins, { "legacy@x.com": "nope" }));
});

const mongoBase = process.env.MONGO_TEST_URI || "";
assertDisposableDatabase(mongoBase);
const uri = mongoBase ? withDatabase(mongoBase, "admin_migration_test") : "";
const dbOpts = { skip: uri ? false : "MONGO_TEST_URI is required" };

before(async () => {
  if (!uri) return;
  await mongoose.connect(uri);
});
after(async () => {
  if (!uri) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("migration script: dry-run changes nothing, apply is idempotent, bootstrap creates the first owner", dbOpts, async () => {
  const raw = mongoose.connection.collection("users");
  const hash = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
  await raw.insertMany([
    { name: "Legacy Admin", email: "legacy@example.com", password: hash, role: "admin", isActive: true },
    { name: "Wildcard Admin", email: "wild@example.com", password: hash, role: "admin", permissions: ["*"], isActive: true },
    { name: "Customer", email: "cust@example.com", password: hash, role: "customer", isActive: true },
  ]);
  const env = { ...process.env, MONGO_URI: uri };
  const run = (script, args, extra = {}) => spawnSync("node", [script, ...args], { env: { ...env, ...extra }, encoding: "utf8" });

  const dry = run("../scripts/migrate-admin-permissions.mjs", []);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /needing change: 2/);
  assert.match(dry.stderr, /no active owner exists/);
  assert.equal((await raw.findOne({ email: "legacy@example.com" })).permissions, undefined);

  const refused = run("../scripts/migrate-admin-permissions.mjs", ["--apply"]);
  assert.notEqual(refused.status, 0, "apply requires an explicit backup confirmation");

  const applied = run("../scripts/migrate-admin-permissions.mjs", ["--apply", "--assign", "legacy@example.com=support"], { BACKUP_CONFIRMED: "yes" });
  assert.equal(applied.status, 0, applied.stderr);
  const legacy = await raw.findOne({ email: "legacy@example.com" });
  assert.deepEqual(legacy.permissions.sort(), [...ROLE_PRESETS.support].sort());
  assert.equal(legacy.tokenVersion, 1);
  const wild = await raw.findOne({ email: "wild@example.com" });
  assert.equal(wild.permissions.includes("*"), false);
  assert.equal(wild.isOwner, undefined);

  const again = run("../scripts/migrate-admin-permissions.mjs", ["--apply", "--assign", "legacy@example.com=support"], { BACKUP_CONFIRMED: "yes" });
  assert.match(again.stdout, /needing change: 0/);
  assert.equal((await raw.findOne({ email: "legacy@example.com" })).tokenVersion, 1, "second run is a no-op");

  const bootDry = run("../scripts/bootstrap-owner.mjs", ["--email", "cust@example.com"]);
  assert.match(bootDry.stdout, /Dry run/);
  assert.equal((await raw.findOne({ email: "cust@example.com" })).isOwner, undefined);
  const boot = run("../scripts/bootstrap-owner.mjs", ["--email", "cust@example.com", "--apply"], { BACKUP_CONFIRMED: "yes" });
  assert.equal(boot.status, 0, boot.stderr);
  const owner = await raw.findOne({ email: "cust@example.com" });
  assert.equal(owner.isOwner, true);
  assert.equal(owner.role, "admin");
  const second = run("../scripts/bootstrap-owner.mjs", ["--email", "wild@example.com", "--apply"], { BACKUP_CONFIRMED: "yes" });
  assert.notEqual(second.status, 0, "a second owner needs --allow-additional");
  assert.equal(await mongoose.connection.collection("auditlogs").countDocuments({ action: "owner.bootstrapped" }), 1);
  const missing = run("../scripts/bootstrap-owner.mjs", ["--email", "nobody@example.com", "--apply"], { BACKUP_CONFIRMED: "yes" });
  assert.notEqual(missing.status, 0);
});

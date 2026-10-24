import test from "node:test";
import assert from "node:assert/strict";
import { withAdministratorAccessLock, AdministratorAccessLockError } from "../lib/admin-permissions.js";
import { adminRoute } from "../middleware/auth.middleware.js";

test("unknown admin routes and methods fail closed for wildcard and legacy admins", () => {
  for (const permissions of [["*"], undefined]) {
    const req = {
      baseUrl: "/api/admin",
      path: "/unmapped",
      method: "GET",
      user: { role: "admin", ...(permissions === undefined ? {} : { permissions }) },
    };
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    let nextCalled = false;
    adminRoute(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { message: "Access denied" });
  }
});

test("route permissions require an exact method and route shape", () => {
  const allowedResponse = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let allowedNext = false;
  adminRoute({
    baseUrl: "/api/admin", method: "GET", path: "/customers",
    user: { role: "admin", permissions: ["roles.manage"] },
  }, allowedResponse, () => { allowedNext = true; });
  assert.equal(allowedNext, true);

  for (const badRequest of [
    { baseUrl: "/api/admin", method: "GET", path: "/customers-archive" },
    { baseUrl: "/api/admin", method: "POST", path: "/inventory" },
    { baseUrl: "/api/products", method: "PATCH", path: "/not-an-endpoint/hidden" },
  ]) {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    let calledNext = false;
    adminRoute({ ...badRequest, user: { role: "admin", permissions: ["*"] } }, response, () => { calledNext = true; });
    assert.equal(calledNext, false);
    assert.equal(response.statusCode, 403);
  }
});

const makeFakeLockRedis = () => {
  let owner = null;
  return {
    async set(_key, token) {
      if (owner !== null) return null;
      owner = token;
      return "OK";
    },
    async eval(_script, _keyCount, _key, token) {
      if (owner === token) {
        owner = null;
        return 1;
      }
      return 0;
    },
    isLocked: () => owner !== null,
  };
};

test("concurrent administrator updates serialize the last-manager check and preserve one manager", async () => {
  const fakeRedis = makeFakeLockRedis();
  const admins = [
    { id: "first", active: true, canManageAccess: true },
    { id: "second", active: true, canManageAccess: true },
  ];
  let concurrentOperations = 0;
  let maxConcurrentOperations = 0;

  const removeManagementAccess = (id) => withAdministratorAccessLock(fakeRedis, async () => {
    concurrentOperations += 1;
    maxConcurrentOperations = Math.max(maxConcurrentOperations, concurrentOperations);
    try {
      const target = admins.find((admin) => admin.id === id);
      const otherManagers = admins.filter((admin) => admin.id !== id && admin.active && admin.canManageAccess);
      if (!otherManagers.length) return false;
      await new Promise((resolve) => setTimeout(resolve, 15));
      target.canManageAccess = false;
      return true;
    } finally {
      concurrentOperations -= 1;
    }
  }, { ttlMs: 1000, waitMs: 1000, retryMs: 2 });

  const outcomes = await Promise.all([
    removeManagementAccess("first"),
    removeManagementAccess("second"),
  ]);
  assert.equal(maxConcurrentOperations, 1);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(admins.filter((admin) => admin.active && admin.canManageAccess).length, 1);
  assert.equal(fakeRedis.isLocked(), false);
});

test("administrator access lock releases its token when an update fails", async () => {
  const fakeRedis = makeFakeLockRedis();
  await assert.rejects(
    withAdministratorAccessLock(fakeRedis, async () => { throw new Error("simulated update failure"); }, { ttlMs: 1000, waitMs: 100, retryMs: 1 }),
    /simulated update failure/,
  );
  assert.equal(fakeRedis.isLocked(), false);
});

test("administrator access lock times out without releasing another request's lock", async () => {
  const fakeRedis = makeFakeLockRedis();
  await fakeRedis.set("lock:admin-access:mutation", "existing-owner", "PX", 1000, "NX");
  await assert.rejects(
    withAdministratorAccessLock(fakeRedis, async () => assert.fail("must not enter while another request owns the lock"), { ttlMs: 1000, waitMs: 0, retryMs: 1 }),
    (error) => error instanceof AdministratorAccessLockError && error.code === "ADMIN_ACCESS_LOCK_UNAVAILABLE",
  );
  assert.equal(fakeRedis.isLocked(), true);
});

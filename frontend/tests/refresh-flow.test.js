import test from "node:test";
import assert from "node:assert/strict";
import { AxiosError } from "axios";
import axiosInstance from "../src/lib/axios.js";
import { useUserStore } from "../src/stores/useUserStore.js";
import { getPasswordPolicyError as getFrontendPasswordPolicyError } from "../src/lib/password-policy.js";
import { getPasswordPolicyError as getBackendPasswordPolicyError } from "../../backend/lib/password-policy.js";
import { isConfirmedPaymentFailure } from "../src/lib/payment-result.js";

const ok = (config, data = {}) => ({ data, status: 200, statusText: "OK", headers: {}, config });
const unauthorized = (config, message = "Authentication session expired.") => {
  const response = { data: { message }, status: 401, statusText: "Unauthorized", headers: {}, config };
  return new AxiosError(message, "ERR_BAD_REQUEST", config, null, response);
};
const installAdapter = (handler) => {
  axiosInstance.defaults.adapter = async (config) => handler(config);
};
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
const resetStore = (checkingAuth = true, { hint = true } = {}) => {
  memory.clear();
  if (hint) memory.set("session-hint", "1");
  useUserStore.setState({ user: null, checkingAuth, loading: false });
};
const flushPendingLogout = () => new Promise((resolve) => setTimeout(resolve, 0));

test("initial profile check refreshes an expired access token while checkingAuth is true", async () => {
  resetStore(true);
  let profileAttempts = 0;
  let refreshAttempts = 0;

  installAdapter(async (config) => {
    if (config.url === "/auth/profile") {
      profileAttempts += 1;
      if (!config._retry) throw unauthorized(config, "Access token expired");
      return ok(config, { _id: "user-1", name: "Test User", role: "customer" });
    }
    if (config.url === "/auth/refresh-token") {
      refreshAttempts += 1;
      return ok(config, { message: "Session refreshed successfully" });
    }
    if (config.url === "/auth/logout") return ok(config, { message: "Logged out" });
    throw new Error("Unexpected test request: " + config.url);
  });

  await useUserStore.getState().checkAuth();
  assert.equal(refreshAttempts, 1);
  assert.equal(profileAttempts, 2);
  assert.equal(useUserStore.getState().user?._id, "user-1");
  assert.equal(useUserStore.getState().checkingAuth, false);
});

test("parallel unauthorized requests share one refresh and both retry", async () => {
  resetStore(false);
  let refreshAttempts = 0;
  const protectedAttempts = new Map();

  installAdapter(async (config) => {
    const path = config.url;
    if (path === "/auth/refresh-token") {
      refreshAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok(config, { message: "Session refreshed successfully" });
    }
    if (path === "/orders/mine" || path === "/auth/profile") {
      protectedAttempts.set(path, (protectedAttempts.get(path) || 0) + 1);
      if (!config._retry) {
        await Promise.resolve();
        throw unauthorized(config, "Access token expired");
      }
      return ok(config, { path, recovered: true });
    }
    if (path === "/auth/logout") return ok(config);
    throw new Error("Unexpected test request: " + path);
  });

  const [orders, profile] = await Promise.all([
    axiosInstance.get("/orders/mine"),
    axiosInstance.get("/auth/profile"),
  ]);
  assert.equal(refreshAttempts, 1);
  assert.equal(orders.data.recovered, true);
  assert.equal(profile.data.recovered, true);
  assert.equal(protectedAttempts.get("/orders/mine"), 2);
  assert.equal(protectedAttempts.get("/auth/profile"), 2);
});

for (const scenario of ["expired", "replayed"]) {
  test(`a ${scenario} refresh token fails once without recursively refreshing itself`, async () => {
    resetStore(false);
    let profileAttempts = 0;
    let refreshAttempts = 0;
    let logoutAttempts = 0;

    installAdapter(async (config) => {
      if (config.url === "/auth/profile") {
        profileAttempts += 1;
        throw unauthorized(config, "Access token expired");
      }
      if (config.url === "/auth/refresh-token") {
        refreshAttempts += 1;
        throw unauthorized(config, scenario === "expired" ? "Refresh token expired" : "Refresh token replayed");
      }
      if (config.url === "/auth/logout") {
        logoutAttempts += 1;
        return ok(config, { message: "Logged out" });
      }
      throw new Error("Unexpected test request: " + config.url);
    });

    await assert.rejects(axiosInstance.get("/auth/profile"));
    await flushPendingLogout();
    // One original request plus a single session re-check before giving up.
    assert.equal(profileAttempts, 2);
    assert.equal(refreshAttempts, 1);
    assert.equal(logoutAttempts, 1);
    assert.equal(useUserStore.getState().user, null);
    assert.equal(memory.has("session-hint"), false);
  });
}

test("a mid-session token refresh never flips checkingAuth or clears the user", async () => {
  resetStore(false);
  useUserStore.setState({ user: { _id: "user-1", name: "Test User" } });
  const seen = [];
  const unsubscribe = useUserStore.subscribe((state) => seen.push({ checkingAuth: state.checkingAuth, user: state.user }));

  installAdapter(async (config) => {
    if (config.url === "/auth/refresh-token") {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ok(config);
    }
    if (config.url === "/orders/mine") {
      if (!config._retry) throw unauthorized(config, "Access token expired");
      return ok(config, []);
    }
    throw new Error("Unexpected test request: " + config.url);
  });

  await axiosInstance.get("/orders/mine");
  unsubscribe();
  assert.equal(seen.some((state) => state.checkingAuth), false);
  assert.equal(seen.some((state) => state.user === null), false);
  assert.equal(useUserStore.getState().user?._id, "user-1");
});

test("anonymous visitors make no auth requests at boot", async () => {
  resetStore(false, { hint: false });
  const requests = [];
  installAdapter(async (config) => {
    requests.push(config.url);
    throw unauthorized(config);
  });

  await useUserStore.getState().checkAuth();
  assert.deepEqual(requests, []);
  assert.equal(useUserStore.getState().checkingAuth, false);

  await assert.rejects(axiosInstance.get("/orders/mine"));
  assert.deepEqual(requests, ["/orders/mine"]);
});

test("session hint helpers set, read and clear a flag", async () => {
  memory.clear();
  const anonymous = await import("../src/lib/session-hint.js");
  assert.equal(anonymous.hasSessionHint(), false);
  anonymous.setSessionHint();
  assert.equal(anonymous.hasSessionHint(), true);
  anonymous.clearSessionHint();
  assert.equal(anonymous.hasSessionHint(), false);
});

test("login sets and logout clears the session hint without storing tokens", async () => {
  resetStore(false, { hint: false });
  installAdapter(async (config) => {
    if (config.url === "/auth/login") return ok(config, { _id: "user-1", name: "Test User" });
    if (config.url === "/auth/logout") return ok(config);
    throw new Error("Unexpected test request: " + config.url);
  });

  await useUserStore.getState().login("a@example.com", "pw");
  assert.deepEqual([...memory.entries()], [["session-hint", "1"]]);
  await useUserStore.getState().logout();
  assert.equal(memory.size, 0);
  assert.equal(useUserStore.getState().user, null);
});

test("losing the refresh race to another tab keeps this tab signed in", async () => {
  resetStore(false);
  useUserStore.setState({ user: { _id: "user-1" } });
  let logoutAttempts = 0;
  let ordersAttempts = 0;

  installAdapter(async (config) => {
    if (config.url === "/orders/mine") {
      ordersAttempts += 1;
      if (ordersAttempts === 1) throw unauthorized(config, "Access token expired");
      return ok(config, [{ id: 1 }]);
    }
    // The other tab already rotated the refresh token, so ours is rejected...
    if (config.url === "/auth/refresh-token") throw unauthorized(config, "Refresh token replayed");
    // ...but the cookies it set are valid for this tab as well.
    if (config.url === "/auth/profile") return ok(config, { _id: "user-1", name: "Fresh" });
    if (config.url === "/auth/logout") {
      logoutAttempts += 1;
      return ok(config);
    }
    throw new Error("Unexpected test request: " + config.url);
  });

  const response = await axiosInstance.get("/orders/mine");
  await flushPendingLogout();
  assert.deepEqual(response.data, [{ id: 1 }]);
  assert.equal(logoutAttempts, 0);
  assert.equal(useUserStore.getState().user?.name, "Fresh");
  assert.equal(memory.get("session-hint"), "1");
});

test("a network failure while refreshing does not log the user out", async () => {
  resetStore(false);
  useUserStore.setState({ user: { _id: "user-1" } });
  let logoutAttempts = 0;
  installAdapter(async (config) => {
    if (config.url === "/orders/mine") throw unauthorized(config, "Access token expired");
    if (config.url === "/auth/refresh-token") throw new AxiosError("Network Error", "ERR_NETWORK", config);
    if (config.url === "/auth/logout") {
      logoutAttempts += 1;
      return ok(config);
    }
    throw new Error("Unexpected test request: " + config.url);
  });

  await assert.rejects(axiosInstance.get("/orders/mine"));
  await flushPendingLogout();
  assert.equal(logoutAttempts, 0);
  assert.equal(useUserStore.getState().user?._id, "user-1");
});


test("signup password policy matches the backend policy for valid and invalid examples", () => {
  const passwords = [
    "",
    "password1234",
    "lowercaseonly123!",
    "aaaaaaaaaaaaaaaa1!",
    "Password123!",
    "Abcdefgh123!",
    "RepeatedAAAAA12!",
    "Abcdefgh۱۲۳۴۵۶!",
    "Dinosaur5678!",
    "Summer5678!",
    "superultrasensitivepassphrase123!",
    "QuartzMeadow8!",
    "عبارت-امن-شده-با-عدد-123!",
    "آ".repeat(30),
    "correct horse battery staple",
  ];
  for (const password of passwords) {
    assert.equal(getFrontendPasswordPolicyError(password), getBackendPasswordPolicyError(password), password);
  }
});


test("only an explicit authoritative terminal-unpaid reason is a confirmed payment failure", () => {
  assert.equal(isConfirmedPaymentFailure("payment-not-confirmed"), true);
  for (const reason of ["verification-pending", "verification-error", "invalid-callback", "order-not-found", "", null]) {
    assert.equal(isConfirmedPaymentFailure(reason), false, String(reason));
  }
});

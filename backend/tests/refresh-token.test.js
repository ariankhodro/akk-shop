import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { rotateRefreshSession, ROTATION, verifyPresentedRefreshToken, isRefreshAccountActive } from "../lib/refresh-token.js";
import { refreshTokenDigest } from "../lib/auth-tokens.js";

const makeRedis = (initial = {}) => {
  const store = new Map(Object.entries(initial));
  return {
    store,
    // Mirrors the semantics of ROTATE_SCRIPT in lib/refresh-token.js.
    eval: async (_script, _numKeys, key, prevKey, presented, next) => {
      const current = store.get(key);
      if (current === undefined) return "no_session";
      if (current === presented) { store.set(prevKey, presented); store.set(key, next); return "rotated"; }
      if (store.get(prevKey) === presented) return "race";
      store.delete(key); store.delete(prevKey);
      return "reused";
    },
  };
};

test("refresh token rotation replaces the old token, tolerates a concurrent tab and revokes on replay", async () => {
  const redisClient = makeRedis({ "refresh_token:user-1": refreshTokenDigest("old-token") });
  assert.equal(await rotateRefreshSession({ redisClient, userId: "user-1", presentedToken: "old-token", nextRefreshToken: "new-token" }), ROTATION.ROTATED);
  assert.equal(redisClient.store.get("refresh_token:user-1"), refreshTokenDigest("new-token"));
  // Stored value is a digest, never the raw token.
  assert.notEqual(redisClient.store.get("refresh_token:user-1"), "new-token");
  // Immediate replay of the previous token is a benign race (second browser tab).
  assert.equal(await rotateRefreshSession({ redisClient, userId: "user-1", presentedToken: "old-token", nextRefreshToken: "x" }), ROTATION.RACE);
  assert.equal(redisClient.store.get("refresh_token:user-1"), refreshTokenDigest("new-token"));
  // A token that is neither current nor the previous one is reuse: the session is revoked.
  assert.equal(await rotateRefreshSession({ redisClient, userId: "user-1", presentedToken: "stolen-old-token", nextRefreshToken: "y" }), ROTATION.REUSED);
  assert.equal(redisClient.store.has("refresh_token:user-1"), false);
  assert.equal(await rotateRefreshSession({ redisClient, userId: "user-1", presentedToken: "new-token", nextRefreshToken: "z" }), ROTATION.NO_SESSION);
});

test("refresh token verification accepts valid tokens and rejects expired or malformed tokens", () => {
  const secret = "unit-test-refresh-secret";
  const valid = jwt.sign({ userId: "user-1" }, secret, { expiresIn: "1m" });
  const expired = jwt.sign({ userId: "user-1" }, secret, { expiresIn: -1 });
  assert.equal(verifyPresentedRefreshToken(valid, secret).userId, "user-1");
  assert.equal(verifyPresentedRefreshToken(expired, secret), null);
  assert.equal(verifyPresentedRefreshToken("not-a-jwt", secret), null);
});

test("disabled or missing users cannot refresh; legacy accounts remain active", () => {
  assert.equal(isRefreshAccountActive({ _id: "user-1", isActive: true }), true);
  assert.equal(isRefreshAccountActive({ _id: "user-2" }), true);
  assert.equal(isRefreshAccountActive({ _id: "user-3", isActive: false }), false);
  assert.equal(isRefreshAccountActive(null), false);
});

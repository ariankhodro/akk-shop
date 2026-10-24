import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { rotateRefreshToken, verifyPresentedRefreshToken, isRefreshAccountActive } from "../lib/refresh-token.js";

test("refresh token rotation replaces the old token and rejects replay", async () => {
  const tokens = new Map([["refresh_token:user-1", "old-token"]]);
  const redisClient = {
    eval: async (_script, _numKeys, key, presented, next) => {
      if (tokens.get(key) !== presented) return 0;
      tokens.set(key, next);
      return 1;
    },
  };
  assert.equal(await rotateRefreshToken({ redisClient, userId: "user-1", presentedToken: "old-token", nextRefreshToken: "new-token" }), true);
  assert.equal(tokens.get("refresh_token:user-1"), "new-token");
  assert.equal(await rotateRefreshToken({ redisClient, userId: "user-1", presentedToken: "old-token", nextRefreshToken: "replayed-token" }), false);
  assert.equal(tokens.get("refresh_token:user-1"), "new-token");
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

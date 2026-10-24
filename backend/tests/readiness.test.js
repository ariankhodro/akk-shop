import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { getReadinessStatus } from "../lib/readiness.js";

test("readiness fails when Redis is unavailable and recovers after reconnect", async () => {
  let connected = false;
  const redisClient = { status: "connecting", ping: async () => {
    if (!connected) throw new Error("connection lost");
    return "PONG";
  } };
  const logger = { warn() {} };
  const disconnected = await getReadinessStatus({ databaseReady: true, redisClient, logger });
  assert.equal(disconnected.status, "not_ready");
  assert.equal(disconnected.redis, "unavailable");
  connected = true;
  const recovered = await getReadinessStatus({ databaseReady: true, redisClient, logger });
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.redis, "connected");
});

test("readiness waits for a connecting Redis client before pinging", async () => {
  const redisClient = new EventEmitter();
  redisClient.status = "connecting";
  redisClient.ping = async () => {
    assert.equal(redisClient.status, "ready");
    return "PONG";
  };
  const timer = setTimeout(() => {
    redisClient.status = "ready";
    redisClient.emit("ready");
  }, 10);

  const result = await getReadinessStatus({
    databaseReady: true,
    redisClient,
    logger: { warn() {} },
  });
  clearTimeout(timer);
  assert.deepEqual(result, { status: "ready", database: "connected", redis: "connected" });
});

test("readiness rechecks MongoDB after the asynchronous Redis probe", async () => {
  let databaseConnected = false;
  const result = await getReadinessStatus({
    databaseReady: () => databaseConnected,
    redisClient: {
      status: "ready",
      ping: async () => {
        // Simulate MongoDB recovering while the Redis check is in progress.
        databaseConnected = true;
        return "PONG";
      },
    },
    logger: { warn() {} },
  });

  assert.deepEqual(result, {
    status: "ready",
    database: "connected",
    redis: "connected",
  });
});

test("readiness fails when MongoDB is unavailable even if Redis responds", async () => {
  const status = await getReadinessStatus({
    databaseReady: false,
    redisClient: { ping: async () => "PONG" },
    logger: { warn() {} },
  });
  assert.equal(status.status, "not_ready");
  assert.equal(status.database, "disconnected");
  assert.equal(status.redis, "connected");
});

test("Redis readiness logs safe diagnostics without the raw connection error", async () => {
  let warning;
  const failure = new Error("connection to redis://username:secret@example.invalid failed");
  failure.code = "ETIMEDOUT";
  const status = await getReadinessStatus({
    databaseReady: true,
    redisClient: {
      status: "connecting",
      ping: async () => { throw failure; },
    },
    logger: { warn: (...args) => { warning = args; } },
  });

  assert.equal(status.redis, "unavailable");
  assert.equal(warning[0], "Redis readiness check failed");
  assert.deepEqual(warning[1], { name: "Error", code: "ETIMEDOUT", status: "connecting" });
  assert.doesNotMatch(JSON.stringify(warning), /secret|example\.invalid|username/i);
});

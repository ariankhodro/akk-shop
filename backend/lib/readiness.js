import mongoose from "mongoose";

const databaseLabel = (readyState) => readyState === 1 ? "connected"
  : readyState === 2 ? "connecting"
  : readyState === 3 ? "disconnecting"
  : "disconnected";

// A fresh serverless instance may still be negotiating its Redis connection.
// With enableOfflineQueue=false, pinging immediately can fail before the client
// reaches "ready", even if its reconnect succeeds moments later.
const waitForRedisReady = async (redisClient, timeoutMs = 6000) => {
  if (!redisClient) throw new Error("Redis client is not configured");
  if (redisClient.status === "ready" || typeof redisClient.once !== "function") return;
  if (redisClient.status === "end") throw new Error("Redis client connection has ended");

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      redisClient.removeListener?.("ready", onReady);
      redisClient.removeListener?.("end", onEnd);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onEnd = () => finish(new Error("Redis client connection ended before ready"));
    const timer = setTimeout(() => finish(new Error("Redis client did not become ready before timeout")), timeoutMs);

    redisClient.once("ready", onReady);
    redisClient.once("end", onEnd);
    // Cover the race where the client becomes ready immediately before listeners
    // are attached.
    if (redisClient.status === "ready") onReady();
  });
};

export const getReadinessStatus = async ({
  // A callback lets callers read connection state after all asynchronous probes finish.
  databaseReady = () => mongoose.connection.readyState === 1,
  redisClient,
  logger = console,
} = {}) => {
  let redisStatus = "unavailable";
  try {
    await waitForRedisReady(redisClient);
    const response = await redisClient.ping();
    redisStatus = response === "PONG" ? "connected" : "unexpected_response";
  } catch (error) {
    // Log enough to identify DNS, TLS, authentication, or timeout classes,
    // but never log the raw message because it may contain endpoint details.
    logger.warn?.("Redis readiness check failed", {
      name: error?.name || "Error",
      code: typeof error?.code === "string" ? error.code : undefined,
      status: typeof redisClient?.status === "string" ? redisClient.status : "unknown",
    });
    redisStatus = "unavailable";
  }

  // Resolve the database state only after the Redis probe above has settled.
  const isDatabaseReady = typeof databaseReady === "function"
    ? Boolean(databaseReady())
    : Boolean(databaseReady);
  const database = isDatabaseReady ? "connected" : databaseLabel(mongoose.connection.readyState);
  const ready = isDatabaseReady && redisStatus === "connected";
  return { status: ready ? "ready" : "not_ready", database, redis: redisStatus };
};

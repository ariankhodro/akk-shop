import { randomUUID } from "node:crypto";

const ADMIN_ACCESS_LOCK_KEY = "lock:admin-access:mutation";
const ADMIN_ACCESS_LOCK_TTL_MS = 60_000;
const ADMIN_ACCESS_LOCK_WAIT_MS = 8_000;
const ADMIN_ACCESS_LOCK_RETRY_MS = 50;
const RELEASE_ADMIN_ACCESS_LOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';

export class AdministratorAccessLockError extends Error {
  constructor(cause) {
    super("Unable to acquire administrator access lock");
    this.name = "AdministratorAccessLockError";
    this.code = "ADMIN_ACCESS_LOCK_UNAVAILABLE";
    if (cause) this.cause = cause;
  }
}

export const withAdministratorAccessLock = async (
  redisClient,
  operation,
  {
    key = ADMIN_ACCESS_LOCK_KEY,
    ttlMs = ADMIN_ACCESS_LOCK_TTL_MS,
    waitMs = ADMIN_ACCESS_LOCK_WAIT_MS,
    retryMs = ADMIN_ACCESS_LOCK_RETRY_MS,
  } = {},
) => {
  if (!redisClient || typeof redisClient.set !== "function" || typeof redisClient.eval !== "function") {
    throw new AdministratorAccessLockError();
  }

  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  let acquired = false;

  while (!acquired) {
    try {
      acquired = (await redisClient.set(key, token, "PX", ttlMs, "NX")) === "OK";
    } catch (error) {
      throw new AdministratorAccessLockError(error);
    }

    if (acquired) break;
    if (Date.now() >= deadline) throw new AdministratorAccessLockError();
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryMs, Math.max(0, deadline - Date.now()))));
  }

  try {
    return await operation();
  } finally {
    try {
      // Compare tokens before deleting so an expired lock subsequently acquired
      // by another request cannot be released by this request.
      await redisClient.eval(RELEASE_ADMIN_ACCESS_LOCK, 1, key, token);
    } catch (error) {
      console.warn("Unable to release administrator access lock", {
        name: error?.name || "Error",
        code: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : undefined,
      });
      // The key expires automatically. Never replace an operation result with a release failure.
    }
  }
};

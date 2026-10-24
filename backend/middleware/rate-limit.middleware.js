import { createHash } from "node:crypto";
import { redis } from "../lib/redis.js";

const redisWindowScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then redis.call("EXPIRE", KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return { current, ttl }
`;

const memoryWindows = new Map();
const MAX_MEMORY_KEYS = 15000;
const DEGRADED_LOG_INTERVAL_MS = 60_000;
let lastDegradedLogAt = 0;

export const FAIL_MODE = Object.freeze({
  // Redis failure => reject the request with 503. Used for credential endpoints:
  // those endpoints cannot complete without Redis anyway (session storage), and a
  // per-process counter would let an attacker multiply their budget by the number
  // of serverless instances.
  CLOSED: "closed",
  // Redis failure => count in-process. Still limits (per instance) rather than
  // disabling the limiter; used for general browsing traffic.
  MEMORY: "memory",
});

const salt = () => process.env.RATE_LIMIT_KEY_SALT || "mern-ecommerce-rate-limit";

export const hashKeyPart = (value) => createHash("sha256")
  .update(`${salt()}:${value}`)
  .digest("hex")
  .slice(0, 32);

// IPv6 clients can rotate through an entire /64 at no cost, so bucket by prefix.
export const normalizeClientAddress = (ip) => {
  const value = String(ip || "unknown").toLowerCase();
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!value.includes(":")) return value;
  const [head, tail = ""] = value.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = [...headGroups, ...Array(value.includes("::") ? missing : 0).fill("0"), ...tailGroups];
  return `${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}::/64`;
};

const pruneMemoryWindows = (now) => {
  for (const [key, value] of memoryWindows) if (value.resetAt <= now) memoryWindows.delete(key);
  while (memoryWindows.size > 10000) {
    const oldestKey = memoryWindows.keys().next().value;
    if (oldestKey === undefined) break;
    memoryWindows.delete(oldestKey);
  }
};

const consumeMemoryWindow = (key, windowSeconds) => {
  const now = Date.now();
  let window = memoryWindows.get(key);
  if (!window || window.resetAt <= now) window = { count: 0, resetAt: now + windowSeconds * 1000 };
  window.count += 1;
  memoryWindows.set(key, window);
  if (memoryWindows.size > MAX_MEMORY_KEYS) pruneMemoryWindows(now);
  return { count: window.count, resetSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
};

const logDegraded = (name, mode, error) => {
  const now = Date.now();
  if (now - lastDegradedLogAt < DEGRADED_LOG_INTERVAL_MS) return;
  lastDegradedLogAt = now;
  console.error(JSON.stringify({
    level: "error", event: "rate_limit_degraded", limiter: name, failMode: mode,
    errorName: error?.name || "Error", errorCode: typeof error?.code === "string" ? error.code : undefined,
  }));
};

export class RateLimitUnavailableError extends Error {
  constructor(cause) {
    super("Rate limit storage unavailable");
    this.name = "RateLimitUnavailableError";
    if (cause) this.cause = cause;
  }
}

// Increment a counter and report usage. Throws RateLimitUnavailableError when
// Redis fails and `failMode` is CLOSED.
export const consumeRateLimit = async ({ name, keyParts, windowSeconds, failMode = FAIL_MODE.MEMORY }) => {
  const key = `rate-limit:${name}:${hashKeyPart(Array.isArray(keyParts) ? keyParts.join("|") : keyParts)}`;
  try {
    const result = await redis.eval(redisWindowScript, 1, key, String(windowSeconds));
    return { count: Number(result?.[0] || 0), resetSeconds: Math.max(1, Number(result?.[1] || windowSeconds)) };
  } catch (error) {
    logDegraded(name, failMode, error);
    if (failMode === FAIL_MODE.CLOSED) throw new RateLimitUnavailableError(error);
    return consumeMemoryWindow(key, windowSeconds);
  }
};

// Read a counter without incrementing it.
export const peekRateLimit = async ({ name, keyParts, failMode = FAIL_MODE.CLOSED }) => {
  const key = `rate-limit:${name}:${hashKeyPart(Array.isArray(keyParts) ? keyParts.join("|") : keyParts)}`;
  try {
    const [count, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
    return { count: Number(count || 0), resetSeconds: Math.max(1, Number(ttl) > 0 ? Number(ttl) : 1) };
  } catch (error) {
    logDegraded(name, failMode, error);
    if (failMode === FAIL_MODE.CLOSED) throw new RateLimitUnavailableError(error);
    return { count: 0, resetSeconds: 1 };
  }
};

export const resetRateLimit = async ({ name, keyParts }) => {
  const key = `rate-limit:${name}:${hashKeyPart(Array.isArray(keyParts) ? keyParts.join("|") : keyParts)}`;
  try {
    await redis.del(key);
  } catch (error) {
    logDegraded(name, "reset", error);
  }
};

const UNAVAILABLE_MESSAGE = "سرویس موقتاً در دسترس نیست؛ چند دقیقه بعد دوباره تلاش کنید.";

export const createRateLimiter = ({
  name, limit, windowSeconds, failMode = FAIL_MODE.MEMORY,
  message = "Too many requests. Please try again later.",
}) =>
  async (req, res, next) => {
    const clientAddress = normalizeClientAddress(req.ip || req.socket?.remoteAddress);
    let usage;
    try {
      usage = await consumeRateLimit({ name, keyParts: clientAddress, windowSeconds, failMode });
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) throw error;
      res.set("Retry-After", "30");
      return res.status(503).json({ message: UNAVAILABLE_MESSAGE });
    }

    res.set("RateLimit-Limit", String(limit));
    res.set("RateLimit-Remaining", String(Math.max(0, limit - usage.count)));
    res.set("RateLimit-Reset", String(usage.resetSeconds));
    if (usage.count > limit) {
      res.set("Retry-After", String(usage.resetSeconds));
      return res.status(429).json({ message });
    }
    return next();
  };

export const apiRateLimit = createRateLimiter({
  name: "api", limit: 600, windowSeconds: 60,
  message: "درخواست‌های زیادی ارسال شده است؛ کمی بعد دوباره تلاش کنید.",
});

const authMessage = "تعداد تلاش‌ها بیش از حد مجاز است؛ بعداً دوباره تلاش کنید.";
export const signupRateLimit = createRateLimiter({
  name: "auth-signup", limit: 8, windowSeconds: 3600, failMode: FAIL_MODE.CLOSED, message: authMessage,
});
export const loginRateLimit = createRateLimiter({
  name: "auth-login", limit: 30, windowSeconds: 900, failMode: FAIL_MODE.CLOSED, message: authMessage,
});
export const forgotPasswordRateLimit = createRateLimiter({
  name: "auth-forgot", limit: 6, windowSeconds: 900, failMode: FAIL_MODE.CLOSED, message: authMessage,
});
export const resetPasswordRateLimit = createRateLimiter({
  name: "auth-reset", limit: 10, windowSeconds: 900, failMode: FAIL_MODE.CLOSED, message: authMessage,
});
export const changePasswordRateLimit = createRateLimiter({
  name: "auth-change-password", limit: 10, windowSeconds: 900, failMode: FAIL_MODE.CLOSED, message: authMessage,
});
export const refreshTokenRateLimit = createRateLimiter({
  name: "refresh-token", limit: 60, windowSeconds: 60, failMode: FAIL_MODE.CLOSED,
});
export const checkoutRateLimit = createRateLimiter({
  name: "checkout", limit: 12, windowSeconds: 60,
  message: "درخواست‌های پرداخت زیادی ارسال شده است؛ کمی بعد دوباره تلاش کنید.",
});
export const newsletterRateLimit = createRateLimiter({
  name: "newsletter", limit: 10, windowSeconds: 60,
  message: "درخواست‌های خبرنامه زیادی ارسال شده است؛ کمی بعد دوباره تلاش کنید.",
});

// Test hooks.
export const __resetMemoryWindowsForTests = () => { memoryWindows.clear(); lastDegradedLogAt = 0; };

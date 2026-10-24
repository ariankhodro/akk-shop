import { createHash } from "node:crypto";
import { redis } from "../lib/redis.js";

const redisWindowScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("TTL", KEYS[1])
return { current, ttl }
`;

const memoryWindows = new Map();
let redisFallbackWarningLogged = false;
const MAX_MEMORY_KEYS = 15000;

const hashedClientKey = (ip) => createHash("sha256")
  .update(`${process.env.RATE_LIMIT_KEY_SALT || "mern-ecommerce-rate-limit"}:${ip}`)
  .digest("hex")
  .slice(0, 32);

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

export const createRateLimiter = ({ name, limit, windowSeconds, message = "Too many requests. Please try again later." }) =>
  async (req, res, next) => {
    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `rate-limit:${name}:${hashedClientKey(clientIp)}`;
    let usage;
    try {
      const result = await redis.eval(redisWindowScript, 1, key, String(windowSeconds));
      usage = { count: Number(result?.[0] || 0), resetSeconds: Math.max(1, Number(result?.[1] || windowSeconds)) };
    } catch (error) {
      // Keeps the storefront serving if Redis fails; fallback is per-instance,
      // best-effort only, and does not provide global coordination.
      if (!redisFallbackWarningLogged) {
        console.warn("Distributed rate limiting is degraded; using per-instance fallback:", error.message);
        redisFallbackWarningLogged = true;
      }
      usage = consumeMemoryWindow(key, windowSeconds);
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
export const authRateLimit = createRateLimiter({
  name: "auth", limit: 10, windowSeconds: 900,
  message: "تعداد تلاش‌های ورود یا ثبت‌نام بیش از حد مجاز است؛ بعداً دوباره تلاش کنید.",
});
export const refreshTokenRateLimit = createRateLimiter({ name: "refresh-token", limit: 60, windowSeconds: 60 });
export const checkoutRateLimit = createRateLimiter({
  name: "checkout", limit: 12, windowSeconds: 60,
  message: "درخواست‌های پرداخت زیادی ارسال شده است؛ کمی بعد دوباره تلاش کنید.",
});
export const newsletterRateLimit = createRateLimiter({
  name: "newsletter", limit: 10, windowSeconds: 60,
  message: "درخواست‌های خبرنامه زیادی ارسال شده است؛ کمی بعد دوباره تلاش کنید.",
});

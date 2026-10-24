import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
const unavailable = async () => {
  throw new Error("REDIS_URL (or legacy UPSTASH_REDIS_URL) is not configured");
};

const redisClient = redisUrl
  ? new Redis(redisUrl, {
      // Allow normal TLS/network setup time without letting Redis commands hang.
      connectTimeout: 5000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    })
  : null;

export const redis = redisClient || {
  get: unavailable,
  set: unavailable,
  del: unavailable,
  eval: unavailable,
  ping: unavailable,
};

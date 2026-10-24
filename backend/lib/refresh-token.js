import jwt from "jsonwebtoken";
import { refreshTokenDigest, REFRESH_TOKEN_TTL_SECONDS } from "./auth-tokens.js";

const INVALID_REFRESH_TOKEN_ERRORS = new Set([
  "TokenExpiredError", "JsonWebTokenError", "NotBeforeError",
]);

// Grace period in which the immediately previous token is recognised, so two
// browser tabs that refresh concurrently do not look like token theft.
export const REFRESH_REUSE_GRACE_SECONDS = 30;

export const verifyPresentedRefreshToken = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    if (INVALID_REFRESH_TOKEN_ERRORS.has(error?.name)) return null;
    throw error;
  }
};

export const isRefreshAccountActive = (user) => Boolean(user) && user.isActive !== false;

export const refreshSessionKey = (userId) => `refresh_token:${userId}`;
export const refreshPreviousKey = (userId) => `refresh_prev:${userId}`;

// Only a SHA-256 digest of the refresh token is stored; Redis read access does
// not yield usable credentials.
export const storeRefreshSession = (redisClient, userId, token, ttlSeconds = REFRESH_TOKEN_TTL_SECONDS) =>
  redisClient.set(refreshSessionKey(userId), refreshTokenDigest(token), "EX", ttlSeconds);

export const revokeRefreshSession = async (redisClient, userId) => {
  await redisClient.del(refreshSessionKey(userId), refreshPreviousKey(userId));
};

export const ROTATION = Object.freeze({ ROTATED: "rotated", RACE: "race", REUSED: "reused", NO_SESSION: "no_session" });

const ROTATE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 'no_session' end
if current == ARGV[1] then
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[4])
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 'rotated'
end
if redis.call('GET', KEYS[2]) == ARGV[1] then return 'race' end
redis.call('DEL', KEYS[1], KEYS[2])
return 'reused'
`;

// Atomically rotate the stored session. `reused` means a stale token was
// replayed while a session exists: the session is revoked as a precaution.
export const rotateRefreshSession = async ({
  redisClient,
  userId,
  presentedToken,
  nextRefreshToken,
  ttlSeconds = REFRESH_TOKEN_TTL_SECONDS,
  graceSeconds = REFRESH_REUSE_GRACE_SECONDS,
}) => {
  const result = await redisClient.eval(
    ROTATE_SCRIPT, 2, refreshSessionKey(userId), refreshPreviousKey(userId),
    refreshTokenDigest(presentedToken), refreshTokenDigest(nextRefreshToken), ttlSeconds, graceSeconds,
  );
  return Object.values(ROTATION).includes(result) ? result : ROTATION.NO_SESSION;
};

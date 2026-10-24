import jwt from "jsonwebtoken";

const INVALID_REFRESH_TOKEN_ERRORS = new Set([
  "TokenExpiredError", "JsonWebTokenError", "NotBeforeError",
]);

export const verifyPresentedRefreshToken = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    if (INVALID_REFRESH_TOKEN_ERRORS.has(error?.name)) return null;
    throw error;
  }
};

export const isRefreshAccountActive = (user) => Boolean(user) && user.isActive !== false;

const ROTATE_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end";

export const rotateRefreshToken = async ({
  redisClient,
  userId,
  presentedToken,
  nextRefreshToken,
  ttlSeconds = 7 * 24 * 60 * 60,
}) => {
  const result = await redisClient.eval(
    ROTATE_SCRIPT, 1, `refresh_token:${userId}`, presentedToken, nextRefreshToken, ttlSeconds
  );
  return Number(result) === 1;
};

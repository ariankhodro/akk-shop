import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";

const ALGORITHM = "HS256";
const ISSUER = "akk-shop";
const ACCESS_AUDIENCE = "akk-shop:access";
const REFRESH_AUDIENCE = "akk-shop:refresh";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const isObjectLike = (value) => value !== null && typeof value === "object";

export const signAccessToken = (user, secret = process.env.ACCESS_TOKEN_SECRET) =>
  jwt.sign(
    { userId: String(user._id), tv: Number.isInteger(user.tokenVersion) ? user.tokenVersion : 0, typ: "access" },
    secret,
    { algorithm: ALGORITHM, expiresIn: ACCESS_TOKEN_TTL_SECONDS, issuer: ISSUER, audience: ACCESS_AUDIENCE },
  );

export const signRefreshToken = (user, secret = process.env.REFRESH_TOKEN_SECRET) =>
  jwt.sign(
    { userId: String(user._id), tv: Number.isInteger(user.tokenVersion) ? user.tokenVersion : 0, typ: "refresh", jti: randomBytes(12).toString("hex") },
    secret,
    { algorithm: ALGORITHM, expiresIn: REFRESH_TOKEN_TTL_SECONDS, issuer: ISSUER, audience: REFRESH_AUDIENCE },
  );

const verify = (token, secret, audience, typ) => {
  const decoded = jwt.verify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER, audience });
  if (!isObjectLike(decoded) || decoded.typ !== typ || typeof decoded.userId !== "string") {
    const error = new Error("Unexpected token type");
    error.name = "JsonWebTokenError";
    throw error;
  }
  return decoded;
};

export const verifyAccessToken = (token, secret = process.env.ACCESS_TOKEN_SECRET) =>
  verify(token, secret, ACCESS_AUDIENCE, "access");

export const verifyRefreshToken = (token, secret = process.env.REFRESH_TOKEN_SECRET) =>
  verify(token, secret, REFRESH_AUDIENCE, "refresh");

// Redis stores only a digest of the refresh token so read access to Redis does
// not yield usable session credentials.
export const refreshTokenDigest = (token) => createHash("sha256").update(String(token)).digest("hex");

export const tokenVersionOf = (user) => (Number.isInteger(user?.tokenVersion) ? user.tokenVersion : 0);

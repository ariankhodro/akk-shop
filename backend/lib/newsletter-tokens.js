import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
export const CONFIRMATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

// Random, single-use confirmation token. Only its hash is persisted.
export const createConfirmationToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

// Unsubscribe links are stateless and signed so every future mail can carry
// one without storing plaintext. NEWSLETTER_TOKEN_SECRET must be a long random
// value; without it no link can be issued or accepted (fail closed).
const secret = () => {
  const value = process.env.NEWSLETTER_TOKEN_SECRET || "";
  return value.length >= 32 ? value : "";
};

export const isUnsubscribeSigningConfigured = () => Boolean(secret());

const sign = (subscriberId) =>
  createHmac("sha256", secret()).update("newsletter-unsubscribe:" + subscriberId).digest("base64url");

export const createUnsubscribeToken = (subscriberId) => {
  if (!secret()) return null;
  const id = String(subscriberId);
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  return id + "." + sign(id);
};

// Returns the subscriber id for a valid signed token, otherwise null.
export const verifyUnsubscribeToken = (token) => {
  if (!secret() || typeof token !== "string" || token.length > 128) return null;
  const match = /^([a-f\d]{24})\.([A-Za-z0-9_-]{43})$/i.exec(token);
  if (!match) return null;
  const expected = Buffer.from(sign(match[1]));
  const actual = Buffer.from(match[2]);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? match[1] : null;
};

// Strict readers for untrusted request values. They never coerce: anything that
// is not already the expected primitive type is rejected, so objects, arrays and
// MongoDB operator payloads can never reach a query.

export const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

export const readString = (value, { min = 0, max = 1000, trim = true } = {}) => {
  if (typeof value !== "string") return null;
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) return null;
  return result;
};

export const readEmail = (value) => {
  const email = readString(value, { min: 3, max: MAX_EMAIL_LENGTH });
  if (email === null) return null;
  const normalized = email.toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
};

// Passwords are never trimmed or transformed. bcrypt input length is enforced by
// the password policy; this cap only bounds work done on hostile input.
export const readPassword = (value) => readString(value, { min: 1, max: 1024, trim: false });

import { normalizeDigits } from "./normalize-digits.js";

const MIN_PASSWORD_CHARACTERS = 12;
const MAX_BCRYPT_INPUT_BYTES = 72;

const hasTraditionalComplexity = (password) =>
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\p{N}/u.test(password) &&
  /[^A-Za-z0-9\s]/u.test(password);

const hasLongPassphraseComplexity = (password) => {
  const letterWords = password.match(/\p{L}[\p{L}\p{M}]*/gu) || [];
  const hasWordDiversity = /[A-Z]/.test(password) || letterWords.filter((word) => Array.from(word).length >= 2).length >= 3;
  return Array.from(password).length >= 16 &&
    /\p{L}/u.test(password) &&
    /\p{N}/u.test(password) &&
    /[\p{P}\p{S}]/u.test(password) &&
    hasWordDiversity;
};

const containsCommonPasswordPattern = (password) => {
  const normalized = normalizeDigits(password.toLowerCase())
    .replace(/[^a-z0-9]/g, "");
  const commonFragments = ["password", "passw0rd", "pssw0rd", "qwerty", "asdfgh", "zxcvbn", "qazwsx", "1q2w3e", "letmein", "welcome", "changeme", "iloveyou", "dinosaur", "monkey", "dragon", "football", "baseball", "princess", "superman", "sunshine", "starwars", "batman", "michael", "jessica", "secret", "summer", "winter", "spring", "autumn", "admin", "administrator", "master", "hello", "family", "freedom", "whatever", "computer", "internet", "123456", "654321", "abc123"];
  if (commonFragments.some((pattern) => normalized.includes(pattern))) return true;
  if (/(.)\1{4,}/.test(normalized)) return true;
  const sequences = ["abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba", "0123456789", "9876543210"];
  return sequences.some((sequence) =>
    Array.from({ length: sequence.length - 4 }, (_, index) => sequence.slice(index, index + 5))
      .some((fragment) => normalized.includes(fragment))
  );
};

export const getPasswordPolicyError = (password) => {
  if (typeof password !== "string") return "رمز عبور را وارد کنید.";
  if (Array.from(password).length < MIN_PASSWORD_CHARACTERS) {
    return "رمز عبور باید حداقل ۱۲ نویسه داشته باشد.";
  }
  if (new TextEncoder().encode(password).length > MAX_BCRYPT_INPUT_BYTES) {
    return "رمز عبور بیش از حد طولانی است؛ حداکثر ۷۲ بایت UTF-8 مجاز است.";
  }
  if (containsCommonPasswordPattern(password)) return "از رمزهای عبور رایج یا الگوهای قابل حدس استفاده نکنید.";
  if (hasTraditionalComplexity(password) || hasLongPassphraseComplexity(password)) return "";
  return "از رمز عبور قوی استفاده کنید: حروف کوچک و بزرگ انگلیسی، عدد و نماد؛ یا یک عبارت چندواژه‌ای حداقل ۱۶ نویسه‌ای شامل حرف، عدد و نماد.";
};

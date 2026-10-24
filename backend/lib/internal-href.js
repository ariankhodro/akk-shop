// SEC-7: an "internal" storefront link must resolve to the storefront origin
// in every browser. `startsWith("/") && !startsWith("//")` is not enough:
// "/\\evil.example" and "/\t/evil.example" both resolve to another host.
//
// NOTE: seo/internal-href.js carries an identical copy for the Vercel SEO
// functions (they deploy separately from the backend). The test
// backend/tests/internal-href.test.js keeps the two in sync.

const BASE = "https://internal.invalid";
const FORBIDDEN = /[\\\s\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const isSafeInternalHref = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (FORBIDDEN.test(value)) return false;
  try {
    const url = new URL(value, BASE);
    return url.origin === BASE && url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
};

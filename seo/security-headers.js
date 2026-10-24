// Single source of truth for the security headers sent with HTML documents.
// vercel.json `headers` must carry the same values for static assets and the
// SPA shell; backend/tests/http-hardening.test.js fails if the two drift.
// See docs/security/http-hardening.md for the rationale behind each directive.

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // 'unsafe-inline': React inline style props and the inline style attributes
  // of the server-rendered SEO markup. Scripts stay strictly external, which
  // is what matters for XSS.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https://res.cloudinary.com https://trustseal.enamad.ir",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://www.zarinpal.com https://sandbox.zarinpal.com",
  "upgrade-insecure-requests",
].join("; ");

export const HTML_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
});

export function applyHtmlSecurityHeaders(res) {
  for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) res.setHeader(name, value);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, X-Requested-With";

const configuredOrigins = () => {
  const values = [
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
  ].filter((value) => typeof value === "string" && value.trim());

  // Local development origins require an explicit opt-in and never apply in production.
  if (process.env.ALLOW_DEV_ORIGINS === "true" && process.env.NODE_ENV !== "production") {
    values.push("http://localhost:5173", "http://127.0.0.1:5173");
  }

  return new Set(values.map((value) => {
    try {
      return new URL(value.trim()).origin;
    } catch {
      return "";
    }
  }).filter(Boolean));
};

const normalizeOrigin = (value) => {
  if (typeof value !== "string" || !value || value === "null") return "";
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
};

const isAllowedOrigin = (origin) => {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && configuredOrigins().has(normalized));
};

export const securityHeaders = (req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.set("X-Permitted-Cross-Domain-Policies", "none");
  res.set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");

  // Only emit HSTS after Express has identified the original request as HTTPS.
  // Reverse proxies must forward the scheme and must be the only trusted proxy hop.
  if (process.env.NODE_ENV === "production" && req.secure === true) {
    res.set("Strict-Transport-Security", "max-age=15552000");
  }
  return next();
};

export const browserOriginAndCors = (req, res, next) => {
  const origin = req.get("Origin");
  const hasOrigin = typeof origin === "string" && origin.length > 0;
  const allowed = hasOrigin && isAllowedOrigin(origin);
  const method = String(req.method || "GET").toUpperCase();
  const fetchSite = String(req.get("Sec-Fetch-Site") || "").toLowerCase();

  if (hasOrigin) res.vary("Origin");

  if (allowed) {
    res.set("Access-Control-Allow-Origin", normalizeOrigin(origin));
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Access-Control-Expose-Headers", "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After");
  }

  if (method === "OPTIONS") {
    if (hasOrigin && !allowed) {
      return res.status(403).json({ message: "مبدأ درخواست مجاز نیست." });
    }
    res.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.set("Access-Control-Max-Age", "600");
    return res.status(204).end();
  }

  // Enforce an allowlist for browser writes while allowing non-browser service calls
  // without an Origin. Fetch Metadata provides an extra defense for cross-site writes.
  if (!SAFE_METHODS.has(method)) {
    if (hasOrigin && !allowed) {
      return res.status(403).json({ message: "مبدأ درخواست مجاز نیست." });
    }
    if (!hasOrigin && fetchSite === "cross-site") {
      return res.status(403).json({ message: "درخواست بین‌سایتی مجاز نیست." });
    }
  }

  return next();
};

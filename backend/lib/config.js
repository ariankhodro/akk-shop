// Startup configuration validation. Production refuses to start (or serve) with
// missing or weak security configuration instead of failing later, per request.

const MIN_SECRET_LENGTH = 32;
const isSet = (value) => typeof value === "string" && value.trim().length > 0;

const looksLikePlaceholder = (value) =>
  /^(changeme|change-me|secret|your[-_ ]|example|placeholder|test|xxx+)/i.test(value.trim());

export const validateEnvironment = (env = process.env) => {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === "production";

  if (!["production", "development", "test"].includes(env.NODE_ENV || "")) {
    (production ? errors : warnings).push("NODE_ENV should be one of production, development or test.");
  }

  const secretProblem = (name) => {
    const value = env[name];
    if (!isSet(value)) return `${name} is required.`;
    if (value.length < MIN_SECRET_LENGTH) return `${name} must be at least ${MIN_SECRET_LENGTH} characters of random data.`;
    if (looksLikePlaceholder(value)) return `${name} looks like a placeholder value.`;
    return null;
  };
  for (const name of ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"]) {
    const problem = secretProblem(name);
    if (problem) errors.push(problem);
  }
  if (isSet(env.ACCESS_TOKEN_SECRET) && env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) {
    errors.push("ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be different.");
  }

  if (!isSet(env.MONGO_URI)) errors.push("MONGO_URI is required.");
  if (!isSet(env.REDIS_URL) && !isSet(env.UPSTASH_REDIS_URL)) {
    errors.push("REDIS_URL is required (sessions, rate limiting and locks depend on it).");
  }
  if (!isSet(env.CLIENT_URL) && !isSet(env.FRONTEND_URL) && !isSet(env.CORS_ALLOWED_ORIGINS)) {
    errors.push("CLIENT_URL (or FRONTEND_URL / CORS_ALLOWED_ORIGINS) is required for the browser origin allow-list.");
  }

  if (isSet(env.CRON_SECRET) && env.CRON_SECRET.length < MIN_SECRET_LENGTH) {
    errors.push(`CRON_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  if (!isSet(env.CRON_SECRET)) warnings.push("CRON_SECRET is not set: payment reconciliation endpoint is disabled.");
  if (!isSet(env.ZARINPAL_MERCHANT_ID)) warnings.push("ZARINPAL_MERCHANT_ID is not set: checkout cannot start payments.");
  if (!isSet(env.RATE_LIMIT_KEY_SALT) || env.RATE_LIMIT_KEY_SALT.length < 16) {
    (production ? errors : warnings).push("RATE_LIMIT_KEY_SALT should be set to at least 16 random characters.");
  }

  if (!isSet(env.NEWSLETTER_TOKEN_SECRET) || env.NEWSLETTER_TOKEN_SECRET.length < MIN_SECRET_LENGTH) {
    warnings.push("NEWSLETTER_TOKEN_SECRET (32+ characters) is not set: newsletter confirmation/unsubscribe links cannot be issued.");
  }
  if (!isSet(env.READINESS_TOKEN)) warnings.push("READINESS_TOKEN is not set: /api/ready reports only a bare status to anonymous callers.");
  if (!isSet(env.PUBLIC_SITE_URL) && !isSet(env.VERCEL_URL)) warnings.push("PUBLIC_SITE_URL is not set: SEO pages cannot determine the storefront origin.");

  if (production) {
    if (env.ALLOW_INSECURE_COOKIES === "true") errors.push("ALLOW_INSECURE_COOKIES must not be enabled in production.");
    if (env.ALLOW_DEV_ORIGINS === "true") errors.push("ALLOW_DEV_ORIGINS must not be enabled in production.");
    if (env.ZARINPAL_SANDBOX === "true") warnings.push("ZARINPAL_SANDBOX is enabled in production; payments will not be real.");
  }

  if (isSet(env.TRUST_PROXY_HOPS)) {
    const hops = Number(env.TRUST_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 0 || hops > 5) errors.push("TRUST_PROXY_HOPS must be an integer between 0 and 5.");
  }
  return { errors, warnings, production };
};

export const assertValidEnvironment = (env = process.env, log = console) => {
  const result = validateEnvironment(env);
  for (const warning of result.warnings) log.warn(JSON.stringify({ level: "warn", event: "config_warning", message: warning }));
  if (result.errors.length) {
    for (const error of result.errors) log.error(JSON.stringify({ level: "error", event: "config_error", message: error }));
    if (result.production) {
      const failure = new Error(`Invalid production configuration: ${result.errors.length} problem(s)`);
      failure.name = "ConfigurationError";
      failure.problems = result.errors;
      throw failure;
    }
  }
  return result;
};

// Number of reverse-proxy hops whose X-Forwarded-For entries are trusted.
export const trustProxyHops = (env = process.env) => {
  const hops = Number(env.TRUST_PROXY_HOPS);
  return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 1;
};

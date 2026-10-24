import app from "../app.js";
import { validateEnvironment } from "../lib/config.js";
import { logger } from "../lib/logger.js";

// Validate configuration once per cold start. In production an invalid
// configuration is served as 503 rather than running with weak security.
const configuration = validateEnvironment();
for (const problem of configuration.errors) logger.error("config_error", { message: problem });
const configurationBroken = configuration.production && configuration.errors.length > 0;

// Let Express apply its rate limiter before database-backed middleware tries to connect.
export default function handler(req, res) {
  if (configurationBroken) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ message: "Service misconfigured" }));
  }
  return app(req, res);
}

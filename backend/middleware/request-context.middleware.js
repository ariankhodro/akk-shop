import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

// Assigns a request id (honouring a well-formed upstream one), echoes it in the
// response and writes one structured access line per API request. Query strings
// are never logged: they can carry reset or payment tokens.
export const requestContext = (req, res, next) => {
  const upstream = req.get("x-request-id");
  req.id = typeof upstream === "string" && SAFE_ID.test(upstream) ? upstream : randomUUID();
  res.set("X-Request-Id", req.id);
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api") || req.path === "/health") return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const fields = {
      requestId: req.id, method: req.method, path: (req.baseUrl || "") + (req.route?.path ?? req.path),
      status: res.statusCode, durationMs: Math.round(durationMs), userId: req.user ? String(req.user._id) : undefined,
    };
    if (res.statusCode >= 500) logger.error("http_request", fields);
    else if (process.env.NODE_ENV !== "test") logger.info("http_request", fields);
  });
  return next();
};

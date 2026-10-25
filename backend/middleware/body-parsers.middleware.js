import express from "express";

// SEC-4: JSON bodies are parsed with a small global limit. The 10 MB parser
// that content-management endpoints need for base64 image payloads is mounted
// per route, AFTER protectRoute/adminRoute, so anonymous clients can never make
// the server buffer and parse a large body.

export const GLOBAL_JSON_LIMIT = "1mb";
export const LARGE_JSON_LIMIT = "10mb";

const OBJECT_ID = "[a-f\\d]{24}";
// Routes that mount `largeJsonBody` themselves. The global parser must skip
// exactly these so the larger limit is not enforced before authentication.
const LARGE_JSON_ROUTES = [
  { method: "POST", pattern: /^\/(?:products|categories|campaigns)$/ },
  { method: "PUT", pattern: new RegExp("^/products/" + OBJECT_ID + "$", "i") },
  { method: "PATCH", pattern: new RegExp("^/(?:categories|campaigns)/" + OBJECT_ID + "$", "i") },
];

export const isLargeJsonRoute = (req) =>
  LARGE_JSON_ROUTES.some(({ method, pattern }) => req.method === method && pattern.test(req.path));

const isJsonContentType = (req) => /^application\/json\s*(?:;|$)/i.test(String(req.headers?.["content-type"] || ""));

export const largeJsonBody = express.json({ limit: LARGE_JSON_LIMIT });

export const globalJsonBody = express.json({
  limit: GLOBAL_JSON_LIMIT,
  type: (req) => isJsonContentType(req) && !isLargeJsonRoute(req),
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

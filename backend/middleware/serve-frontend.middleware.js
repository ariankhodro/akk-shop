import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FRONTEND_DIST = process.env.FRONTEND_DIST || path.resolve(here, "../../frontend/dist");

// Optional single-process deployment: the API also serves the built SPA
// (SERVE_FRONTEND=true). Mounted after every /api route. Behind a CDN/Nginx or on
// Vercel leave it off.
export const createFrontendServer = async () => {
  if (!existsSync(path.join(FRONTEND_DIST, "index.html"))) {
    throw new Error(`SERVE_FRONTEND is enabled but ${FRONTEND_DIST}/index.html does not exist; build the frontend first.`);
  }
  // Shared with the Vercel deployment so both serve identical headers.
  const { HTML_SECURITY_HEADERS } = await import("../../seo/security-headers.js");
  const files = express.static(FRONTEND_DIST, { index: false, maxAge: "1h", setHeaders: (res, file) => {
    if (/[\\/]assets[\\/]/.test(file)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } });

  const applyHeaders = (req, res) => {
    for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) {
      // HSTS and upgrade-insecure-requests would make a plain-HTTP test server unusable.
      if (!req.secure && (name === "Strict-Transport-Security")) continue;
      res.setHeader(name, !req.secure && name === "Content-Security-Policy"
        ? value.replace(/;\s*upgrade-insecure-requests/, "") : value);
    }
  };

  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    applyHeaders(req, res);
    return next();
  });
  router.use(files);
  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const requested = path.join(FRONTEND_DIST, decodeURIComponent(req.path));
    if (path.extname(req.path) && !(existsSync(requested) && statSync(requested).isFile())) return next();
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
  return router;
};

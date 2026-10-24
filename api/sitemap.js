import {
  getApiJson,
  getCanonicalOrigin,
  getRequestOrigin,
  resolveApiBase,
} from "../seo/server-utils.js";
import { xmlEscape } from "../seo/server-utils.js";

const PAGE_SIZE = 48;

export default async function handler(req, res) {
  const method = req.method || "GET";
  if (!["GET", "HEAD"].includes(method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  let requestOrigin;
  try {
    requestOrigin = getRequestOrigin(req);
  } catch {
    return res.status(400).send("Invalid request");
  }
  const siteOrigin = getCanonicalOrigin(requestOrigin);
  if (!siteOrigin) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send(method === "HEAD" ? "" : "Sitemap unavailable for this deployment");
  }

  try {
    const apiBase = resolveApiBase(req, requestOrigin);
    const firstPage = await getApiJson(apiBase, "products/search?page=1&limit=" + PAGE_SIZE + "&sort=newest");
    const pages = Math.max(0, Math.min(5000, Number(firstPage?.pagination?.totalPages) || 0));
    const entries = [
      '<sitemap><loc>' + xmlEscape(siteOrigin + "/sitemap-static.xml") + '</loc></sitemap>',
    ];
    for (let page = 1; page <= pages; page += 1) {
      entries.push('<sitemap><loc>' + xmlEscape(siteOrigin + "/sitemap-products.xml?page=" + page) + '</loc></sitemap>');
    }
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      entries.join("\n") + "\n</sitemapindex>";
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=21600");
    return res.status(200).send(method === "HEAD" ? "" : xml);
  } catch (error) {
    console.error("Sitemap index generation failed", { message: error?.message || "Unknown error" });
    res.setHeader("Retry-After", "300");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send(method === "HEAD" ? "" : "Sitemap temporarily unavailable");
  }
}

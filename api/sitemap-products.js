import {
  getApiJson,
  getCanonicalOrigin,
  getRequestOrigin,
  resolveApiBase,
  validLastmod,
  xmlEscape,
} from "../seo/server-utils.js";

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
  const rawPage = typeof req.query?.page === "string" ? req.query.page : "1";
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 1 || page > 5000) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(400).send("Invalid sitemap page");
  }

  try {
    const apiBase = resolveApiBase(req, requestOrigin);
    const payload = await getApiJson(apiBase, "products/search?page=" + page + "&limit=" + PAGE_SIZE + "&sort=newest");
    const products = Array.isArray(payload?.products) ? payload.products : [];
    const urls = products.filter((product) => product && product._id && product.isActive !== false).map((product) => {
      const loc = siteOrigin + "/product/" + encodeURIComponent(String(product._id));
      const lastmod = validLastmod(product.updatedAt || product.createdAt);
      return "<url><loc>" + xmlEscape(loc) + "</loc>" +
        (lastmod ? "<lastmod>" + xmlEscape(lastmod) + "</lastmod>" : "") +
        "</url>";
    });
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join("\n") + "\n</urlset>";
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=21600");
    return res.status(200).send(method === "HEAD" ? "" : xml);
  } catch (error) {
    console.error("Product sitemap generation failed", { page, message: error?.message || "Unknown error" });
    res.setHeader("Retry-After", "300");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send(method === "HEAD" ? "" : "Product sitemap temporarily unavailable");
  }
}

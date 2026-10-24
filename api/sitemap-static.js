import {
  getApiJson,
  getCanonicalOrigin,
  getRequestOrigin,
  resolveApiBase,
  validLastmod,
  xmlEscape,
} from "../seo/server-utils.js";

const staticPaths = [
  "/",
  "/shop",
  "/new-arrivals",
  "/bestsellers",
  "/featured-products",
  "/campaigns",
  "/looks/daily-style",
  "/looks/layers",
  "/looks/details",
  "/shipping-policy",
  "/returns-policy",
  "/support",
  "/faq",
  "/privacy-policy",
  "/terms-of-use",
];

const makeUrl = (origin, path, lastmod) =>
  "<url><loc>" + xmlEscape(origin + path) + "</loc>" +
  (lastmod ? "<lastmod>" + xmlEscape(lastmod) + "</lastmod>" : "") +
  "</url>";

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
    const [categoryPayload, campaignPayload] = await Promise.all([
      getApiJson(apiBase, "categories"),
      getApiJson(apiBase, "campaigns?limit=100"),
    ]);
    const urls = staticPaths.map((path) => makeUrl(siteOrigin, path, ""));
    const categories = Array.isArray(categoryPayload?.categories) ? categoryPayload.categories : [];
    const activeCategorySlugs = new Set();
    for (const category of categories) {
      if (!category?.slug || category.isActive === false) continue;
      const slug = String(category.slug);
      activeCategorySlugs.add(slug);
      const lastmod = validLastmod(category.updatedAt || category.createdAt);
      urls.push(makeUrl(siteOrigin, "/category/" + encodeURIComponent(slug), lastmod));
    }

    // Keep still-public legacy category URLs discoverable during the catalogue
    // migration. Only include these slugs when the public API confirms products
    // exist; no fabricated category record or lastmod is added to the sitemap.
    const legacyCategorySlugs = ["engine", "brakes", "suspension", "filters", "electrical", "body", "transmission", "cooling"];
    await Promise.all(legacyCategorySlugs.filter((slug) => !activeCategorySlugs.has(slug)).map(async (slug) => {
      try {
        const catalog = await getApiJson(apiBase, "products/category/" + encodeURIComponent(slug) + "?page=1&limit=1");
        const visibleProduct = Array.isArray(catalog?.products) &&
          catalog.products.some((product) => product && product._id && product.isActive !== false);
        if (visibleProduct) urls.push(makeUrl(siteOrigin, "/category/" + encodeURIComponent(slug), ""));
      } catch {
        // Sitemap generation should continue if a legacy-category probe fails.
      }
    }));

    const campaigns = Array.isArray(campaignPayload?.campaigns) ? campaignPayload.campaigns : [];
    for (const campaign of campaigns) {
      const key = campaign?.slug || campaign?._id;
      if (!key || campaign.isActive === false) continue;
      const lastmod = validLastmod(campaign.updatedAt || campaign.createdAt);
      urls.push(makeUrl(siteOrigin, "/campaign/" + encodeURIComponent(String(key)), lastmod));
    }

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      [...new Set(urls)].join("\n") + "\n</urlset>";
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=21600");
    return res.status(200).send(method === "HEAD" ? "" : xml);
  } catch (error) {
    console.error("Static sitemap generation failed", { message: error?.message || "Unknown error" });
    res.setHeader("Retry-After", "300");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send(method === "HEAD" ? "" : "Static sitemap temporarily unavailable");
  }
}

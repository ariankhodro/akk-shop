import {
  PRIVATE_ROUTE_META,
  STATIC_PAGE_META,
  canonicalUrlForQuery,
  hasIndexExcludedQuery,
} from "../frontend/src/lib/seo-utils.js";
import {
  fetchAppShell,
  getCanonicalOrigin,
  getRequestOrigin,
  renderHtmlShell,
  sendHtml,
} from "../seo/server-utils.js";

const MINIMAL_SHELL = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>تیک بوتیک</title></head><body><div id="root"></div></body></html>';

const notFoundContent = () =>
  '<main lang="fa" dir="rtl" style="max-width:800px;margin:0 auto;padding:48px 16px;text-align:center;font-family:Tahoma,Arial,sans-serif;line-height:1.9">' +
  '<p style="color:#68745f">تیک بوتیک · خطای ۴۰۴</p><h1 style="font-size:30px">صفحه موردنظر پیدا نشد</h1>' +
  '<p>نشانی واردشده معتبر نیست یا این صفحه دیگر در دسترس نیست.</p>' +
  '<p><a href="/" style="color:#526149">صفحه اصلی</a> · <a href="/shop" style="color:#526149">مشاهده محصولات</a></p></main>';

const normalizePath = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\r\n?#]/.test(value)) return "";
  let path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
};

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
  const path = normalizePath(typeof req.query?.path === "string" ? req.query.path : "");
  if (!path) return res.status(400).send("Invalid route request");

  const isPrivate = Object.prototype.hasOwnProperty.call(PRIVATE_ROUTE_META, path);
  const metadata = isPrivate ? PRIVATE_ROUTE_META[path] : STATIC_PAGE_META[path];
  let shell;
  try {
    shell = await fetchAppShell(requestOrigin);
  } catch (error) {
    console.error("Could not load storefront shell for route metadata", { path, message: error.message });
    return sendHtml(
      res,
      503,
      MINIMAL_SHELL.replace('<div id="root"></div>', "<main><p>فروشگاه موقتاً در دسترس نیست. لطفاً چند لحظه بعد دوباره تلاش کنید.</p></main>"),
      { head: method === "HEAD", robotsHeader: "noindex, nofollow", retryAfter: 30, cacheControl: "no-store" }
    );
  }

  if (!metadata) {
    const html = renderHtmlShell(shell, {
      title: "صفحه پیدا نشد",
      description: "نشانی واردشده معتبر نیست یا این صفحه دیگر در دسترس نیست.",
      siteOrigin,
      canonical: "",
      robots: "noindex, nofollow",
      rootContent: notFoundContent(),
    });
    return sendHtml(res, 404, html, {
      head: method === "HEAD",
      robotsHeader: "noindex, nofollow",
      cacheControl: "public, s-maxage=30, stale-while-revalidate=60",
    });
  }

  const filtered = !isPrivate && hasIndexExcludedQuery(req.query);
  const missingCanonicalOrigin = !siteOrigin;
  const robots = isPrivate
    ? "noindex, nofollow"
    : filtered || missingCanonicalOrigin
      ? "noindex, follow"
      : "index, follow, max-image-preview:large";
  const canonical = isPrivate ? "" : canonicalUrlForQuery(path, req.query, siteOrigin, siteOrigin);
  const html = renderHtmlShell(shell, {
    title: metadata.title,
    description: metadata.description,
    siteOrigin,
    canonical,
    robots,
  });
  return sendHtml(res, 200, html, {
    head: method === "HEAD",
    robotsHeader: isPrivate ? "noindex, nofollow" : filtered || missingCanonicalOrigin ? "noindex, follow" : "",
    cacheControl: isPrivate ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300",
  });
}

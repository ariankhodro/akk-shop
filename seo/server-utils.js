import {
  absoluteUrlFor,
  buildSiteStructuredData,
  canonicalOrigin,
  escapeHtml,
  normalizeSeoText,
  safeJson,
} from "../frontend/src/lib/seo-utils.js";

const DYNAMIC_META_KEYS = /^(description|robots|application-name|public-site-url|seo-preview|og:(locale|site_name|type|title|description|url|image|image:alt)|twitter:(card|title|description|image)|product:price:(amount|currency))$/i;

export function getRequestOrigin(req) {
  const forwarded = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const protocol = forwarded === "http" ? "http" : "https";
  const host = String(req?.headers?.host || "").trim();
  if (!host || /[\r\n/?#]/.test(host)) throw new Error("Invalid request host");
  const url = new URL(protocol + "://" + host);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported request protocol");
  return url.origin;
}

export function getCanonicalOrigin(requestOrigin) {
  const configuredPublicUrl = String(process.env.PUBLIC_SITE_URL || "").trim();
  const productionDomain = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  const configuredOrigin = configuredPublicUrl ||
    (productionDomain
      ? (/^https?:\/\//i.test(productionDomain) ? productionDomain : "https://" + productionDomain)
      : "");

  // Never choose the incoming Host header as the canonical domain. If no
  // verified production origin is configured/provided by Vercel, suppress
  // canonicals and indexing until the deployment has a stable public URL.
  if (!configuredOrigin) return "";
  return canonicalOrigin(requestOrigin, configuredOrigin);
}

export function resolveApiBase(_req, requestOrigin) {
  const configured = String(process.env.API_BASE_URL || process.env.VITE_API_URL || "/api").trim();
  if (!configured || /[\r\n]/.test(configured)) throw new Error("Invalid API base URL");
  let base;
  if (/^https?:\/\//i.test(configured)) {
    base = new URL(configured);
  } else {
    base = new URL(configured.startsWith("/") ? configured : "/" + configured, requestOrigin);
  }
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Unsupported API protocol");
  base.pathname = base.pathname.replace(/\/+$/, "");
  if (!/\/api$/i.test(base.pathname)) base.pathname += "/api";
  base.search = "";
  base.hash = "";
  return base.toString().replace(/\/$/, "");
}

export async function getApiJson(apiBase, endpoint) {
  if (typeof endpoint !== "string" || /[\r\n]/.test(endpoint)) throw new Error("Invalid API endpoint");
  const response = await fetch(apiBase + "/" + endpoint.replace(/^\/+/, ""), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) {
    const error = new Error("Public metadata API returned HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function fetchAppShell(requestOrigin) {
  const response = await fetch(new URL("/index.html", requestOrigin).toString(), {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) throw new Error("Unable to load the storefront HTML shell");
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("text/html")) throw new Error("The storefront shell is not HTML");
  const html = await response.text();
  if (!/<div\s+id=["']root["']\s*>\s*<\/div>/i.test(html)) {
    throw new Error("The storefront HTML shell has no empty React root");
  }
  return html;
}

export function renderHtmlShell(shell, options = {}) {
  const title = normalizeSeoText(options.title, "تیک بوتیک | فروشگاه آنلاین پوشاک و اکسسوری", 180);
  const description = normalizeSeoText(options.description, "خرید آنلاین پوشاک و اکسسوری در تیک بوتیک.", 300);
  const fullTitle = title.includes("تیک بوتیک") ? title : title + " | تیک بوتیک";
  const origin = canonicalOrigin(options.siteOrigin || options.requestOrigin || "", "");
  const canonical = options.canonical || "";
  const image = absoluteUrlFor(options.image || "", origin);
  const robots = normalizeSeoText(options.robots || "index, follow, max-image-preview:large", "index, follow", 120);
  const type = options.type === "product" ? "product" : "website";

  let html = String(shell || "");
  html = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    const match = tag.match(/\b(name|property)\s*=\s*(["'])(.*?)\2/i);
    return match && DYNAMIC_META_KEYS.test(match[3]) ? "" : tag;
  });
  html = html.replace(/<link\b(?=[^>]*\brel\s*=\s*(["'])canonical\1)[^>]*>/gi, "");
  html = html.replace(/<script\b(?=[^>]*\bid\s*=\s*(["'])seo-jsonld-[^"']*\1)[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<title\b[\s\S]*?<\/title>/i, "<title>" + escapeHtml(fullTitle) + "</title>");

  const meta = [
    '<meta name="description" content="' + escapeHtml(description) + '">',
    '<meta name="robots" content="' + escapeHtml(robots) + '">',
    '<meta name="application-name" content="تیک بوتیک">',
    origin ? '<meta name="public-site-url" content="' + escapeHtml(origin) + '">' : "",
    !origin ? '<meta name="seo-preview" content="true">' : "",
    '<meta property="og:locale" content="fa_IR">',
    '<meta property="og:site_name" content="تیک بوتیک">',
    '<meta property="og:type" content="' + type + '">',
    '<meta property="og:title" content="' + escapeHtml(fullTitle) + '">',
    '<meta property="og:description" content="' + escapeHtml(description) + '">',
    canonical ? '<meta property="og:url" content="' + escapeHtml(canonical) + '">' : "",
    image ? '<meta property="og:image" content="' + escapeHtml(image) + '">' : "",
    image ? '<meta property="og:image:alt" content="' + escapeHtml(fullTitle) + '">' : "",
    '<meta name="twitter:card" content="' + (image ? "summary_large_image" : "summary") + '">',
    '<meta name="twitter:title" content="' + escapeHtml(fullTitle) + '">',
    '<meta name="twitter:description" content="' + escapeHtml(description) + '">',
    image ? '<meta name="twitter:image" content="' + escapeHtml(image) + '">' : "",
    options.type === "product" && Number.isFinite(Number(options.productPrice))
      ? '<meta property="product:price:amount" content="' + escapeHtml(Math.round(Number(options.productPrice))) + '"><meta property="product:price:currency" content="IRR">'
      : "",
    canonical ? '<link rel="canonical" href="' + escapeHtml(canonical) + '">' : "",
  ].filter(Boolean).join("\n");

  const schemas = [];
  if (origin) schemas.push(...buildSiteStructuredData(origin, { supportEmail: process.env.VITE_STORE_SUPPORT_EMAIL || "" }));
  if (options.structuredData) {
    schemas.push(...(Array.isArray(options.structuredData) ? options.structuredData : [options.structuredData]).filter(Boolean));
  }
  const schemaHtml = schemas.map((schema, index) =>
    '<script id="seo-jsonld-' + index + '" type="application/ld+json">' + safeJson(schema) + "</script>"
  ).join("\n");

  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, meta + "\n" + schemaHtml + "\n</head>");
  if (typeof options.rootContent === "string") {
    const rootPattern = /<div\s+id=(["'])root\1\s*>\s*<\/div>/i;
    if (rootPattern.test(html)) {
      html = html.replace(rootPattern, '<div id="root">' + options.rootContent + "</div>");
    }
  }
  return html;
}

export function sendHtml(res, status, html, options = {}) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (options.cacheControl) res.setHeader("Cache-Control", options.cacheControl);
  if (options.robotsHeader) res.setHeader("X-Robots-Tag", options.robotsHeader);
  if (options.retryAfter) res.setHeader("Retry-After", String(options.retryAfter));
  return res.status(status).send(options.head ? "" : html);
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function validLastmod(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

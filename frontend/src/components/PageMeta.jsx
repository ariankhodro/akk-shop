import { useEffect } from "react";
import {
  absoluteUrlFor,
  buildBreadcrumbStructuredData,
  buildCollectionStructuredData,
  buildProductStructuredData,
  buildSiteStructuredData,
  canonicalOrigin,
  canonicalUrlForQuery,
  DEFAULT_SEO_DESCRIPTION,
  DEFAULT_SEO_TITLE,
  normalizeSeoText,
  SITE_NAME,
} from "../lib/seo-utils.js";

const setMeta = (selector, attribute, key, value) => {
  let node = document.head.querySelector(selector);
  if (value === undefined || value === null || value === "") {
    if (node) node.remove();
    return;
  }
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attribute, key);
    document.head.appendChild(node);
  }
  node.setAttribute("content", String(value));
};

const setCanonical = (value) => {
  let node = document.head.querySelector('link[rel="canonical"]');
  if (!value) {
    if (node) node.remove();
    return;
  }
  if (!node) {
    node = document.createElement("link");
    node.rel = "canonical";
    document.head.appendChild(node);
  }
  node.href = value;
};

const removeJsonLd = () => {
  [
    "page-jsonld",
    "page-breadcrumb-jsonld",
    "site-jsonld-0",
    "site-jsonld-1",
  ].forEach((id) => document.getElementById(id)?.remove());
  document.head.querySelectorAll('script[id^="seo-jsonld-"]').forEach((node) => node.remove());
};

const addJsonLd = (id, value) => {
  if (!value) return;
  const script = document.createElement("script");
  script.id = id;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(value);
  document.head.appendChild(script);
};

export default function PageMeta({
  title,
  description,
  image,
  path,
  type = "website",
  product,
  itemList = [],
  breadcrumbs = [],
  robots = "index, follow, max-image-preview:large",
  canonical = true,
}) {
  const breadcrumbsKey = JSON.stringify(Array.isArray(breadcrumbs) ? breadcrumbs : []);
  const itemListKey = JSON.stringify(Array.isArray(itemList) ? itemList : []);
  const locationSearch = typeof window !== "undefined" ? window.location.search : "";

  useEffect(() => {
    const runtimeSiteUrl = document.head.querySelector('meta[name="public-site-url"]')?.getAttribute("content") || "";
    const configuredSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL || runtimeSiteUrl;
    const isSeoPreview = document.head.querySelector('meta[name="seo-preview"]')?.getAttribute("content") === "true";
    const siteOrigin = isSeoPreview ? "" : canonicalOrigin(window.location.origin, configuredSiteUrl);
    const effectiveRobots = isSeoPreview ? "noindex, nofollow" : robots;
    const safeTitle = normalizeSeoText(title, DEFAULT_SEO_TITLE, 180);
    const safeDescription = normalizeSeoText(description, DEFAULT_SEO_DESCRIPTION, 300);
    const currentQuery = Object.fromEntries(new URLSearchParams(locationSearch).entries());
    const canonicalUrl = canonical
      ? canonicalUrlForQuery(path || window.location.pathname, currentQuery, siteOrigin, siteOrigin)
      : "";
    const imageUrl = absoluteUrlFor(image || "", siteOrigin);
    const fullTitle = safeTitle.includes(SITE_NAME) ? safeTitle : safeTitle + " | " + SITE_NAME;
    const parsedBreadcrumbs = JSON.parse(breadcrumbsKey);
    const parsedItemList = JSON.parse(itemListKey);

    document.title = fullTitle;
    setMeta('meta[name="description"]', "name", "description", safeDescription);
    setMeta('meta[name="robots"]', "name", "robots", effectiveRobots);
    setMeta('meta[name="application-name"]', "name", "application-name", SITE_NAME);
    setMeta('meta[property="og:locale"]', "property", "og:locale", "fa_IR");
    setMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);
    setMeta('meta[property="og:title"]', "property", "og:title", fullTitle);
    setMeta('meta[property="og:description"]', "property", "og:description", safeDescription);
    setMeta('meta[property="og:type"]', "property", "og:type", type === "product" ? "product" : "website");
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[property="og:image"]', "property", "og:image", imageUrl);
    setMeta('meta[property="og:image:alt"]', "property", "og:image:alt", imageUrl ? fullTitle : "");
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", imageUrl ? "summary_large_image" : "summary");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", fullTitle);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", safeDescription);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", imageUrl);
    setCanonical(canonicalUrl);

    removeJsonLd();
    buildSiteStructuredData(siteOrigin, { supportEmail: import.meta.env.VITE_STORE_SUPPORT_EMAIL || "" }).forEach((schema, index) => addJsonLd("site-jsonld-" + index, schema));

    if (type === "product" && product?.name) {
      addJsonLd("page-jsonld", buildProductStructuredData({
        product,
        title: product.name || safeTitle,
        description: product.description || safeDescription,
        image: imageUrl,
        canonical: canonicalUrl,
        origin: siteOrigin,
      }));
    } else if (["category", "collection", "campaign"].includes(type)) {
      addJsonLd("page-jsonld", buildCollectionStructuredData({
        title: safeTitle,
        description: safeDescription,
        image: imageUrl,
        canonical: canonicalUrl,
        products: parsedItemList,
        origin: siteOrigin,
      }));
    }
    if (parsedBreadcrumbs.length) {
      addJsonLd("page-breadcrumb-jsonld", buildBreadcrumbStructuredData(parsedBreadcrumbs, siteOrigin));
    }

    return () => {
      removeJsonLd();
      setCanonical("");
      document.title = DEFAULT_SEO_TITLE;
      setMeta('meta[name="description"]', "name", "description", DEFAULT_SEO_DESCRIPTION);
      setMeta('meta[name="robots"]', "name", "robots", "index, follow, max-image-preview:large");
      setMeta('meta[name="application-name"]', "name", "application-name", SITE_NAME);
      setMeta('meta[property="og:locale"]', "property", "og:locale", "fa_IR");
      setMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);
      setMeta('meta[property="og:title"]', "property", "og:title", DEFAULT_SEO_TITLE);
      setMeta('meta[property="og:description"]', "property", "og:description", DEFAULT_SEO_DESCRIPTION);
      setMeta('meta[property="og:type"]', "property", "og:type", "website");
      setMeta('meta[property="og:url"]', "property", "og:url", "");
      setMeta('meta[property="og:image"]', "property", "og:image", "");
      setMeta('meta[property="og:image:alt"]', "property", "og:image:alt", "");
      setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary");
      setMeta('meta[name="twitter:title"]', "name", "twitter:title", DEFAULT_SEO_TITLE);
      setMeta('meta[name="twitter:description"]', "name", "twitter:description", DEFAULT_SEO_DESCRIPTION);
      setMeta('meta[name="twitter:image"]', "name", "twitter:image", "");
    };
  }, [title, description, image, path, type, product, robots, canonical, breadcrumbsKey, itemListKey, locationSearch]);

  return null;
}

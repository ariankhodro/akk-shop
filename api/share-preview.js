import {
  absoluteUrlFor,
  buildBreadcrumbStructuredData,
  buildCollectionStructuredData,
  buildProductStructuredData,
  canonicalUrlForQuery,
  escapeHtml,
  getSchemaAvailability,
  hasIndexExcludedQuery,
  normalizeSeoText,
} from "../frontend/src/lib/seo-utils.js";
import {
  fetchAppShell,
  getApiJson,
  getCanonicalOrigin,
  getRequestOrigin,
  renderHtmlShell,
  resolveApiBase,
  sendHtml,
} from "../seo/server-utils.js";
import { isSafeInternalHref } from "../seo/internal-href.js";

const MINIMAL_SHELL = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>میبا</title></head><body><div id="root"></div></body></html>';

const categoryLabels = {
  engine: "قطعات موتوری",
  brakes: "سیستم ترمز",
  suspension: "جلوبندی و تعلیق",
  filters: "فیلترها",
  electrical: "برق و الکترونیک",
  body: "بدنه و تزئینات",
  transmission: "گیربکس و کلاچ",
  cooling: "سیستم خنک‌کاری",
};

const legacyCategoryDescriptions = {
  engine: "تسمه تایم، واشر سرسیلندر، شمع، پمپ روغن و سایر قطعات موتور خودروهای چینی.",
  brakes: "لنت، دیسک، کاسه چرخ، پمپ و شیلنگ ترمز خودروهای چینی.",
  suspension: "کمک‌فنر، طبق، سیبک، بوش و قطعات فرمان خودروهای چینی.",
  filters: "فیلتر روغن، هوا، بنزین و کابین برای خودروهای چینی.",
  electrical: "سنسور، کوئل، دینام، استارت و قطعات برقی خودروهای چینی.",
  body: "سپر، آینه، چراغ و قطعات بدنه خودروهای چینی.",
  transmission: "دیسک و صفحه کلاچ، بلبرینگ و قطعات گیربکس خودروهای چینی.",
  cooling: "رادیاتور، واترپمپ، ترموستات و فن خودروهای چینی.",
};

const collectionConfigs = {
  shop: {
    routePath: "/shop",
    title: "فروشگاه قطعات یدکی خودروهای چینی",
    description: "جست‌وجو با نام یا کد فنی، فیلتر بر اساس خودرو و خرید قطعات از میبا.",
    endpoint: "products/search?page=1&limit=8&sort=newest",
  },
  campaigns: {
    routePath: "/campaigns",
    title: "پیشنهادهای ویژه",
    description: "کمپین‌ها و پیشنهادهای فعال فروشگاه میبا.",
    campaigns: true,
  },
  "new-arrivals": {
    routePath: "/new-arrivals",
    title: "تازه‌ترین قطعات",
    description: "جدیدترین قطعات اضافه‌شده به انبار میبا را ببینید.",
    endpoint: "products/newest?limit=8",
  },
  bestsellers: {
    routePath: "/bestsellers",
    title: "پرفروش‌ترین قطعات",
    description: "قطعات یدکی پرفروش میبا را مشاهده کنید.",
    endpoint: "products/bestsellers?limit=8",
  },
  "featured-products": {
    routePath: "/featured-products",
    title: "قطعات منتخب",
    description: "مجموعه‌ای از قطعات منتخب میبا را بررسی کنید.",
    endpoint: "products/featured",
  },
};

const priceText = (value) => {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0
    ? new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.round(price)) + " تومان"
    : "";
};

const imageHtml = (image, alt, origin, dimensions = "width=\"800\" height=\"1000\"") => {
  const source = absoluteUrlFor(image || "", origin || "");
  if (!source) return "";
  return '<img src="' + escapeHtml(source) + '" alt="' + escapeHtml(alt) + '" ' + dimensions +
    ' style="display:block;max-width:100%;height:auto;object-fit:cover;border-radius:12px" fetchpriority="high">';
};

const pageLayout = (title, description, innerHtml) =>
  '<main lang="fa" dir="rtl" style="max-width:1200px;margin:0 auto;padding:24px 16px;color:#1c1f24;font-family:Tahoma,Arial,sans-serif;line-height:1.9">' +
    '<nav aria-label="مسیر صفحه" style="font-size:13px;margin-bottom:16px"><a href="/" style="color:#c2410c">صفحه اصلی</a> / <a href="/shop" style="color:#c2410c">فروشگاه</a></nav>' +
    '<h1 style="font-size:28px;line-height:1.5;margin:0 0 12px">' + escapeHtml(title) + '</h1>' +
    '<p style="font-size:15px;color:#5a606a;margin:0 0 20px">' + escapeHtml(normalizeSeoText(description, "", 1000)) + '</p>' +
    innerHtml +
    '<p style="margin-top:28px"><a href="/shop" style="display:inline-block;border-radius:999px;background:#1c1f24;color:#fff;padding:9px 18px;text-decoration:none">مشاهده فروشگاه</a></p>' +
  '</main>';

const renderProductCards = (products, origin) => {
  const items = (Array.isArray(products) ? products : [])
    .filter((product) => product && product._id && product.isActive !== false)
    .slice(0, 24);
  if (!items.length) return "";
  return '<section aria-label="قطعات مرتبط" style="margin-top:24px"><h2 style="font-size:20px">قطعات</h2>' +
    '<ul style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;list-style:none;padding:0">' +
    items.map((product) => {
      const href = "/product/" + encodeURIComponent(String(product._id));
      const image = absoluteUrlFor(product.image || product.images?.[0] || "", origin);
      return '<li style="border:1px solid #e2e5ea;border-radius:14px;padding:12px;background:#ffffff">' +
        '<a href="' + escapeHtml(href) + '" style="color:#1c1f24;text-decoration:none">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(product.name || "تصویر محصول") + '" width="400" height="500" loading="lazy" style="width:100%;height:auto;aspect-ratio:4/5;object-fit:cover;border-radius:8px">' : "") +
        '<h3 style="font-size:15px;line-height:1.7">' + escapeHtml(product.name || "محصول") + '</h3>' +
        '</a>' +
        (priceText(product.price) ? '<p style="font-weight:bold">' + escapeHtml(priceText(product.price)) + '</p>' : "") +
      '</li>';
    }).join("") +
    '</ul></section>';
};

const renderProductContent = (product, canonical, origin) => {
  const image = product.image || product.images?.[0] || "";
  const category = typeof product.category === "string" ? product.category : "";
  const categoryName = categoryLabels[category] || category.replace(/-/g, " ");
  const availabilityCode = getSchemaAvailability(product);
  const availability = availabilityCode === "https://schema.org/InStock"
    ? "وضعیت: موجود"
    : availabilityCode === "https://schema.org/OutOfStock"
      ? "وضعیت: ناموجود"
      : availabilityCode === "https://schema.org/Discontinued"
        ? "وضعیت: فروش این محصول متوقف شده است"
        : "وضعیت: موجودی این محصول هنوز تأیید نشده است";
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const sizes = [...new Set([
    ...(Array.isArray(product.sizes) ? product.sizes : []),
    ...variants.map((variant) => variant?.size),
  ].filter((value) => typeof value === "string" && value.trim()))];
  const colors = [...new Set([
    ...(Array.isArray(product.colors) ? product.colors.map((color) => color?.name) : []),
    ...variants.map((variant) => variant?.color),
  ].filter((value) => typeof value === "string" && value.trim()))];
  const fitDescription = typeof product.fit?.description === "string" ? product.fit.description.trim() : "";
  const variantRows = variants.slice(0, 48).map((variant) => {
    const label = [variant?.size, variant?.color].filter((value) => typeof value === "string" && value.trim()).map(escapeHtml).join(" / ") || "ترکیب محصول";
    const stock = Number(variant?.stock);
    const state = Number.isFinite(stock) ? (stock > 0 ? "موجود" : "ناموجود") : "موجودی نامشخص";
    return '<li>' + label + ': ' + escapeHtml(state) + '</li>';
  }).join("");
  const detailsHtml = [
    sizes.length ? '<p><strong>سایزها:</strong> ' + sizes.map(escapeHtml).join("، ") + '</p>' : "",
    colors.length ? '<p><strong>رنگ‌ها:</strong> ' + colors.map(escapeHtml).join("، ") + '</p>' : "",
    fitDescription ? '<p><strong>توضیحات تن‌خور:</strong> ' + escapeHtml(fitDescription) + '</p>' : "",
    variantRows ? '<section><h2 style="font-size:18px">موجودی سایز و رنگ</h2><ul>' + variantRows + '</ul></section>' : "",
  ].filter(Boolean).join("");
  const detailHtml =
    (image ? '<div style="max-width:480px;margin:16px 0">' + imageHtml(image, product.name || "تصویر محصول", origin) + '</div>' : "") +
    (priceText(product.price) ? '<p style="font-size:21px;font-weight:bold">' + escapeHtml(priceText(product.price)) + '</p>' : "") +
    '<p style="font-size:14px;color:#5a606a">' + escapeHtml(availability) + '</p>' +
    (category ? '<p>دسته‌بندی: <a href="/category/' + escapeHtml(encodeURIComponent(category)) + '">' + escapeHtml(categoryName) + '</a></p>' : "") +
    detailsHtml +
    '<p><a href="' + escapeHtml(canonical || "/product/" + encodeURIComponent(String(product._id || ""))) + '" style="color:#c2410c">مشاهده جزئیات و گزینه‌های محصول</a></p>';
  return pageLayout(product.name || "قطعه یدکی", product.description || "جزئیات، کد فنی، قیمت و خودروهای سازگار در میبا.", detailHtml);
};

const renderCategoryContent = (category, products, origin) => {
  const name = category.name?.fa || category.name?.en || category.slug;
  const description = category.description?.fa || category.description?.en ||
    ("قطعات گروه " + name + " را در میبا ببینید.");
  const image = absoluteUrlFor(category.image || "", origin);
  const introImage = image
    ? '<div style="max-width:520px;margin:16px 0">' + imageHtml(category.image || "", name, origin, 'width="1000" height="700"') + '</div>'
    : "";
  return pageLayout(name, description, introImage + renderProductCards(products, origin));
};

const renderCollectionContent = (config, products, origin) => {
  const image = absoluteUrlFor(config.image || "", origin);
  const introImage = image
    ? '<div style="max-width:520px;margin:16px 0">' + imageHtml(config.image || "", config.title, origin, 'width="1000" height="700"') + '</div>'
    : "";
  return pageLayout(config.title, config.description, introImage + renderProductCards(products, origin));
};

const renderCampaignCards = (campaigns, origin) => {
  const items = (Array.isArray(campaigns) ? campaigns : [])
    .filter((campaign) => campaign && (campaign.slug || campaign._id))
    .slice(0, 24);
  if (!items.length) {
    return '<p>در حال حاضر پیشنهاد فعالی برای نمایش وجود ندارد.</p>';
  }
  return '<section aria-label="کمپین‌های فعال"><ul style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;list-style:none;padding:0">' +
    items.map((campaign) => {
      const key = String(campaign.slug || campaign._id);
      const href = "/campaign/" + encodeURIComponent(key);
      const image = absoluteUrlFor(campaign.image || "", origin);
      const imageBlock = image
        ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(campaign.title || "تصویر کمپین") + '" width="800" height="450" loading="lazy" style="width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:10px">'
        : "";
      return '<li style="border:1px solid #e2e5ea;border-radius:14px;padding:12px;background:#ffffff">' +
        '<a href="' + escapeHtml(href) + '" style="color:#1c1f24;text-decoration:none">' +
        imageBlock + '<h2 style="font-size:18px;line-height:1.7">' + escapeHtml(campaign.title || "پیشنهاد ویژه") + '</h2>' +
        (campaign.description ? '<p style="font-size:14px;color:#5a606a">' + escapeHtml(normalizeSeoText(campaign.description, "", 240)) + '</p>' : "") +
        '<span style="font-weight:bold;color:#c2410c">مشاهده پیشنهاد</span></a></li>';
    }).join("") +
    '</ul></section>';
};

const renderCampaignContent = (campaign, origin) => {
  const image = absoluteUrlFor(campaign.image || "", origin);
  const imageBlock = image
    ? '<div style="max-width:720px;margin:16px 0">' + imageHtml(campaign.image || "", campaign.title || "پیشنهاد ویژه", origin, 'width="1200" height="700"') + '</div>'
    : "";
  const target = isSafeInternalHref(campaign.href) ? campaign.href : "/shop";
  const products = Array.isArray(campaign.productIds) ? campaign.productIds : [];
  return pageLayout(campaign.title || "پیشنهاد ویژه", campaign.description || "پیشنهادهای ویژه و قطعات منتخب میبا.",
    imageBlock +
    '<p><a href="' + escapeHtml(target) + '" style="color:#c2410c">مشاهده پیشنهاد</a></p>' +
    renderProductCards(products, origin));
};

const renderNotFoundContent = () =>
  '<main lang="fa" dir="rtl" style="max-width:800px;margin:0 auto;padding:48px 16px;text-align:center;font-family:Tahoma,Arial,sans-serif;line-height:1.9">' +
  '<p style="font-size:13px;color:#c2410c">میبا · خطای ۴۰۴</p>' +
  '<h1 style="font-size:30px">صفحه موردنظر پیدا نشد</h1>' +
  '<p>ممکن است قطعه حذف شده باشد، کمپین به پایان رسیده باشد یا نشانی صفحه اشتباه باشد.</p>' +
  '<p><a href="/" style="color:#c2410c">صفحه اصلی</a> · <a href="/shop" style="color:#c2410c">مشاهده قطعات</a></p>' +
  '</main>';

const notFoundDocument = (shell, canonicalOrigin, isHead) => {
  const html = renderHtmlShell(shell || MINIMAL_SHELL, {
    title: "صفحه پیدا نشد",
    description: "این قطعه، دسته‌بندی، مجموعه یا کمپین در میبا در دسترس نیست.",
    siteOrigin: canonicalOrigin,
    canonical: "",
    robots: "noindex, nofollow",
    rootContent: renderNotFoundContent(),
  });
  return { html, isHead };
};

const getProducts = async (apiBase, endpoint) => {
  const result = await getApiJson(apiBase, endpoint);
  const products = Array.isArray(result) ? result : result?.products;
  return Array.isArray(products) ? products.filter((item) => item && item._id && item.isActive !== false) : [];
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
  const type = typeof req.query?.type === "string" ? req.query.type : "";
  const id = typeof req.query?.id === "string" ? req.query.id.trim() : "";
  if (!["product", "category", "campaign", "collection"].includes(type) || !id || id.length > 140 || /[\r\n]/.test(id)) {
    return res.status(400).send("Invalid SEO page request");
  }

  let routePath;
  if (type === "product") {
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      const shell = await fetchAppShell(requestOrigin).catch(() => null);
      const page = notFoundDocument(shell, siteOrigin, method === "HEAD");
      return sendHtml(res, 404, page.html, {
        head: method === "HEAD",
        robotsHeader: "noindex, nofollow",
        cacheControl: "public, s-maxage=30, stale-while-revalidate=60",
      });
    }
    routePath = "/product/" + encodeURIComponent(id);
  } else if (type === "category") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      const shell = await fetchAppShell(requestOrigin).catch(() => null);
      const page = notFoundDocument(shell, siteOrigin, method === "HEAD");
      return sendHtml(res, 404, page.html, {
        head: method === "HEAD",
        robotsHeader: "noindex, nofollow",
        cacheControl: "public, s-maxage=30, stale-while-revalidate=60",
      });
    }
    routePath = "/category/" + encodeURIComponent(id);
  } else if (type === "campaign") {
    if (!/^[a-z0-9-]+$/i.test(id)) {
      const shell = await fetchAppShell(requestOrigin).catch(() => null);
      const page = notFoundDocument(shell, siteOrigin, method === "HEAD");
      return sendHtml(res, 404, page.html, {
        head: method === "HEAD",
        robotsHeader: "noindex, nofollow",
        cacheControl: "public, s-maxage=30, stale-while-revalidate=60",
      });
    }
    routePath = "/campaign/" + encodeURIComponent(id);
  } else {
    const config = collectionConfigs[id];
    if (!config) {
      const shell = await fetchAppShell(requestOrigin).catch(() => null);
      const page = notFoundDocument(shell, siteOrigin, method === "HEAD");
      return sendHtml(res, 404, page.html, {
        head: method === "HEAD",
        robotsHeader: "noindex, nofollow",
        cacheControl: "public, s-maxage=30, stale-while-revalidate=60",
      });
    }
    routePath = config.routePath;
  }

  const canonical = canonicalUrlForQuery(routePath, req.query, siteOrigin, siteOrigin);
  // Started now so it overlaps with the API calls, but it must never reject
  // unhandled: failures are captured and surfaced when the shell is needed.
  let shellError = null;
  const shellPromise = fetchAppShell(requestOrigin).catch((error) => {
    shellError = error;
    return null;
  });
  let shell;
  let apiBase;
  let title = "";
  let description = "";
  let imageValue = "";
  let products = [];
  let product = null;
  let category = null;
  let campaign = null;
  let structuredData = [];
  let rootContent = "";

  try {
    apiBase = resolveApiBase(req, requestOrigin);

    if (type === "product") {
      product = await getApiJson(apiBase, "products/" + encodeURIComponent(id));
      if (!product || !product.name || product.isActive === false) {
        const missing = new Error("Product not found");
        missing.status = 404;
        throw missing;
      }
      title = String(product.name);
      description = String(product.description || "جزئیات، کد فنی، قیمت و خودروهای سازگار در میبا.");
      imageValue = product.image || product.images?.[0] || "";
      structuredData.push(buildProductStructuredData({
        product,
        title,
        description,
        image: imageValue,
        canonical,
        origin: siteOrigin,
      }));
      const crumbCategory = typeof product.category === "string" ? product.category : "";
      const crumbName = categoryLabels[crumbCategory] || crumbCategory.replace(/-/g, " ");
      structuredData.push(buildBreadcrumbStructuredData([
        { name: "صفحه اصلی", path: "/" },
        ...(crumbCategory ? [{ name: crumbName, path: "/category/" + encodeURIComponent(crumbCategory) }] : []),
        { name: title, path: routePath },
      ], siteOrigin));
      rootContent = renderProductContent(product, canonical, siteOrigin);
    } else if (type === "category") {
      try {
        const payload = await getApiJson(apiBase, "categories/" + encodeURIComponent(id));
        category = payload?.category || null;
      } catch (error) {
        // Older catalogues can still have public legacy category slugs without
        // a corresponding Category document. Confirm the route against the
        // public category-products endpoint before deciding whether it is 404.
        if (error.status !== 404) throw error;
      }
      if (category?.isActive === false) {
        const missing = new Error("Category is not publicly available");
        missing.status = 404;
        throw missing;
      }

      const categoryQuery = new URLSearchParams();
      for (const key of ["q", "minPrice", "maxPrice", "size", "color", "fit", "brand", "inStock", "attributes", "sort", "page"]) {
        const raw = req.query?.[key];
        const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
        for (const value of values) {
          if (typeof value === "string" && !/[\r\n]/.test(value)) categoryQuery.append(key, value.slice(0, 2400));
        }
      }
      if (!categoryQuery.has("page")) categoryQuery.set("page", "1");
      categoryQuery.set("limit", "8");
      const catalog = await getApiJson(apiBase, "products/category/" + encodeURIComponent(id) + "?" + categoryQuery.toString());
      products = Array.isArray(catalog?.products) ? catalog.products : [];

      if (!category) {
        const legacyName = categoryLabels[id] || products[0]?.category;
        if (!legacyName && products.length === 0) {
          const missing = new Error("Category not found");
          missing.status = 404;
          throw missing;
        }
        const fallbackTitle = String(legacyName || id.replace(/-/g, " "));
        category = {
          slug: id,
          name: { fa: fallbackTitle },
          description: { fa: legacyCategoryDescriptions[id] || ("قطعات گروه " + fallbackTitle + " را در میبا ببینید.") },
          image: products[0]?.image || products[0]?.images?.[0] || "",
          isActive: true,
        };
      }
      title = String(category.name?.fa || category.name?.en || id);
      description = String(category.description?.fa || category.description?.en || ("خرید و فیلتر قطعات گروه " + title + " در میبا."));
      imageValue = category.image || products[0]?.image || products[0]?.images?.[0] || "";
      structuredData.push(buildCollectionStructuredData({ title, description, image: imageValue, canonical, products, origin: siteOrigin }));
      structuredData.push(buildBreadcrumbStructuredData([
        { name: "صفحه اصلی", path: "/" },
        { name: title, path: routePath },
      ], siteOrigin));
      rootContent = renderCategoryContent(category, products, siteOrigin);
    } else if (type === "campaign") {
      // The detail endpoint filters inactive/expired campaigns and populates
      // only active products, so initial HTML and JSON-LD match the real page.
      const payload = await getApiJson(apiBase, "campaigns/" + encodeURIComponent(id));
      campaign = payload?.campaign || null;
      if (!campaign) {
        const missing = new Error("Campaign not found");
        missing.status = 404;
        throw missing;
      }
      title = String(campaign.title || "پیشنهاد ویژه");
      description = String(campaign.description || "پیشنهادهای ویژه و قطعات منتخب میبا.");
      imageValue = campaign.image || "";
      structuredData.push(buildCollectionStructuredData({
        title,
        description,
        image: imageValue,
        canonical,
        products: Array.isArray(campaign.productIds) ? campaign.productIds : [],
        origin: siteOrigin,
      }));
      structuredData.push(buildBreadcrumbStructuredData([
        { name: "صفحه اصلی", path: "/" },
        { name: "پیشنهادهای ویژه", path: "/campaigns" },
        { name: title, path: routePath },
      ], siteOrigin));
      rootContent = renderCampaignContent(campaign, siteOrigin);
    } else {
      const config = collectionConfigs[id];
      title = config.title;
      description = config.description;
      imageValue = config.image || "";
      if (config.campaigns) {
        const payload = await getApiJson(apiBase, "campaigns?limit=24");
        const campaigns = Array.isArray(payload?.campaigns) ? payload.campaigns : [];
        structuredData.push(buildCollectionStructuredData({ title, description, image: imageValue, canonical, products: [], origin: siteOrigin }));
        structuredData.push(buildBreadcrumbStructuredData([
          { name: "صفحه اصلی", path: "/" },
          { name: title, path: routePath },
        ], siteOrigin));
        rootContent = pageLayout(title, description, renderCampaignCards(campaigns, siteOrigin));
      } else {
        if (Array.isArray(config.categories)) {
          const groups = await Promise.all(config.categories.map((slug) =>
            getProducts(apiBase, "products/category/" + encodeURIComponent(slug) + "?page=1&limit=6")
          ));
          products = groups.flat();
        } else if (id === "shop") {
          const shopQuery = new URLSearchParams();
          for (const key of ["q", "category", "minPrice", "maxPrice", "sort", "page"]) {
            const raw = req.query?.[key];
            const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
            for (const value of values) {
              if (typeof value === "string" && !/[\r\n]/.test(value)) shopQuery.append(key, value.slice(0, 160));
            }
          }
          shopQuery.set("limit", "8");
          products = await getProducts(apiBase, "products/search?" + shopQuery.toString());
        } else {
          products = await getProducts(apiBase, config.endpoint);
        }
        products = products.filter((item, index, all) =>
          item?._id && all.findIndex((candidate) => String(candidate?._id) === String(item._id)) === index
        ).slice(0, 24);
        structuredData.push(buildCollectionStructuredData({ title, description, image: imageValue, canonical, products, origin: siteOrigin }));
        structuredData.push(buildBreadcrumbStructuredData([
          { name: "صفحه اصلی", path: "/" },
          { name: "فروشگاه", path: "/shop" },
          { name: title, path: routePath },
        ], siteOrigin));
        rootContent = renderCollectionContent(config, products, siteOrigin);
      }
    }

    shell = await shellPromise;
    if (!shell) throw shellError || new Error("Unable to load the storefront HTML shell");
    const filtered = (type === "category" || type === "collection") && hasIndexExcludedQuery(req.query);
    const missingCanonicalOrigin = !siteOrigin;
    const robots = filtered || missingCanonicalOrigin ? "noindex, follow" : "index, follow, max-image-preview:large";
    const html = renderHtmlShell(shell, {
      title,
      description,
      image: absoluteUrlFor(imageValue, siteOrigin),
      canonical,
      robots,
      type,
      productPrice: product && Number.isFinite(Number(product.price)) ? Math.round(Number(product.price) * 10) : undefined,
      structuredData,
      rootContent,
      siteOrigin,
    });
    return sendHtml(res, 200, html, {
      head: method === "HEAD",
      robotsHeader: filtered || missingCanonicalOrigin ? "noindex, follow" : "",
      cacheControl: "public, s-maxage=60, stale-while-revalidate=300",
    });
  } catch (error) {
    if (error.status === 404) {
      try {
        shell = await shellPromise;
      } catch {
        shell = null;
      }
      const page = notFoundDocument(shell, siteOrigin, method === "HEAD");
      return sendHtml(res, 404, page.html, {
        head: method === "HEAD",
        robotsHeader: "noindex, nofollow",
        cacheControl: "public, s-maxage=30, stale-while-revalidate=60",
      });
    }

    console.error("SEO page rendering failed", {
      type,
      message: error?.message || "Unknown error",
      status: error?.status || 0,
    });
    try {
      shell = shell || await shellPromise;
    } catch {
      shell = null;
    }
    const html = renderHtmlShell(shell || MINIMAL_SHELL, {
      title: "صفحه موقتاً در دسترس نیست",
      description: "دریافت اطلاعات این صفحه موقتاً امکان‌پذیر نیست. لطفاً دوباره تلاش کنید.",
      siteOrigin,
      canonical: "",
      robots: "noindex, nofollow",
    });
    return sendHtml(res, 503, html, {
      head: method === "HEAD",
      robotsHeader: "noindex, nofollow",
      retryAfter: 60,
      cacheControl: "no-store",
    });
  }
}

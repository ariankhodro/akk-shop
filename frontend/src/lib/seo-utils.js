export const SITE_NAME = "تیک بوتیک";
export const DEFAULT_SEO_TITLE = "تیک بوتیک | فروشگاه آنلاین پوشاک و اکسسوری";
export const DEFAULT_SEO_DESCRIPTION = "خرید آنلاین پوشاک و اکسسوری با انتخاب آسان و تجربه خرید امن.";

export const STATIC_PAGE_META = {
  "/": {
    title: DEFAULT_SEO_TITLE,
    description: DEFAULT_SEO_DESCRIPTION,
  },
  "/shop": {
    title: "خرید آنلاین پوشاک و اکسسوری",
    description: "محصولات تیک بوتیک را ببینید و با جست‌وجو و فیلترهای کاربردی، انتخاب مناسب خود را پیدا کنید.",
  },
  "/campaigns": {
    title: "پیشنهادهای ویژه و کمپین‌های فروش",
    description: "پیشنهادها و کمپین‌های فعال تیک بوتیک را مشاهده کنید.",
  },
  "/shipping-policy": {
    title: "ارسال و تحویل",
    description: "هزینه ارسال طبق تنظیمات فعلی فروشگاه محاسبه می‌شود و مبلغ نهایی پیش از پرداخت در سبد خرید نمایش داده می‌شود.",
  },
  "/returns-policy": {
    title: "مرجوعی و تعویض",
    description: "این صفحه برای روشن‌بودن شرایط خرید تهیه شده است؛ سیاست نهایی مرجوعی باید از طرف فروشگاه تأیید شود.",
  },
  "/support": {
    title: "پشتیبانی و تماس",
    description: "برای پرسش درباره سفارش، هزینه ارسال، موجودی یا شرایط کالا، جزئیات سفارش را آماده داشته باشید.",
  },
  "/faq": {
    title: "سؤالات متداول",
    description: "پاسخ‌ها بر اساس قابلیت‌های فعلی فروشگاه نوشته شده‌اند.",
  },
  "/privacy-policy": {
    title: "حریم خصوصی",
    description: "این توضیحات نشان می‌دهد قابلیت‌های فعلی فروشگاه چه اطلاعاتی را برای کارکرد خود نگه می‌دارند.",
  },
  "/terms-of-use": {
    title: "شرایط استفاده",
    description: "با استفاده از فروشگاه، هنگام خرید باید جزئیات محصول، قیمت، گزینه‌ها، شرایط ارسال و وضعیت نهایی سفارش را بررسی کنید.",
  },
  "/new-arrivals": {
    title: "تازه‌واردها | محصولات جدید",
    description: "جدیدترین محصولات اضافه‌شده به تیک بوتیک را ببینید.",
  },
  "/bestsellers": {
    title: "پرفروش‌ترین محصولات",
    description: "محصولات پرفروش تیک بوتیک را مشاهده کنید.",
  },
  "/featured-products": {
    title: "محصولات منتخب",
    description: "گزیده‌ای از محصولات منتخب تیک بوتیک را بررسی کنید.",
  },
};

export const PRIVATE_ROUTE_META = {
  "/login": {
    title: "ورود به حساب کاربری",
    description: "ورود به حساب کاربری تیک بوتیک.",
  },
  "/signup": {
    title: "ساخت حساب کاربری",
    description: "ساخت حساب کاربری برای مدیریت سفارش‌ها و خرید در تیک بوتیک.",
  },
  "/forgot-password": {
    title: "بازیابی رمز عبور",
    description: "راهنمای بازیابی دسترسی به حساب کاربری تیک بوتیک.",
  },
  "/reset-password": {
    title: "تنظیم رمز عبور جدید",
    description: "تنظیم رمز عبور جدید برای حساب کاربری تیک بوتیک.",
  },
  "/secret-dashboard": {
    title: "پنل مدیریت",
    description: "پنل مدیریت فروشگاه تیک بوتیک.",
  },
  "/cart": {
    title: "سبد خرید",
    description: "بررسی محصولات انتخاب‌شده پیش از ثبت سفارش.",
  },
  "/profile": {
    title: "پروفایل کاربری",
    description: "مدیریت اطلاعات حساب کاربری تیک بوتیک.",
  },
  "/orders": {
    title: "سفارش‌های من",
    description: "مشاهده سفارش‌ها و وضعیت خریدهای ثبت‌شده.",
  },
  "/wishlist": {
    title: "علاقه‌مندی‌ها",
    description: "مشاهده محصولات ذخیره‌شده در فهرست علاقه‌مندی‌ها.",
  },
  "/purchase-success": {
    title: "نتیجه پرداخت",
    description: "بررسی نتیجه پرداخت و سفارش.",
  },
  "/purchase-cancel": {
    title: "وضعیت پرداخت",
    description: "مشاهده وضعیت پرداخت و راهنمای ادامه خرید.",
  },
  "/newsletter-unsubscribe": {
    title: "لغو عضویت خبرنامه",
    description: "مدیریت درخواست لغو عضویت خبرنامه تیک بوتیک.",
  },
};

const FILTER_QUERY_KEYS = new Set([
  "q", "category", "minPrice", "maxPrice", "size", "color", "fit",
  "brand", "inStock", "attributes", "sort",
]);

export function normalizeSeoText(value, fallback = "", maxLength = 300) {
  const text = String(value || fallback || "").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

export function canonicalOrigin(currentOrigin, configuredOrigin = "") {
  const candidates = [configuredOrigin, currentOrigin];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim() || /[\r\n]/.test(candidate)) continue;
    try {
      const url = new URL(candidate.trim());
      if (["http:", "https:"].includes(url.protocol) && url.hostname) return url.origin;
    } catch {
      // Try the current request origin when the optional configured URL is invalid.
    }
  }
  return "";
}

export function canonicalUrlFor(path, currentOrigin, configuredOrigin = "") {
  const origin = canonicalOrigin(currentOrigin, configuredOrigin);
  if (!origin) return "";
  const requestedPath = typeof path === "string" && path.startsWith("/") && !path.startsWith("//")
    ? path
    : "/";
  try {
    const url = new URL(requestedPath, origin);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function canonicalUrlForQuery(path, query, currentOrigin, configuredOrigin = "") {
  const base = canonicalUrlFor(path, currentOrigin, configuredOrigin);
  if (!base || !query || typeof query !== "object") return base;
  const normalizedPath = String(path || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (normalizedPath !== "/shop" && !normalizedPath.startsWith("/category/")) return base;

  const entries = Object.entries(query).filter(([, raw]) => {
    if (raw === undefined || raw === null) return false;
    const values = Array.isArray(raw) ? raw : [raw];
    return values.some((value) => String(value ?? "").trim() !== "");
  });
  const isPaginationOnly = entries.every(([key, raw]) => {
    if (["page", "path", "type", "id"].includes(key)) return true;
    const values = Array.isArray(raw) ? raw : [raw];
    if (key === "sort" && values.every((value) => String(value) === "newest")) return true;
    return key.toLowerCase().startsWith("utm_");
  });

  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const page = Number(rawPage);
  if (!isPaginationOnly || !Number.isSafeInteger(page) || page < 2) return base;
  return base + "?page=" + String(page);
}

export function absoluteUrlFor(value, origin) {
  if (typeof value !== "string" || !value.trim()) return "";
  const base = canonicalOrigin(origin, "");
  if (!base) return "";
  try {
    const url = new URL(value.trim(), base);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function getSchemaAvailability(product) {
  if (product?.isActive === false) return "https://schema.org/Discontinued";

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length) {
    return variants.some((variant) => Number(variant?.stock) > 0)
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock";
  }

  // Unknown/null stock must not be advertised as available: checkout requires
  // finite stock, so omit availability until inventory is explicitly tracked.
  const stock = product?.stock;
  if (typeof stock !== "number" || !Number.isFinite(stock)) return undefined;
  return stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
}

export function buildProductStructuredData({ product, title, description, image, canonical, origin }) {
  if (!product || !title) return null;
  const imageValues = [
    ...(Array.isArray(product.images) ? product.images : []),
    product.image,
    image,
  ].filter((value) => typeof value === "string" && value.trim());
  const images = [...new Set(imageValues.map((value) => absoluteUrlFor(value, origin)).filter(Boolean))];
  const sizes = [...new Set([
    ...(Array.isArray(product.sizes) ? product.sizes : []),
    ...(Array.isArray(product.variants) ? product.variants.map((variant) => variant?.size) : []),
  ].filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  const colors = [...new Set([
    ...(Array.isArray(product.colors) ? product.colors.map((color) => color?.name) : []),
    ...(Array.isArray(product.variants) ? product.variants.map((variant) => variant?.color) : []),
  ].filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  const additionalProperty = [
    ...sizes.map((size) => ({ "@type": "PropertyValue", name: "سایز", value: size })),
    ...colors.map((color) => ({ "@type": "PropertyValue", name: "رنگ", value: color })),
    ...(typeof product.fit?.description === "string" && product.fit.description.trim()
      ? [{ "@type": "PropertyValue", name: "توضیحات تن‌خور", value: normalizeSeoText(product.fit.description, "", 500) }]
      : []),
  ];
  const priceToman = Number(product.price);
  const hasValidPrice = Number.isFinite(priceToman) && priceToman >= 0;
  const availability = getSchemaAvailability(product);
  const result = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: String(title),
    description: normalizeSeoText(product.description || description, description, 1000),
    image: images.length ? images : undefined,
    sku: product._id ? String(product._id) : undefined,
    additionalProperty: additionalProperty.length ? additionalProperty : undefined,
    offers: hasValidPrice && availability ? {
      "@type": "Offer",
      priceCurrency: "IRR",
      // The storefront stores prices in Toman; structured data uses Rial (IRR).
      price: Math.round(priceToman * 10),
      availability,
      url: canonical || undefined,
    } : undefined,
  };
  return result;
}

export function buildItemListStructuredData(products, origin) {
  const items = (Array.isArray(products) ? products : [])
    .filter((product) => product && product._id && product.isActive !== false)
    .slice(0, 48)
    .map((product, index) => {
      const url = canonicalUrlFor("/product/" + encodeURIComponent(String(product._id)), origin, origin);
      return {
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Product",
          name: String(product.name || "محصول"),
          url,
          image: absoluteUrlFor(product.image || product.images?.[0] || "", origin) || undefined,
        },
      };
    });
  if (!items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListElement: items,
  };
}

export function buildCollectionStructuredData({ title, description, image, canonical, products, origin }) {
  const itemList = buildItemListStructuredData(products, origin);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: String(title || SITE_NAME),
    description: normalizeSeoText(description, DEFAULT_SEO_DESCRIPTION, 1000),
    url: canonical || undefined,
    image: absoluteUrlFor(image, origin) || undefined,
    mainEntity: itemList ? {
      "@type": "ItemList",
      numberOfItems: itemList.numberOfItems,
      itemListElement: itemList.itemListElement,
    } : undefined,
  };
}

export function buildBreadcrumbStructuredData(items, origin) {
  const list = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.name && typeof item.path === "string")
    .map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: String(item.name),
      item: canonicalUrlFor(item.path, origin, origin),
    }));
  if (!list.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: list,
  };
}

export function buildSiteStructuredData(origin, options = {}) {
  const rootUrl = canonicalUrlFor("/", origin, origin);
  if (!rootUrl) return [];

  const candidateEmail = typeof options.supportEmail === "string"
    ? options.supportEmail.trim()
    : "";
  const atIndex = candidateEmail.indexOf("@");
  const domainIndex = candidateEmail.indexOf(".", atIndex + 2);
  const containsWhitespace = candidateEmail.split("").some((character) => character.charCodeAt(0) <= 32);
  const supportEmail = atIndex > 0 &&
    atIndex === candidateEmail.lastIndexOf("@") &&
    domainIndex > atIndex + 1 &&
    domainIndex < candidateEmail.length - 1 &&
    !containsWhitespace
    ? candidateEmail
    : "";

  return [
    {
      "@context": "https://schema.org",
      "@type": "OnlineStore",
      "@id": rootUrl + "#organization",
      name: SITE_NAME,
      url: rootUrl,
      ...(supportEmail ? {
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: supportEmail,
        },
      } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": rootUrl + "#website",
      name: SITE_NAME,
      url: rootUrl,
      inLanguage: "fa-IR",
      publisher: { "@id": rootUrl + "#organization" },
    },
  ];
}

export function hasIndexExcludedQuery(query) {
  if (!query || typeof query !== "object") return false;
  return Object.keys(query).some((key) => {
    if (!FILTER_QUERY_KEYS.has(key)) return false;
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === null || String(value).trim() === "") return false;
    if (key === "sort" && String(value) === "newest") return false;
    return true;
  });
}

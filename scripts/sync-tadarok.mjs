// scripts/sync-tadarok.mjs
// High-performance synchronization between Tadarok API (tadarok.akk.ir)
// and the MIBA shop MongoDB database.
//
// Features:
//   - Fast Incremental Sync (using updated_since) for sub-second updates
//   - Full Sync mode (--full)
//   - Automatic Redis cache invalidation when prices/stocks change
//   - Dry run mode (--dry-run)
//   - Duplicate SKU disambiguation

import dotenv from "dotenv";
import mongoose from "mongoose";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const TADAROK_BASE_URL = (process.env.TADAROK_BASE_URL || "https://tadarok.akk.ir/api/v1").replace(/\/+$/, "");
const TADAROK_API_KEY = process.env.TADAROK_API_KEY || "tdk_hyxN48NU_38tdmPMJNUlokVVtdjvGL4Zy0jLVuzqJaosFct1y6N8";

const isDryRun = process.argv.includes("--dry-run");
const isForceFull = process.argv.includes("--full");
const shouldCleanDemo = process.argv.includes("--clean-demo");

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const maxProducts = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

const storeArg = process.argv.find((a) => a.startsWith("--store-no="));
const specificStoreNo = storeArg ? parseInt(storeArg.split("=")[1], 10) : null;

const SYNC_STATE_FILE = path.resolve(__dirname, "../.last_sync_tadarok");

const DEMO_SKUS = [
  "T11-3501080", "A11-1109111", "481H-1012010", "S11-1307010", "2905100-J5",
  "H6-3707100", "GE-EC7-4121", "LF-1601200", "BYD-F3-3501", "BR-H230-1025",
  "DF-H30-3610", "ARZ-1301100"
];

async function fetchTadarok(endpoint, params = {}) {
  const url = new URL(`${TADAROK_BASE_URL}${endpoint}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      url.searchParams.set(key, String(val));
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${TADAROK_API_KEY}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tadarok API error ${res.status} on ${endpoint}: ${text}`);
  }

  return await res.json();
}

function detectCategory(name, baseStoreName, categoriesBySlug) {
  const lower = name.toLowerCase();

  const rules = [
    { slug: "cooling", keywords: ["ترموستات", "واترپمپ", "واتر پمپ", "رادیاتور", "رادياتور", "خنک", "ضدیخ", "ضد يخ", "فن", "درب رادیاتور", "درب رادياتور", "منبع انبساط", "شیلنگ رادیاتور", "شيلنگ رادياتور", "لوله آب", "قمقمه"] },
    { slug: "brakes", keywords: ["ترمز", "لنت", "دیسک چرخ", "ديسك چرخ", "کاسه چرخ", "كاسه چرخ", "بوستر", "کالیپر", "كاليپر", "شیلنگ ترمز", "شيلنگ ترمز", "پمپ ترمز", "سیم ترمز", "سيم ترمز"] },
    { slug: "suspension", keywords: ["کمک", "كمك", "سیبک", "سيبك", "طبق", "بوش", "جلوبندی", "جلوبندي", "تعلیق", "تعليق", "فنر", "فرمان", "اکسل", "اكسل", "پلوس", "میل تعادل", "ميل تعادل", "جعبه فرمان", "سگدست", "توپی", "توپي", "بلبرینگ چرخ", "بلبرينگ چرخ"] },
    { slug: "filters", keywords: ["فیلتر", "فيلتر", "صافی", "صافي"] },
    { slug: "electrical", keywords: ["سنسور", "کوئل", "كوئل", "دینام", "دينام", "استارت", "باتری", "باتري", "باطری", "باطري", "شمع", "لامپ", "چراغ", "رله", "فیوز", "فيوز", "سیم کشی", "سيم كشي", "سوکت", "سوكت", "برق", "کامپیوتر", "ecu", "ایسیو", "کلید", "كليد", "موتور فن", "دسته راهنما", "بوق", "فلاشر"] },
    { slug: "body", keywords: ["قالپاق", "فوم", "سپر", "گلگیر", "گلگير", "کاپوت", "درب", "در ", "آینه", "آينه", "دستگیره", "دستگيره", "بدنه", "جلوپنجره", "جلو پنجره", "زه", "نوار", "شیشه", "شيشه", "قاب", "رکاب", "ركاب", "صندوق", "دیاق", "دياق", "پوسته سپر", "آرم", "ارم"] },
    { slug: "transmission", keywords: ["گیربکس", "گيربكس", "کلاچ", "كلاچ", "دیسک و صفحه", "ديسك و صفحه", "بلبرینگ کلاچ", "بلبرينگ كلاچ", "دنده", "ماهک", "ماهك", "دوشاخه کلاچ", "سیم کلاچ", "سيم كلاچ", "واسطه گیربکس"] },
    { slug: "engine", keywords: ["موتور", "تسمه", "واشر", "پیستون", "پيستون", "سیلندر", "سيلندر", "میل لنگ", "ميل لنگ", "میل سوپاپ", "ميل سوپاپ", "سوپاپ", "یاتاقان", "ياتاقان", "اویل پمپ", "اويل پمپ", "کاسه نمد", "كاسه نمد", "خرطومی", "خرطومي", "منیفولد", "مانيفولد", "هواکش", "هواكش", "انژکتور", "انژكتور", "شاتون", "شاطون", "پولی", "پولي", "گیج", "گيج", "کارتر", "كارتر", "درب سوپاپ", "سرسیلندر", "سرسيلندر"] },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      const match = categoriesBySlug.get(rule.slug);
      if (match) return match;
    }
  }

  if (baseStoreName && baseStoreName.includes("بدنه") && categoriesBySlug.get("body")) {
    return categoriesBySlug.get("body");
  }

  return categoriesBySlug.get("engine") || categoriesBySlug.values().next().value;
}

function detectFitments(name) {
  const fitments = [];
  const checks = [
    { make: "سایپا", model: "پراید", keywords: ["پراید", "پرايد", "131", "132", "111", "141", "صبا", "نسیم"] },
    { make: "سایپا", model: "تیبا", keywords: ["تیبا", "تيبا"] },
    { make: "سایپا", model: "ساینا", keywords: ["ساینا", "ساينا"] },
    { make: "سایپا", model: "کوییک", keywords: ["کوییک", "كوييك"] },
    { make: "سایپا", model: "شاهین", keywords: ["شاهین", "شاهين"] },
    { make: "پژو / ایران خودرو", model: "206", keywords: ["206", "۲۰۶"] },
    { make: "پژو / ایران خودرو", model: "207", keywords: ["207", "۲۰۷"] },
    { make: "پژو / ایران خودرو", model: "405", keywords: ["405", "۴۰۵"] },
    { make: "ایران خودرو", model: "پژو پارس", keywords: ["پارس"] },
    { make: "ایران خودرو", model: "سمند", keywords: ["سمند", "سورن"] },
    { make: "ایران خودرو", model: "دنا", keywords: ["دنا"] },
    { make: "ایران خودرو", model: "تارا", keywords: ["تارا"] },
    { make: "ایران خودرو", model: "رانا", keywords: ["رانا"] },
    { make: "رنو / پارس خودرو", model: "تندر ۹۰", keywords: ["ال 90", "ال۹۰", "تندر", "L90", "l90"] },
    { make: "ایران خودرو", model: "پیکان / روآ", keywords: ["پیکان", "پيكان", "آردی", "اردي", "روآ"] },
    { make: "چری", model: "تیگو ۵", keywords: ["تیگو ۵", "تيگو 5", "تیگو"] },
    { make: "چری / ام‌وی‌ام", model: "آریزو", keywords: ["آریزو", "آريزو"] },
    { make: "ام‌وی‌ام", model: "110", keywords: ["ام‌وی‌ام ۱۱۰", " 110", "110 "] },
    { make: "ام‌وی‌ام", model: "315", keywords: ["315"] },
    { make: "ام‌وی‌ام", model: "530", keywords: ["530"] },
    { make: "ام‌وی‌ام", model: "550", keywords: ["550"] },
    { make: "ام‌وی‌ام", model: "X22", keywords: ["X22", "x22"] },
    { make: "ام‌وی‌ام", model: "X33", keywords: ["X33", "x33"] },
    { make: "ام‌وی‌ام", model: "X55", keywords: ["X55", "x55"] },
    { make: "جک", model: "J5", keywords: ["J5", "j5"] },
    { make: "جک", model: "S5", keywords: ["S5", "s5"] },
    { make: "جک", model: "J4", keywords: ["J4", "j4"] },
    { make: "هاوال", model: "H6", keywords: ["H6", "h6"] },
    { make: "هاوال", model: "H2", keywords: ["H2", "h2"] },
    { make: "لیفان", model: "X60", keywords: ["X60", "x60"] },
    { make: "برلیانس", model: "برلیانس", keywords: ["برلیانس", "H230", "H330", "H320", "H220"] },
  ];

  for (const c of checks) {
    if (c.keywords.some((k) => name.includes(k))) {
      fitments.push({ make: c.make, model: c.model, yearFrom: null, yearTo: null, engine: "" });
    }
  }

  return fitments;
}

function detectBrand(name) {
  const brands = [
    { brand: "دیناپارت", keywords: ["دیناپارت", "ديناپارت"] },
    { brand: "ویژن", keywords: ["ویژن", "ويژن"] },
    { brand: "رادیکال", keywords: ["رادیکال", "راديكال"] },
    { brand: "آریان خودرو", keywords: ["آریان خودرو", "اريان خودرو", "آريان خودرو"] },
    { brand: "عظام", keywords: ["عظام"] },
    { brand: "سایپا یدک", keywords: ["سایپا یدک", "سايپا يدك", "سایپا", "سايپا"] },
    { brand: "ایساکو", keywords: ["ایساکو", "ايساكو", "ایران خودرو", "ايران خودرو"] },
    { brand: "پولاسا", keywords: ["پولاسا"] },
    { brand: "کاوج", keywords: ["کاوج", "كاوج"] },
    { brand: "جمع ساز", keywords: ["جمع ساز"] },
    { brand: "ام‌کو", keywords: ["ام‌کو", "ام کو"] },
    { brand: "Valeo", keywords: ["والئو", "Valeo"] },
    { brand: "کروز", keywords: ["کروز"] },
    { brand: "پل فیروز", keywords: ["پل فیروز", "پل فيروز"] },
    { brand: "کاسکو", keywords: ["کاسکو", "كاسكو"] },
    { brand: "Chery", keywords: ["چری", "چري"] },
    { brand: "MVM", keywords: ["ام‌وی‌ام", "mvm"] },
  ];

  for (const b of brands) {
    if (b.keywords.some((k) => name.includes(k))) return b.brand;
  }
  return "MIBA";
}

async function invalidateRedisCache() {
  try {
    const { redis } = await import("../backend/lib/redis.js");
    if (redis && typeof redis.del === "function") {
      await Promise.allSettled([
        redis.del("featured_products_v2"),
        redis.del("bestsellers_v2"),
        redis.del("newest_products_v2"),
      ]);
      console.log("Redis cache keys invalidated.");
    }
  } catch (err) {
    console.warn("Could not invalidate Redis cache:", err.message);
  }
}

async function main() {
  const startTime = new Date();
  console.log(`=== TADAROK SYNC STARTED [${startTime.toISOString()}] ===`);

  let lastSyncTime = null;
  if (!isForceFull && existsSync(SYNC_STATE_FILE)) {
    try {
      const saved = readFileSync(SYNC_STATE_FILE, "utf-8").trim();
      if (saved) {
        lastSyncTime = new Date(saved);
        // Step back 2 minutes as a safety buffer for any delayed transactions
        lastSyncTime = new Date(lastSyncTime.getTime() - 120_000);
      }
    } catch {
      lastSyncTime = null;
    }
  }

  const isIncremental = Boolean(lastSyncTime && !isNaN(lastSyncTime.getTime()));
  if (isIncremental) {
    console.log(`Mode: INCREMENTAL (checking changes since ${lastSyncTime.toISOString()})`);
  } else {
    console.log("Mode: FULL CATALOG SCAN");
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set in environment or .env file.");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const [{ default: Product }, { default: Category }, { buildNormalizedProductSearchText }] = await Promise.all([
    import("../backend/models/product.model.js"),
    import("../backend/models/category.model.js"),
    import("../backend/lib/persian-search.js"),
  ]);

  const categories = await Category.find({ isActive: true });
  const categoriesBySlug = new Map(categories.map((c) => [c.slug, c]));

  if (shouldCleanDemo && !isDryRun) {
    await Product.deleteMany({ sku: { $in: DEMO_SKUS } });
  }

  // Pre-load keys to avoid duplicate SKU errors
  const existingDocs = await Product.find({}, { "attributes.tadarok_id": 1, sku: 1 }).lean();
  const existingByTadarokId = new Map();
  const usedSkus = new Set();

  for (const doc of existingDocs) {
    if (doc.sku) usedSkus.add(doc.sku);
    const tid = doc.attributes?.tadarok_id;
    if (tid) existingByTadarokId.set(Number(tid), doc.sku);
  }

  let cursor = null;
  let hasMore = true;
  let pageNum = 0;
  let totalProcessed = 0;
  let totalUpserted = 0;
  const BATCH_SIZE = 500;

  while (hasMore && totalProcessed < maxProducts) {
    pageNum++;
    const params = { limit: BATCH_SIZE };
    if (!isIncremental) {
      params.in_stock = "true";
    }
    if (isIncremental) {
      params.updated_since = lastSyncTime.toISOString();
    }
    if (specificStoreNo) {
      params.store_no = specificStoreNo;
    }
    if (cursor) {
      params.cursor = cursor;
    }

    const res = await fetchTadarok("/products", params);
    const items = res.data || [];
    if (items.length === 0) {
      if (isIncremental && pageNum === 1) {
        console.log("No new or updated products since last sync. All prices and stocks are current!");
      }
      break;
    }

    const bulkOps = [];

    for (const p of items) {
      if (totalProcessed >= maxProducts) break;
      totalProcessed++;

      const productId = Number(p.product_id);
      let code = (p.code || "").trim();
      const name = (p.name || `کالا ${code || productId}`).trim();

      // Determine SKU consistently
      let sku = existingByTadarokId.get(productId);
      if (!sku) {
        sku = code || `TDK-${productId}`;
        if (usedSkus.has(sku)) {
          sku = `${sku}-${productId}`;
        }
        usedSkus.add(sku);
      }

      const category = detectCategory(name, p.base_store_name, categoriesBySlug);

      // Price conversion: Tadarok Rials -> whole Tomans
      const sellPriceRials = Number(p.sell_price || 0);
      const buyPriceRials = Number(p.buy_price || 0);
      let priceTomans = Math.round(sellPriceRials / 10);

      if (priceTomans <= 0 && buyPriceRials > 0) {
        priceTomans = Math.round((buyPriceRials * 1.2) / 10);
      }
      if (priceTomans <= 0) {
        priceTomans = 10_000;
      }

      const sellPrice2Rials = Number(p.sell_price_2 || 0);
      const wholesalePriceTomans = sellPrice2Rials > 0 ? Math.round(sellPrice2Rials / 10) : null;

      const rawStock = Number(p.stock || 0);
      const stockQty = Math.max(0, Math.round(rawStock));

      const brand = detectBrand(name);
      const fitments = detectFitments(name);
      const oemNumbers = [code, p.technical].filter(Boolean).map((s) => String(s).trim());

      const description = [
        name,
        p.technical ? `مشخصات فنی: ${p.technical}` : null,
        p.unit_name ? `واحد: ${p.unit_name}` : null,
        p.base_store_name ? `انبار: ${p.base_store_name}` : null,
      ].filter(Boolean).join(" | ");

      const searchTextNormalized = buildNormalizedProductSearchText({
        name,
        description,
        category: category.slug,
        sizes: [],
        colors: [],
        variants: [],
        fit: {},
        attributes: { unit_name: p.unit_name, brand },
        sku,
        oemNumbers,
        brand,
        fitments,
      });

      const setFields = {
        name,
        description,
        price: priceTomans,
        wholesalePrice: wholesalePriceTomans,
        wholesaleMinQuantity: wholesalePriceTomans ? 2 : 1,
        sku,
        oemNumbers,
        brand,
        quality: "genuine",
        countryOfOrigin: "ایران",
        warrantyMonths: 6,
        fitments,
        category: category.slug,
        categoryId: category._id,
        image: `/categories/${category.slug}.svg`,
        images: [`/categories/${category.slug}.svg`],
        stock: stockQty,
        isActive: true,
        isFeatured: stockQty > 0,
        searchTextNormalized,
        "attributes.tadarok_id": productId,
        "attributes.code": code,
        "attributes.unit_name": p.unit_name || "عدد",
        "attributes.base_store_name": p.base_store_name || "",
        "attributes.buy_price_rials": buyPriceRials,
        "attributes.sell_price_rials": sellPriceRials,
      };

      bulkOps.push({
        updateOne: {
          filter: { "attributes.tadarok_id": productId },
          update: {
            $set: setFields,
            $setOnInsert: {
              createdAt: new Date(),
              sizes: [],
              colors: [],
              variants: [],
            },
          },
          upsert: true,
        },
      });
    }

    if (!isDryRun && bulkOps.length > 0) {
      const bulkRes = await Product.bulkWrite(bulkOps, { ordered: false });
      totalUpserted += (bulkRes.upsertedCount || 0) + (bulkRes.modifiedCount || 0);
    }

    console.log(`Page ${pageNum}: processed ${totalProcessed} products (${bulkOps.length} batch)`);

    hasMore = Boolean(res.page?.has_more && res.page?.next_cursor);
    cursor = res.page?.next_cursor || null;
  }

  if (!isDryRun) {
    // Save last sync timestamp
    writeFileSync(SYNC_STATE_FILE, startTime.toISOString(), "utf-8");
    if (totalUpserted > 0) {
      await invalidateRedisCache();
    }
  }

  console.log(`=== SYNC FINISHED: ${totalProcessed} processed, ${totalUpserted} updated ===\n`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("FATAL SYNC ERROR:", err);
  process.exit(1);
});

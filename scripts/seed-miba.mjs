// Seeds the MIBA catalogue structure (and optionally a demo catalogue).
// Idempotent: existing categories (by slug) and products (by SKU) are left alone.
//
//   node scripts/seed-miba.mjs                    # categories only
//   node scripts/seed-miba.mjs --demo-products    # + sample Chinese-car parts
//
// Optional demo wholesale account (pre-created, must change password on first login):
//   SEED_WHOLESALE_EMAIL=partner@example.ir SEED_WHOLESALE_PASSWORD='...' node scripts/seed-miba.mjs
//
// Docker:  docker compose run --rm app node scripts/seed-miba.mjs --demo-products
import dotenv from "dotenv";
import mongoose from "mongoose";
import Category from "../backend/models/category.model.js";
import Product from "../backend/models/product.model.js";
import User from "../backend/models/user.model.js";

dotenv.config();

const args = new Set(process.argv.slice(2));
if (!process.env.MONGO_URI) { console.error("MONGO_URI must be configured."); process.exit(1); }

const categories = [
  { slug: "engine", fa: "قطعات موتوری", en: "Engine parts", description: "تسمه تایم، واشر سرسیلندر، شمع، پمپ روغن و سایر قطعات موتور." },
  { slug: "brakes", fa: "سیستم ترمز", en: "Brakes", description: "لنت، دیسک، کاسه چرخ، پمپ و شیلنگ ترمز." },
  { slug: "suspension", fa: "جلوبندی و تعلیق", en: "Suspension & steering", description: "کمک‌فنر، طبق، سیبک، بوش و قطعات فرمان." },
  { slug: "filters", fa: "فیلترها", en: "Filters", description: "فیلتر روغن، هوا، بنزین و کابین." },
  { slug: "electrical", fa: "برق و الکترونیک", en: "Electrical", description: "سنسورها، باتری، دینام، استارت، کوئل و چراغ‌ها." },
  { slug: "body", fa: "بدنه و تزئینات", en: "Body & trim", description: "سپر، آینه، چراغ جلو و عقب، دستگیره و قطعات بدنه." },
  { slug: "transmission", fa: "گیربکس و کلاچ", en: "Transmission & clutch", description: "دیسک و صفحه کلاچ، بلبرینگ، روغن و قطعات گیربکس." },
  { slug: "cooling", fa: "سیستم خنک‌کاری", en: "Cooling", description: "رادیاتور، واترپمپ، ترموستات و فن." },
];

const fit = (make, model, yearFrom = null, yearTo = null, engine = "") => ({ make, model, yearFrom, yearTo, engine });
const demoProducts = [
  { sku: "T11-3501080", name: "لنت ترمز جلو چری تیگو ۵", category: "brakes", price: 1_850_000, wholesalePrice: 1_480_000, wholesaleMinQuantity: 4, stock: 120, brand: "Chery", quality: "genuine", countryOfOrigin: "چین", warrantyMonths: 6, oemNumbers: ["T11-3501080", "T113501080BA"], fitments: [fit("چری", "تیگو ۵", 2015, 2022), fit("ام‌وی‌ام", "X55", 2018, 2023)], isFeatured: true },
  { sku: "A11-1109111", name: "فیلتر هوای موتور ام‌وی‌ام ۱۱۰", category: "filters", price: 420_000, wholesalePrice: 310_000, wholesaleMinQuantity: 10, stock: 400, brand: "MVM", quality: "oem", countryOfOrigin: "چین", warrantyMonths: 0, oemNumbers: ["A11-1109111"], fitments: [fit("ام‌وی‌ام", "110", 2010, 2016), fit("ام‌وی‌ام", "315", 2010, 2017)], isFeatured: true },
  { sku: "481H-1012010", name: "فیلتر روغن موتور ۴۸۱ چری", category: "filters", price: 290_000, wholesalePrice: 205_000, wholesaleMinQuantity: 20, stock: 800, brand: "Chery", quality: "genuine", countryOfOrigin: "چین", oemNumbers: ["481H-1012010"], fitments: [fit("چری", "تیگو ۵"), fit("ام‌وی‌ام", "X33"), fit("ام‌وی‌ام", "530"), fit("ام‌وی‌ام", "550")] },
  { sku: "S11-1307010", name: "واترپمپ ام‌وی‌ام ۱۱۰ و ۳۱۵", category: "cooling", price: 2_650_000, wholesalePrice: 2_150_000, wholesaleMinQuantity: 3, stock: 45, brand: "Chery", quality: "genuine", countryOfOrigin: "چین", warrantyMonths: 12, oemNumbers: ["S11-1307010"], fitments: [fit("ام‌وی‌ام", "110"), fit("ام‌وی‌ام", "315")], isFeatured: true },
  { sku: "2905100-J5", name: "کمک‌فنر جلو جک J5", category: "suspension", price: 3_900_000, wholesalePrice: 3_250_000, wholesaleMinQuantity: 2, stock: 30, brand: "JAC", quality: "oem", countryOfOrigin: "چین", warrantyMonths: 12, oemNumbers: ["2905100U1510"], fitments: [fit("جک", "J5", 2014, 2020)] },
  { sku: "H6-3707100", name: "کوئل جرقه هاوال H6", category: "electrical", price: 2_200_000, wholesalePrice: 1_790_000, wholesaleMinQuantity: 4, stock: 60, brand: "Great Wall", quality: "genuine", countryOfOrigin: "چین", warrantyMonths: 6, oemNumbers: ["3705100XEG01"], fitments: [fit("هاوال", "H6", 2016, 2021, "1.5T"), fit("هاوال", "H2", 2016, 2020, "1.5T")], isFeatured: true },
  { sku: "GE-EC7-4121", name: "چراغ جلو چپ جیلی امگرند ۷", category: "body", price: 8_400_000, wholesalePrice: 7_300_000, wholesaleMinQuantity: 2, stock: 12, brand: "Geely", quality: "aftermarket", countryOfOrigin: "چین", warrantyMonths: 3, oemNumbers: ["1067001278"], fitments: [fit("جیلی", "امگرند ۷", 2012, 2018)] },
  { sku: "LF-1601200", name: "دیسک و صفحه کلاچ لیفان X60", category: "transmission", price: 5_600_000, wholesalePrice: 4_700_000, wholesaleMinQuantity: 2, stock: 25, brand: "Valeo", quality: "aftermarket", countryOfOrigin: "کره جنوبی", warrantyMonths: 12, oemNumbers: ["LFB479Q-1601200A"], fitments: [fit("لیفان", "X60", 2012, 2018)] },
  { sku: "BYD-F3-3501", name: "دیسک ترمز جلو بی‌وای‌دی F3", category: "brakes", price: 2_950_000, wholesalePrice: 2_400_000, wholesaleMinQuantity: 4, stock: 40, brand: "BYD", quality: "oem", countryOfOrigin: "چین", warrantyMonths: 6, oemNumbers: ["10120211-00"], fitments: [fit("بی‌وای‌دی", "F3", 2008, 2016)] },
  { sku: "BR-H230-1025", name: "تسمه تایم برلیانس H230", category: "engine", price: 1_350_000, wholesalePrice: 1_050_000, wholesaleMinQuantity: 5, stock: 90, brand: "Gates", quality: "aftermarket", countryOfOrigin: "آلمان", warrantyMonths: 6, oemNumbers: ["4A91-1021025"], fitments: [fit("برلیانس", "H230", 2015, 2019), fit("برلیانس", "H220", 2015, 2019)] },
  { sku: "DF-H30-3610", name: "سنسور اکسیژن دانگ‌فنگ H30 کراس", category: "electrical", price: 3_100_000, wholesalePrice: 2_550_000, wholesaleMinQuantity: 3, stock: 18, brand: "Bosch", quality: "oem", countryOfOrigin: "چین", warrantyMonths: 6, oemNumbers: ["0258006537"], fitments: [fit("دانگ‌فنگ", "H30 کراس", 2015, 2020)] },
  { sku: "ARZ-1301100", name: "رادیاتور آب ام‌وی‌ام آریزو ۵", category: "cooling", price: 6_800_000, wholesalePrice: 5_900_000, wholesaleMinQuantity: 2, stock: 9, brand: "Chery", quality: "genuine", countryOfOrigin: "چین", warrantyMonths: 12, oemNumbers: ["J52-1301110"], fitments: [fit("ام‌وی‌ام", "آریزو ۵", 2016, 2022), fit("چری", "آریزو ۵", 2016, 2022)] },
];

const descriptionFor = (product) => `${product.name} با کد فنی ${product.oemNumbers.join("، ")}، کیفیت ${{ genuine: "اصلی (جنیون)", oem: "OEM / شرکتی", aftermarket: "یدکی تجاری", used: "استوک" }[product.quality]} و ساخت ${product.countryOfOrigin}. سازگار با: ${product.fitments.map((item) => `${item.make} ${item.model}`.trim()).join("، ")}.`;

try {
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([Category.init(), Product.init(), User.init()]);
  let createdCategories = 0;
  for (const [index, category] of categories.entries()) {
    const result = await Category.updateOne(
      { slug: category.slug },
      { $setOnInsert: {
        slug: category.slug, name: { fa: category.fa, en: category.en },
        description: { fa: category.description, en: "" }, image: `/categories/${category.slug}.svg`,
        sortOrder: index * 10, isActive: true, showInNavigation: true, parentId: null, ancestors: [],
      } },
      { upsert: true }
    );
    createdCategories += result.upsertedCount || 0;
  }
  console.log(`Categories: ${createdCategories} created, ${categories.length - createdCategories} already present.`);

  if (args.has("--demo-products")) {
    const bySlug = new Map((await Category.find({ slug: { $in: categories.map((item) => item.slug) } }).lean()).map((item) => [item.slug, item]));
    let createdProducts = 0;
    for (const product of demoProducts) {
      if (await Product.exists({ sku: product.sku })) continue;
      await Product.create({
        ...product, description: descriptionFor(product),
        categoryId: bySlug.get(product.category)?._id || null,
        image: `/categories/${product.category}.svg`, images: [`/categories/${product.category}.svg`], isActive: true,
      });
      createdProducts += 1;
    }
    console.log(`Demo products: ${createdProducts} created.`);
  }

  const wholesaleEmail = (process.env.SEED_WHOLESALE_EMAIL || "").trim().toLowerCase();
  if (wholesaleEmail) {
    if (await User.exists({ email: wholesaleEmail })) console.log("Wholesale demo account already exists; unchanged.");
    else {
      await User.create({
        name: "همکار نمونه", email: wholesaleEmail, password: process.env.SEED_WHOLESALE_PASSWORD || "",
        role: "customer", accountType: "wholesale", mustChangePassword: true,
        wholesaleProfile: { companyName: "لوازم یدکی نمونه", city: "تهران", discountPercent: 0 },
      });
      console.log("Wholesale demo account created (password change required on first login).");
    }
  }
} catch (error) {
  console.error("Seeding failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

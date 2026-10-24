import dotenv from "dotenv";
import mongoose from "mongoose";
import Category from "../backend/models/category.model.js";
import Product from "../backend/models/product.model.js";

dotenv.config();

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI must be configured before migrating categories.");
  process.exit(1);
}

const option = (value, fa, en) => ({ value, name: { fa, en } });
const attribute = (key, fa, en, type, options = [], extra = {}) => ({
  key, name: { fa, en }, type, options, required: false, filterable: true,
  searchable: true, inherited: true, sortOrder: 0, ...extra,
});

const definitions = [
  { slug: "tops", fa: "بالاتنه", en: "Tops", image: "/tshirts.jpg", order: 10, nav: true,
    attributes: [
      attribute("sleeve_length", "طول آستین", "Sleeve length", "select", [
        option("short", "کوتاه", "Short"), option("long", "بلند", "Long"), option("sleeveless", "بدون آستین", "Sleeveless"),
      ]),
      attribute("neckline", "یقه", "Neckline", "select", [
        option("crew", "گرد", "Crew neck"), option("v-neck", "هفت", "V-neck"), option("polo", "پولوشرت", "Polo"),
      ]),
    ] },
  { slug: "t-shirts", fa: "تی‌شرت", en: "T-shirts", parent: "tops", image: "/tshirts.jpg", order: 10 },
  { slug: "hoodies", fa: "هودی", en: "Hoodies", parent: "tops", image: "/tshirts.jpg", order: 20 },
  { slug: "sweatshirts", fa: "سویشرت", en: "Sweatshirts", parent: "tops", image: "/tshirts.jpg", order: 30 },
  { slug: "trousers", fa: "شلوار و پایین‌تنه", en: "Trousers & bottoms", image: "/jeans.jpg", order: 20, nav: true,
    attributes: [
      attribute("leg_cut", "مدل پاچه", "Leg cut", "select", [
        option("slim", "اسلیم", "Slim"), option("straight", "راسته", "Straight"), option("baggy", "بگ", "Baggy"),
        option("wide-leg", "واید لگ", "Wide-leg"), option("bootcut", "بوت‌کات", "Bootcut"),
      ]),
      attribute("rise", "فاق", "Rise", "select", [
        option("low", "فاق کوتاه", "Low"), option("mid", "فاق متوسط", "Mid"), option("high", "فاق بلند", "High"),
      ]),
    ] },
  { slug: "jeans", fa: "شلوار جین", en: "Jeans", parent: "trousers", image: "/jeans.jpg", order: 10,
    attributes: [
      attribute("denim_wash", "رنگ‌شست جین", "Denim wash", "select", [
        option("light", "روشن", "Light wash"), option("medium", "متوسط", "Medium wash"), option("dark", "تیره", "Dark wash"),
        option("black", "مشکی", "Black"),
      ], { inherited: false }),
    ] },
  { slug: "cargo-pants", fa: "شلوار کارگو", en: "Cargo pants", parent: "trousers", image: "/jeans.jpg", order: 20 },
  { slug: "chinos", fa: "شلوار کتان", en: "Chinos", parent: "trousers", image: "/jeans.jpg", order: 30 },
  { slug: "tailored-trousers", fa: "شلوار پارچه‌ای", en: "Tailored trousers", parent: "trousers", image: "/jeans.jpg", order: 40 },
  { slug: "joggers", fa: "جاگر و اسلش", en: "Joggers & sweatpants", parent: "trousers", image: "/jeans.jpg", order: 50 },
  { slug: "shorts", fa: "شلوارک", en: "Shorts", parent: "trousers", image: "/jeans.jpg", order: 60 },
  { slug: "outerwear", fa: "لباس‌های رویی", en: "Outerwear", image: "/jackets.jpg", order: 30, nav: true,
    attributes: [
      attribute("season", "فصل", "Season", "multi-select", [
        option("spring", "بهار", "Spring"), option("autumn", "پاییز", "Autumn"), option("winter", "زمستان", "Winter"),
      ]),
    ] },
  { slug: "jackets", fa: "کت و کاپشن", en: "Jackets", parent: "outerwear", image: "/jackets.jpg", order: 10 },
  { slug: "denim-jackets", fa: "کت جین", en: "Denim jackets", parent: "jackets", image: "/jackets.jpg", order: 10 },
  { slug: "bomber-jackets", fa: "کت بامبر", en: "Bomber jackets", parent: "jackets", image: "/jackets.jpg", order: 20 },
  { slug: "varsity-jackets", fa: "کت ورسیتی", en: "Varsity jackets", parent: "jackets", image: "/jackets.jpg", order: 30 },
  { slug: "windbreakers", fa: "بادگیر", en: "Windbreakers", parent: "jackets", image: "/jackets.jpg", order: 40 },
  { slug: "puffer-jackets", fa: "کاپشن پافر", en: "Puffer jackets", parent: "jackets", image: "/jackets.jpg", order: 50 },
  { slug: "suits", fa: "کت‌وشلوار", en: "Suits", image: "/suits.jpg", order: 40, nav: true },
  { slug: "footwear", fa: "کفش", en: "Footwear", image: "/shoes.jpg", order: 50, nav: true },
  { slug: "shoes", fa: "کفش", en: "Shoes", parent: "footwear", image: "/shoes.jpg", order: 10 },
  { slug: "accessories", fa: "اکسسوری", en: "Accessories", image: "/bags.jpg", order: 60, nav: true },
  { slug: "glasses", fa: "عینک", en: "Glasses", parent: "accessories", image: "/glasses.png", order: 10 },
  { slug: "bags", fa: "کیف", en: "Bags", parent: "accessories", image: "/bags.jpg", order: 20 },
];

let migratedProducts = 0;
try {
  await mongoose.connect(process.env.MONGO_URI);
  const ids = new Map();
  for (const item of definitions) {
    const parent = item.parent ? (ids.get(item.parent) || await Category.findOne({ slug: item.parent })) : null;
    if (item.parent && !parent) throw new Error("Missing parent seed: " + item.parent);
    const ancestors = parent ? [...parent.ancestors, parent._id] : [];
    const category = await Category.findOneAndUpdate(
      { slug: item.slug },
      { $setOnInsert: {
        name: { fa: item.fa, en: item.en }, slug: item.slug, parentId: parent?._id || null, ancestors,
        description: { fa: "", en: "" }, image: item.image || "", sortOrder: item.order || 0,
        isActive: true, showInNavigation: item.nav === true, attributes: item.attributes || [],
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    ids.set(item.slug, category);
  }

  for (const item of definitions) {
    const category = ids.get(item.slug);
    const result = await Product.updateMany(
      { category: item.slug, $or: [{ categoryId: null }, { categoryId: { $exists: false } }] },
      { $set: { categoryId: category._id } }
    );
    migratedProducts += result.modifiedCount || 0;
  }

  const existingSlugs = new Set(definitions.map((item) => item.slug));
  const legacyValues = await Product.distinct("category");
  const unmapped = legacyValues.filter((value) => value && !existingSlugs.has(String(value)));
  console.log("Category migration completed.");
  console.log("Default categories available: " + definitions.length);
  console.log("Legacy products linked to categories: " + migratedProducts);
  if (unmapped.length) {
    console.warn("These legacy category values were not changed and need manual mapping:", unmapped);
  }
} catch (error) {
  console.error("Category migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}

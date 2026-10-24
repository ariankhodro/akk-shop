import { redis } from "../lib/redis.js";
import cloudinary from "../lib/cloudinary.js";
import Product from "../models/product.model.js";
import Category from "../models/category.model.js";
import Order from "../models/order.model.js";
import { normalizePersianText, escapeSearchRegex } from "../lib/persian-search.js";
import { recordAuditEvent } from "../lib/audit-log.js";

const idOf = (value) => value == null ? "" : String(value);
const getCategoryProductScope = async (slug) => {
  const selected = await Category.findOne({ slug }).lean();
  if (!selected) return null;
  const all = await Category.find({}).select("_id slug parentId ancestors isActive").lean();
  const activeIds = new Set(all.filter((category) => category.isActive).map((category) => idOf(category._id)));
  const visible = all.filter((category) =>
    category.isActive && (category.ancestors || []).every((ancestor) => activeIds.has(idOf(ancestor)))
  );
  const selectedId = idOf(selected._id);
  if (!visible.some((category) => idOf(category._id) === selectedId)) return { ids: [], slugs: [] };
  const scope = visible.filter((category) =>
    idOf(category._id) === selectedId ||
    (category.ancestors || []).some((ancestor) => idOf(ancestor) === selectedId)
  );
  return { ids: scope.map((category) => category._id), slugs: scope.map((category) => category.slug) };
};

const validateProductAttributes = async (category, input) => {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const ids = [...(category.ancestors || []), category._id];
  const categories = await Category.find({ _id: { $in: ids } }).lean();
  categories.sort((a, b) => (a.ancestors || []).length - (b.ancestors || []).length);
  const definitions = new Map();
  for (const item of categories) {
    const isCurrent = idOf(item._id) === idOf(category._id);
    for (const attribute of item.attributes || []) {
      if (isCurrent || attribute.inherited !== false) definitions.set(attribute.key, attribute);
    }
  }
  for (const key of Object.keys(raw)) {
    if (!definitions.has(key)) return { error: "ویژگی نامعتبر برای این دسته‌بندی: " + key };
  }
  const values = {};
  for (const [key, definition] of definitions) {
    let value = raw[key];
    const missing = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (missing) {
      if (definition.required) return { error: "ویژگی «" + (definition.name?.fa || key) + "» الزامی است." };
      continue;
    }
    if (definition.type === "select") {
      if (typeof value !== "string" || !(definition.options || []).some((option) => option.value === value)) {
        return { error: "مقدار ویژگی «" + (definition.name?.fa || key) + "» معتبر نیست." };
      }
    } else if (definition.type === "multi-select") {
      if (!Array.isArray(value) || value.some((entry) =>
        typeof entry !== "string" || !(definition.options || []).some((option) => option.value === entry)
      )) return { error: "گزینه‌های ویژگی «" + (definition.name?.fa || key) + "» معتبر نیستند." };
    } else if (definition.type === "boolean") {
      if (typeof value !== "boolean") return { error: "مقدار ویژگی «" + (definition.name?.fa || key) + "» باید بله یا خیر باشد." };
    } else if (definition.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value)) return { error: "مقدار ویژگی «" + (definition.name?.fa || key) + "» باید عددی باشد." };
    } else if (definition.type === "text") {
      if (typeof value !== "string" || value.length > 500) return { error: "مقدار متنی ویژگی «" + (definition.name?.fa || key) + "» معتبر نیست." };
    }
    values[key] = value;
  }
  return { values };
};

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
let cacheWarningLogged = false;
const readJsonCache = async (key) => {
  try {
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    if (!cacheWarningLogged) {
      console.warn("Redis cache unavailable; continuing with database reads:", error.message);
      cacheWarningLogged = true;
    }
    return null;
  }
};
const writeJsonCache = async (key, value, ttlSeconds) => {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    if (!cacheWarningLogged) {
      console.warn("Redis cache unavailable; continuing without cache writes:", error.message);
      cacheWarningLogged = true;
    }
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(req.query.limit, 12, 1, 50);
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 96) : "";
    const stock = typeof req.query.stock === "string" ? req.query.stock : "";
    const requestedStatus = typeof req.query.status === "string" ? req.query.status : "active";
    const status = ["active", "archived", "all"].includes(requestedStatus) ? requestedStatus : "active";
    const clauses = [];
    const filter = {};

    if (status === "active") filter.isActive = { $ne: false };
    else if (status === "archived") filter.isActive = false;

    if (rawQuery) {
      const normalized = normalizePersianText(rawQuery).slice(0, 80);
      const rawPattern = new RegExp(escapeSearchRegex(rawQuery), "i");
      const normalizedPattern = new RegExp(escapeSearchRegex(normalized), "i");
      clauses.push({ $or: [
        { searchTextNormalized: normalizedPattern },
        { name: rawPattern },
        { description: rawPattern },
        { category: rawPattern },
      ] });
    }
    if (category) {
      const categoryRecord = await Category.findOne({ slug: category }).select("_id").lean();
      const categoryMatches = [{ category }];
      if (categoryRecord) categoryMatches.push({ categoryId: categoryRecord._id });
      clauses.push({ $or: categoryMatches });
    }
    if (stock === "in_stock") {
      clauses.push({ $or: [
        { variants: { $elemMatch: { stock: { $gt: 0 } } } },
        { $and: [{ stock: { $gt: 0 } }, { $or: [{ variants: { $size: 0 } }, { variants: { $exists: false } }] }] },
      ] });
    } else if (stock === "out_of_stock") {
      clauses.push({ $or: [
        { stock: 0, $or: [{ variants: { $size: 0 } }, { variants: { $exists: false } }] },
        { $expr: { $and: [
          { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
          { $eq: [
            { $size: { $filter: { input: { $ifNull: ["$variants", []] }, as: "variant", cond: { $gt: ["$$variant.stock", 0] } } } },
            0,
          ] },
        ] } },
      ] });
    } else if (stock === "untracked") {
      clauses.push({ stock: null, $or: [{ variants: { $size: 0 } }, { variants: { $exists: false } }] });
    }
    if (clauses.length) filter.$and = clauses;

    const sort = req.query.sort === "priceAsc"
      ? { price: 1, _id: 1 }
      : req.query.sort === "nameAsc"
        ? { name: 1, _id: 1 }
        : { createdAt: -1, _id: -1 };
    const [total, products] = await Promise.all([
      Product.countDocuments(filter).maxTimeMS(1500),
      Product.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).maxTimeMS(1500).lean(),
    ]);
    return res.json({ products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Error in getAllProducts controller", error.message);
    return res.status(500).json({ message: "دریافت محصولات ناموفق بود." });
  }
};

export const getProductById = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, isActive: { $ne: false } }).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });
    return res.json(product);
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid product ID" });
    console.error("Error in getProductById controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getFeaturedProducts = async (_req, res) => {
  const cached = await readJsonCache("featured_products_v2");
  if (Array.isArray(cached)) return res.json(cached);
  try {
    const featuredProducts = await Product.find({ isFeatured: true, isActive: { $ne: false } })
      .sort({ createdAt: -1, _id: -1 }).limit(100).maxTimeMS(1500).lean();
    await writeJsonCache("featured_products_v2", featuredProducts, 300);
    return res.json(featuredProducts);
  } catch (error) {
    console.error("Error in getFeaturedProducts controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getNewestProducts = async (req, res) => {
  try {
    const limit = clampInteger(req.query.limit, 8, 1, 24);
    const products = await Product.find({ isActive: { $ne: false } })
      .sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return res.json({ products });
  } catch (error) {
    console.error("Error in getNewestProducts controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getProductPriceBounds = async (_req, res) => {
  const cacheKey = "product_price_bounds_v1";
  const cached = await readJsonCache(cacheKey);
  if (cached) return res.json({ priceBounds: cached });

  try {
    const [stats] = await Product.aggregate([
      { $match: { isActive: { $ne: false }, price: { $gte: 0 } } },
      {
        $group: {
          _id: null,
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" },
          count: { $sum: 1 },
        },
      },
    ]).option({ maxTimeMS: 1500 });

    const min = Number(stats?.minPrice);
    const max = Number(stats?.maxPrice);
    const priceBounds = {
      minPrice: Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0,
      maxPrice: Number.isFinite(max) ? Math.max(1, Math.ceil(max)) : 1,
      count: Number(stats?.count || 0),
    };
    await writeJsonCache(cacheKey, priceBounds, 60);
    return res.json({ priceBounds });
  } catch (error) {
    console.error("Error in getProductPriceBounds controller", error.message);
    return res.status(500).json({ message: "Unable to load product price bounds" });
  }
};

export const getSearchedProducts = async (req, res) => {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const q = normalizePersianText(rawQuery).slice(0, 80);
    const category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 64) : "";
    const page = clampInteger(req.query.page, 1, 1, 5000);
    const limit = clampInteger(req.query.limit, 24, 1, 48);
    const minPrice = req.query.minPrice === undefined || req.query.minPrice === "" ? null : Number(req.query.minPrice);
    const maxPrice = req.query.maxPrice === undefined || req.query.maxPrice === "" ? null : Number(req.query.maxPrice);

    if ((minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) ||
        (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0))) {
      return res.status(400).json({ message: "Price filters must be non-negative numbers" });
    }
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      return res.status(400).json({ message: "Minimum price cannot exceed maximum price" });
    }

    const filter = { isActive: { $ne: false } };
    if (category) {
      const scope = await getCategoryProductScope(category);
      if (scope) {
        filter.$or = [
          { categoryId: { $in: scope.ids } },
          { category: { $in: scope.slugs } },
        ];
      } else {
        filter.category = category;
      }
    }
    if (q) {
      // Match each normalized token so word order is flexible in Persian and Latin queries.
      const tokens = [...new Set(q.split(" ").filter(Boolean))].slice(0, 8);
      filter.$and = tokens.map((token) => {
        const expression = new RegExp(escapeSearchRegex(token));
        return {
          $or: [
            { searchTextNormalized: expression },
            // Compatibility while existing catalogue documents are being backfilled.
            { name: new RegExp(escapeSearchRegex(rawQuery), "i") },
            { description: new RegExp(escapeSearchRegex(rawQuery), "i") },
            { category: new RegExp(escapeSearchRegex(rawQuery), "i") },
          ],
        };
      });
    }
    if (minPrice !== null || maxPrice !== null) {
      filter.price = {};
      if (minPrice !== null) filter.price.$gte = minPrice;
      if (maxPrice !== null) filter.price.$lte = maxPrice;
    }

    const sortMap = {
      newest: { createdAt: -1, _id: -1 },
      oldest: { createdAt: 1, _id: 1 },
      priceAsc: { price: 1, _id: 1 },
      priceDesc: { price: -1, _id: -1 },
      nameAsc: { name: 1, _id: 1 },
    };
    const sort = sortMap[req.query.sort] || sortMap.newest;
    const [total, products] = await Promise.all([
      Product.countDocuments(filter).maxTimeMS(1500),
      Product.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).maxTimeMS(1500).lean(),
    ]);
    return res.json({ products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Error in getSearchedProducts controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const createProduct = async (req, res) => {
  try {
    const {
      name, description, price, image, images, category, categoryId, attributes, stock,
      sizes, colors, variants, fit, sizeChart,
    } = req.body;
    let categoryRecord = null;
    if (categoryId !== undefined && categoryId !== null && categoryId !== "") {
      if (typeof categoryId !== "string" || !/^[a-f\d]{24}$/i.test(categoryId)) {
        return res.status(400).json({ message: "دسته‌بندی انتخاب‌شده معتبر نیست." });
      }
      categoryRecord = await Category.findOne({ _id: categoryId, isActive: true });
      if (!categoryRecord) return res.status(400).json({ message: "دسته‌بندی فعال پیدا نشد." });
    }
    const productCategory = categoryRecord ? categoryRecord.slug : (typeof category === "string" ? category.trim() : "");
    const normalizedAttributes = categoryRecord
      ? await validateProductAttributes(categoryRecord, attributes)
      : { values: attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {} };
    if (normalizedAttributes.error) return res.status(400).json({ message: normalizedAttributes.error });
    const numericPrice = price === "" || price === undefined || price === null ? Number.NaN : Number(price);
    const numericStock = stock === "" || stock === undefined || stock === null ? null : Number(stock);
    const normalizedSizes = Array.isArray(sizes)
      ? [...new Set(sizes.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))].slice(0, 24)
      : [];
    const normalizedColors = Array.isArray(colors)
      ? colors.filter((value) => value && typeof value.name === "string")
          .map((value) => ({ name: value.name.trim().slice(0, 40), hex: typeof value.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(value.hex) ? value.hex : "#d5d0c5" }))
          .filter((value) => value.name)
          .filter((value, index, list) => list.findIndex((entry) => entry.name.toLowerCase() === value.name.toLowerCase()) === index)
          .slice(0, 16)
      : [];
    const normalizedVariants = Array.isArray(variants)
      ? variants.map((variant) => ({
          size: typeof variant?.size === "string" ? variant.size.trim() : "",
          color: typeof variant?.color === "string" ? variant.color.trim() : "",
          stock: Number(variant?.stock),
        }))
      : [];
    const normalizedFit = fit && typeof fit === "object" ? {
      type: ["true-to-size", "slim", "regular", "relaxed", "oversized", "athletic"].includes(fit.type) ? fit.type : "regular",
      description: typeof fit.description === "string" ? fit.description.trim().slice(0, 500) : "",
      modelHeight: typeof fit.modelHeight === "string" ? fit.modelHeight.trim().slice(0, 40) : "",
      modelSize: typeof fit.modelSize === "string" ? fit.modelSize.trim().slice(0, 24) : "",
    } : { type: "regular", description: "", modelHeight: "", modelSize: "" };
    const normalizedSizeChart = Array.isArray(sizeChart)
      ? sizeChart.filter((row) => row && typeof row.size === "string" && row.size.trim())
          .slice(0, 24)
          .map((row) => {
            const measurement = (value) => value === "" || value === null || value === undefined ? null : Number(value);
            return {
              size: row.size.trim().slice(0, 24),
              chestCm: measurement(row.chestCm),
              waistCm: measurement(row.waistCm),
              hipsCm: measurement(row.hipsCm),
              lengthCm: measurement(row.lengthCm),
            };
          })
      : [];

    if (Number.isFinite(numericPrice) && !Number.isSafeInteger(numericPrice)) {
      return res.status(400).json({ message: "قیمت باید مبلغ صحیح و بدون اعشار به تومان باشد." });
    }
    if (typeof name !== "string" || !name.trim() ||
        typeof description !== "string" || !description.trim() ||
        typeof productCategory !== "string" || !productCategory ||
        !Number.isFinite(numericPrice) || numericPrice < 0 ||
        (numericStock !== null && (!Number.isInteger(numericStock) || numericStock < 0))) {
      return res.status(400).json({ message: "Provide valid product details, price, and stock" });
    }
    if (normalizedVariants.some((variant) => !Number.isInteger(variant.stock) || variant.stock < 0 ||
        (variant.size && !normalizedSizes.includes(variant.size)) ||
        (variant.color && !normalizedColors.some((color) => color.name === variant.color)))) {
      return res.status(400).json({ message: "Variant inventory or size/color options are invalid" });
    }
    if ((normalizedSizes.length > 0 || normalizedColors.length > 0) && normalizedVariants.length === 0) {
      return res.status(400).json({ message: "Add stock for each size/color combination" });
    }
    if (normalizedSizes.length > 0 && normalizedColors.length > 0) {
      const expectedCount = normalizedSizes.length * normalizedColors.length;
      if (normalizedVariants.length !== expectedCount) {
        return res.status(400).json({ message: "Every size and color combination needs an inventory value" });
      }
      const keys = new Set(normalizedVariants.map((variant) => `${variant.size}::${variant.color}`));
      if (keys.size !== expectedCount) {
        return res.status(400).json({ message: "Duplicate size/color combinations are not allowed" });
      }
    }
    if (normalizedSizeChart.some((row) =>
      ["chestCm", "waistCm", "hipsCm", "lengthCm"].some((key) =>
        row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0)
      )
    )) {
      return res.status(400).json({ message: "Size measurements must be non-negative numbers" });
    }

    const imageInputs = (Array.isArray(images) ? images : image ? [image] : [])
      .filter((value) => typeof value === "string" && value.trim())
      .slice(0, 8);
    const uploadedImages = [];
    for (const imageInput of imageInputs) {
      if (/^https:\/\//i.test(imageInput)) {
        uploadedImages.push(imageInput);
      } else {
        const response = await cloudinary.uploader.upload(imageInput, { folder: "products" });
        if (response.secure_url) uploadedImages.push(response.secure_url);
      }
    }

    const product = await Product.create({
      name: name.trim(),
      description: description.trim(),
      price: numericPrice,
      image: uploadedImages[0] || "",
      images: uploadedImages,
      category: productCategory,
      categoryId: categoryRecord?._id || null,
      attributes: normalizedAttributes.values || {},
      sizes: normalizedSizes,
      colors: normalizedColors,
      variants: normalizedVariants,
      fit: normalizedFit,
      sizeChart: normalizedSizeChart,
      stock: normalizedVariants.length ? null : numericStock,
    });
    await recordAuditEvent(req, {
      action: "product.created",
      targetType: "product",
      targetId: product._id,
      summary: "Product created: " + product.name,
      metadata: {
        after: {
          name: product.name,
          description: product.description,
          price: product.price,
          category: product.category,
          categoryId: product.categoryId ? String(product.categoryId) : null,
          imageCount: (product.images || []).length,
          primaryImage: product.image,
          images: product.images || [],
          sizes: product.sizes,
          colors: product.colors,
          variants: (product.variants || []).map(({ size, color, stock }) => ({ size, color, stock })),
          attributes: product.attributes instanceof Map ? Object.fromEntries(product.attributes) : (product.attributes || {}),
          fit: product.fit,
          sizeChart: product.sizeChart,
          stock: product.stock,
          isFeatured: product.isFeatured,
          isActive: product.isActive,
        },
      },
    });
    return res.status(201).json(product);
  } catch (error) {
    console.error("Error in createProduct controller", error.message);
    return res.status(500).json({ message: "Unable to create product" });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const numericPrice = body.price === "" || body.price === undefined || body.price === null ? Number.NaN : Number(body.price);
    const numericStock = body.stock === "" || body.stock === undefined || body.stock === null ? null : Number(body.stock);

    let categoryRecord = null;
    if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== "") {
      if (typeof body.categoryId !== "string" || !/^[a-f\d]{24}$/i.test(body.categoryId)) {
        return res.status(400).json({ message: "دسته‌بندی انتخاب‌شده معتبر نیست." });
      }
      categoryRecord = await Category.findOne({ _id: body.categoryId, isActive: true });
      if (!categoryRecord) return res.status(400).json({ message: "دسته‌بندی فعال پیدا نشد؛ یک دسته‌بندی فعال انتخاب کنید." });
    }
    const productCategory = categoryRecord ? categoryRecord.slug : (typeof body.category === "string" ? body.category.trim() : "");
    const rawAttributes = body.attributes && typeof body.attributes === "object" && !Array.isArray(body.attributes) ? body.attributes : {};
    const normalizedAttributes = categoryRecord
      ? await validateProductAttributes(categoryRecord, rawAttributes)
      : { values: rawAttributes };
    if (normalizedAttributes.error) return res.status(400).json({ message: normalizedAttributes.error });

    const normalizedSizes = Array.isArray(body.sizes)
      ? [...new Set(body.sizes.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))].slice(0, 24)
      : [];
    const normalizedColors = Array.isArray(body.colors)
      ? body.colors.filter((value) => value && typeof value.name === "string")
          .map((value) => ({ name: value.name.trim().slice(0, 40), hex: typeof value.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(value.hex) ? value.hex : "#d5d0c5" }))
          .filter((value) => value.name)
          .filter((value, index, list) => list.findIndex((entry) => entry.name.toLowerCase() === value.name.toLowerCase()) === index)
          .slice(0, 16)
      : [];
    const normalizedVariants = Array.isArray(body.variants)
      ? body.variants.map((variant) => ({
          size: typeof variant?.size === "string" ? variant.size.trim() : "",
          color: typeof variant?.color === "string" ? variant.color.trim() : "",
          stock: Number(variant?.stock),
        }))
      : [];
    const normalizedFit = body.fit && typeof body.fit === "object" ? {
      type: ["true-to-size", "slim", "regular", "relaxed", "oversized", "athletic"].includes(body.fit.type) ? body.fit.type : "regular",
      description: typeof body.fit.description === "string" ? body.fit.description.trim().slice(0, 500) : "",
      modelHeight: typeof body.fit.modelHeight === "string" ? body.fit.modelHeight.trim().slice(0, 40) : "",
      modelSize: typeof body.fit.modelSize === "string" ? body.fit.modelSize.trim().slice(0, 24) : "",
    } : { type: "regular", description: "", modelHeight: "", modelSize: "" };
    const normalizedSizeChart = Array.isArray(body.sizeChart)
      ? body.sizeChart.filter((row) => row && typeof row.size === "string" && row.size.trim()).slice(0, 24).map((row) => {
          const measurement = (value) => value === "" || value === null || value === undefined ? null : Number(value);
          return {
            size: row.size.trim().slice(0, 24),
            chestCm: measurement(row.chestCm),
            waistCm: measurement(row.waistCm),
            hipsCm: measurement(row.hipsCm),
            lengthCm: measurement(row.lengthCm),
          };
        })
      : [];

    if (name.length > 160 || !name || description.length > 5000 || !description || !productCategory ||
        !Number.isSafeInteger(numericPrice) || numericPrice < 0 ||
        (numericStock !== null && (!Number.isInteger(numericStock) || numericStock < 0))) {
      return res.status(400).json({ message: "نام، توضیحات، دسته‌بندی، قیمت صحیح و موجودی معتبر را وارد کنید." });
    }
    if (!Array.isArray(body.variants) && product.variants?.length && numericStock === null) {
      return res.status(400).json({ message: "برای حذف گزینه‌های دارای موجودی، ابتدا موجودی کل جدید را ثبت کنید." });
    }
    if (Array.isArray(body.variants) && normalizedVariants.length === 0 && product.variants?.length && numericStock === null) {
      return res.status(400).json({ message: "برای حذف گزینه‌های دارای موجودی، ابتدا موجودی کل جدید را ثبت کنید." });
    }
    if (!normalizedVariants.length && numericStock === null && product.stock !== null && product.stock !== undefined) {
      return res.status(400).json({ message: "برای کالای دارای موجودی، مقدار جدیدی وارد کنید یا گزینه‌های موجودی را تعریف کنید." });
    }
    if (normalizedVariants.some((variant) => !Number.isInteger(variant.stock) || variant.stock < 0 ||
        (variant.size && !normalizedSizes.includes(variant.size)) ||
        (variant.color && !normalizedColors.some((color) => color.name === variant.color)))) {
      return res.status(400).json({ message: "موجودی یا ترکیب سایز و رنگ معتبر نیست." });
    }
    if ((normalizedSizes.length > 0 || normalizedColors.length > 0) && normalizedVariants.length === 0) {
      return res.status(400).json({ message: "برای هر ترکیب سایز و رنگ موجودی ثبت کنید." });
    }
    if (normalizedSizes.length > 0 || normalizedColors.length > 0) {
      const expectedCount = (normalizedSizes.length || 1) * (normalizedColors.length || 1);
      const keys = new Set(normalizedVariants.map((variant) => variant.size + "::" + variant.color));
      if (normalizedVariants.length !== expectedCount || keys.size !== expectedCount) {
        return res.status(400).json({ message: "هر ترکیب یکتای سایز و رنگ باید دقیقاً یک مقدار موجودی داشته باشد." });
      }
    }
    if (normalizedSizeChart.some((row) => ["chestCm", "waistCm", "hipsCm", "lengthCm"].some((key) =>
      row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0)
    ))) {
      return res.status(400).json({ message: "اندازه‌های جدول سایز باید عددی نامنفی باشند." });
    }

    const imageInputs = (Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []))
      .filter((value) => typeof value === "string" && value.trim()).slice(0, 8);
    if ((Array.isArray(body.images) && body.images.length > 8) ||
        imageInputs.some((value) => !/^https:\/\//i.test(value) && !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value))) {
      return res.status(400).json({ message: "فرمت تصاویر محصول معتبر نیست." });
    }
    const uploadedImages = [];
    for (const imageInput of imageInputs) {
      if (/^https:\/\//i.test(imageInput)) {
        uploadedImages.push(imageInput);
      } else {
        const response = await cloudinary.uploader.upload(imageInput, { folder: "products" });
        if (response.secure_url) uploadedImages.push(response.secure_url);
      }
    }

    const snapshot = (item) => ({
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      categoryId: item.categoryId ? String(item.categoryId) : null,
      images: item.images || [],
      sizes: item.sizes || [],
      colors: item.colors || [],
      variants: (item.variants || []).map(({ size, color, stock }) => ({ size, color, stock })),
      attributes: item.attributes instanceof Map ? Object.fromEntries(item.attributes) : (item.attributes || {}),
      fit: item.fit,
      sizeChart: item.sizeChart || [],
      stock: item.stock,
      isFeatured: item.isFeatured,
      isActive: item.isActive,
    });
    const before = snapshot(product);

    product.name = name;
    product.description = description;
    product.price = numericPrice;
    product.image = uploadedImages[0] || "";
    product.images = uploadedImages;
    product.category = productCategory;
    product.categoryId = categoryRecord?._id || null;
    product.attributes = normalizedAttributes.values || {};
    product.sizes = normalizedSizes;
    product.colors = normalizedColors;
    product.variants = normalizedVariants;
    product.fit = normalizedFit;
    product.sizeChart = normalizedSizeChart;
    product.stock = normalizedVariants.length ? null : numericStock;
    await product.save();

    await updateFeaturedProductsCache();
    await recordAuditEvent(req, {
      action: "product.updated",
      targetType: "product",
      targetId: product._id,
      summary: "Product updated: " + product.name,
      metadata: { productName: product.name, before, after: snapshot(product) },
    });
    return res.json(product);
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "شناسه محصول معتبر نیست." });
    console.error("Error updating product", error.message);
    return res.status(500).json({ message: "به‌روزرسانی محصول ناموفق بود." });
  }
};

export const setProductActive = async (req, res) => {
  if (typeof req.body?.isActive !== "boolean") return res.status(400).json({ message: "وضعیت انتشار معتبر نیست." });
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    const previous = product.isActive !== false;
    const next = req.body.isActive;
    if (previous === next) return res.json(product);
    product.isActive = next;
    await product.save();
    await updateFeaturedProductsCache();
    await recordAuditEvent(req, {
      action: next ? "product.restored" : "product.archived",
      targetType: "product",
      targetId: product._id,
      summary: (next ? "Product restored: " : "Product archived: ") + product.name,
      metadata: {
        productName: product.name,
        before: { isActive: previous },
        after: { isActive: next },
        changes: { isActive: { before: previous, after: next } },
      },
    });
    return res.json(product);
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "شناسه محصول معتبر نیست." });
    console.error("Error changing product publication state", error.message);
    return res.status(500).json({ message: "تغییر وضعیت انتشار ناموفق بود." });
  }
};

export const updateProductStock = async (req, res) => {
  const stock = Number(req.body.stock);
  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ message: "Stock must be a non-negative whole number" });
  }
  try {
    const beforeProduct = await Product.findById(req.params.id).select("name category stock").lean();
    if (!beforeProduct) return res.status(404).json({ message: "Product not found" });
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { stock } },
      { new: true, runValidators: true }
    ).select("_id stock");
    if (!product) return res.status(404).json({ message: "Product not found" });
    await updateFeaturedProductsCache();
    await recordAuditEvent(req, {
      action: "product.stock_updated",
      targetType: "product",
      targetId: product._id,
      summary: "Product stock updated: " + beforeProduct.name,
      metadata: {
        productName: beforeProduct.name,
        category: beforeProduct.category,
        before: { stock: beforeProduct.stock },
        after: { stock: product.stock },
        changes: { stock: { before: beforeProduct.stock, after: product.stock } },
      },
    });
    return res.json({ _id: product._id, stock: product.stock });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid product ID" });
    console.error("Error updating product stock", error.message);
    return res.status(500).json({ message: "Unable to update stock" });
  }
};


export const updateProductVariantStock = async (req, res) => {
  const size = typeof req.body.size === "string" ? req.body.size.trim() : "";
  const color = typeof req.body.color === "string" ? req.body.color.trim() : "";
  const stock = Number(req.body.stock);
  if (!Number.isInteger(stock) || stock < 0 || (req.body.size !== undefined && typeof req.body.size !== "string") ||
      (req.body.color !== undefined && typeof req.body.color !== "string")) {
    return res.status(400).json({ message: "Variant stock must be a non-negative whole number" });
  }
  try {
    const beforeProduct = await Product.findOne({
      _id: req.params.id,
      variants: { $elemMatch: { size, color } },
    }).select("name category variants").lean();
    if (!beforeProduct) return res.status(404).json({ message: "Product variant not found" });
    const beforeVariant = (beforeProduct.variants || []).find((variant) => variant.size === size && variant.color === color);
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, variants: { $elemMatch: { size, color } } },
      { $set: { "variants.$.stock": stock } },
      { new: true, runValidators: true }
    ).select("_id variants");
    if (!product) return res.status(404).json({ message: "Product variant not found" });
    await updateFeaturedProductsCache();
    await recordAuditEvent(req, {
      action: "product.variant_stock_updated",
      targetType: "product",
      targetId: product._id,
      summary: "Variant stock updated: " + beforeProduct.name,
      metadata: {
        productName: beforeProduct.name,
        category: beforeProduct.category,
        variant: { size, color },
        before: { stock: beforeVariant?.stock ?? null },
        after: { stock },
        changes: { stock: { before: beforeVariant?.stock ?? null, after: stock } },
        variantCount: product.variants.length,
      },
    });
    return res.json({ _id: product._id, variants: product.variants });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid product ID" });
    console.error("Error updating variant stock", error.message);
    return res.status(500).json({ message: "Unable to update variant stock" });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (product.isActive !== false) return res.status(409).json({ message: "ابتدا محصول را بایگانی کنید و سپس حذف دائمی را انجام دهید." });
    if (product.image) {
      try {
        const publicId = product.image.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`products/${publicId}`);
      } catch (error) {
        console.error("Error deleting product image", error.message);
      }
    }
    await Product.findByIdAndDelete(req.params.id);
    await updateFeaturedProductsCache();
    await recordAuditEvent(req, {
      action: "product.deleted",
      targetType: "product",
      targetId: product._id,
      summary: "Product deleted: " + product.name,
      metadata: {
        before: {
          name: product.name,
          description: product.description,
          price: product.price,
          category: product.category,
          categoryId: product.categoryId ? String(product.categoryId) : null,
          imageCount: (product.images || []).length,
          primaryImage: product.image,
          images: product.images || [],
          sizes: product.sizes,
          colors: product.colors,
          variants: (product.variants || []).map(({ size, color, stock }) => ({ size, color, stock })),
          attributes: product.attributes instanceof Map ? Object.fromEntries(product.attributes) : (product.attributes || {}),
          fit: product.fit,
          sizeChart: product.sizeChart,
          stock: product.stock,
          isFeatured: product.isFeatured,
          isActive: product.isActive,
        },
      },
    });
    return res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error in deleteProduct controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getRecommendedProducts = async (_req, res) => {
  try {
    const cached = await readJsonCache("recommended_products_v1");
    if (Array.isArray(cached)) return res.json(cached);
    const products = await Product.aggregate([
      { $match: { isActive: { $ne: false } } },
      { $sample: { size: 4 } },
      { $project: { _id: 1, name: 1, description: 1, image: 1, price: 1, category: 1, stock: 1 } },
    ]).option({ maxTimeMS: 1500 });
    await writeJsonCache("recommended_products_v1", products, 60);
    return res.json(products);
  } catch (error) {
    console.error("Error in getRecommendedProducts controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getProductsByCategory = async (req, res) => {
  try {
    const slug = String(req.params.category || "").trim().slice(0, 96);
    if (!slug) return res.status(400).json({ message: "دسته‌بندی معتبر نیست." });

    const scope = await getCategoryProductScope(slug);
    const baseClauses = [{ isActive: { $ne: false } }];
    if (scope) {
      baseClauses.push({
        $or: [
          { categoryId: { $in: scope.ids } },
          { category: { $in: scope.slugs } },
        ],
      });
    } else {
      // Preserve access to legacy category slugs during and after migration.
      baseClauses.push({ category: slug });
    }

    const clauses = [...baseClauses];
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    if (rawQuery) {
      const normalized = normalizePersianText(rawQuery).slice(0, 80);
      const rawPattern = new RegExp(escapeSearchRegex(rawQuery), "i");
      const normalizedPattern = normalized ? new RegExp(escapeSearchRegex(normalized), "i") : rawPattern;
      clauses.push({
        $or: [
          { searchTextNormalized: normalizedPattern },
          { name: rawPattern },
          { description: rawPattern },
          { category: rawPattern },
          { sizes: rawPattern },
          { "variants.size": rawPattern },
          { "variants.color": rawPattern },
          { "colors.name": rawPattern },
          { "fit.type": rawPattern },
          { "attributes.brand": rawPattern },
          { "attributes.brandName": rawPattern },
        ],
      });
    }

    const parsePriceBound = (value) => {
      if (value === undefined || value === null || String(value).trim() === "") return { valid: true, value: null };
      const text = String(value)
        .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[,\u060C\u066C\u2009\s]/g, "");
      if (!/^\d+$/.test(text)) return { valid: false, value: null };
      const number = Number(text);
      return { valid: Number.isSafeInteger(number) && number >= 0, value: number };
    };
    const minPrice = parsePriceBound(req.query.minPrice);
    const maxPrice = parsePriceBound(req.query.maxPrice);
    if (!minPrice.valid || !maxPrice.valid || (minPrice.value !== null && maxPrice.value !== null && minPrice.value > maxPrice.value)) {
      return res.status(400).json({ message: "بازه قیمت معتبر نیست." });
    }
    if (minPrice.value !== null || maxPrice.value !== null) {
      const price = {};
      if (minPrice.value !== null) price.$gte = minPrice.value;
      if (maxPrice.value !== null) price.$lte = maxPrice.value;
      clauses.push({ price });
    }

    const readValues = (input, maxItems, maxLength = 80) => {
      const source = input === undefined ? [] : Array.isArray(input) ? input : [input];
      return source
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().slice(0, maxLength))
        .filter(Boolean)
        .slice(0, maxItems);
    };
    const sizes = readValues(req.query.size, 24, 24);
    const colors = readValues(req.query.color, 24, 40);
    const fits = readValues(req.query.fit, 12, 40);
    const brands = readValues(req.query.brand, 24, 80);
    if (sizes.length) clauses.push({ $or: [{ sizes: { $in: sizes } }, { "variants.size": { $in: sizes } }] });
    if (colors.length) clauses.push({ $or: [{ "colors.name": { $in: colors } }, { "variants.color": { $in: colors } }] });
    if (fits.length) clauses.push({ "fit.type": { $in: fits } });
    if (brands.length) {
      clauses.push({
        $or: [
          { brand: { $in: brands } },
          { brandName: { $in: brands } },
          { "brand.name": { $in: brands } },
          { "attributes.brand": { $in: brands } },
          { "attributes.brandName": { $in: brands } },
        ],
      });
    }

    if (["1", "true"].includes(String(req.query.inStock || "").toLowerCase())) {
      clauses.push({
        $or: [
          { variants: { $elemMatch: { stock: { $gt: 0 } } } },
          {
            $and: [
              { $or: [{ variants: { $size: 0 } }, { variants: { $exists: false } }] },
              { $or: [{ stock: { $gt: 0 } }, { stock: null }, { stock: { $exists: false } }] },
            ],
          },
        ],
      });
    }

    if (req.query.attributes !== undefined) {
      if (typeof req.query.attributes !== "string" || req.query.attributes.length > 2400) {
        return res.status(400).json({ message: "فیلتر ویژگی‌ها معتبر نیست." });
      }
      let selectedAttributes;
      try { selectedAttributes = JSON.parse(req.query.attributes); }
      catch { return res.status(400).json({ message: "فیلتر ویژگی‌ها معتبر نیست." }); }
      if (!selectedAttributes || typeof selectedAttributes !== "object" || Array.isArray(selectedAttributes)) {
        return res.status(400).json({ message: "فیلتر ویژگی‌ها معتبر نیست." });
      }
      const entries = Object.entries(selectedAttributes).slice(0, 20);
      for (const [key, selected] of entries) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
          return res.status(400).json({ message: "کلید یکی از ویژگی‌های فیلتر معتبر نیست." });
        }
        if (selected === "" || selected === null || selected === undefined ||
            (Array.isArray(selected) && selected.length === 0)) continue;
        const field = "attributes." + key;
        if (Array.isArray(selected)) {
          const safeValues = selected.filter((value) => typeof value === "string").slice(0, 24);
          if (safeValues.length) clauses.push({ [field]: { $in: safeValues } });
        } else if (typeof selected === "string") {
          clauses.push({ [field]: new RegExp(escapeSearchRegex(selected.slice(0, 120)), "i") });
        } else if (typeof selected === "boolean" || (typeof selected === "number" && Number.isFinite(selected))) {
          clauses.push({ [field]: selected });
        } else {
          return res.status(400).json({ message: "مقدار یکی از ویژگی‌های فیلتر معتبر نیست." });
        }
      }
    }

    const filter = { $and: clauses };
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(req.query.limit, 24, 1, 60);
    const offset = (page - 1) * limit;
    const countOnly = ["1", "true"].includes(String(req.query.countOnly || "").toLowerCase());
    if (countOnly) {
      const total = await Product.countDocuments(filter).maxTimeMS(1500);
      return res.json({ pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    }

    const sortKey = typeof req.query.sort === "string" ? req.query.sort : "newest";
    const sort = sortKey === "priceAsc" ? { price: 1, createdAt: -1, _id: -1 }
      : sortKey === "priceDesc" ? { price: -1, createdAt: -1, _id: -1 }
      : sortKey === "nameAsc" ? { name: 1, _id: 1 }
      : sortKey === "oldest" ? { createdAt: 1, _id: 1 }
      : { createdAt: -1, _id: -1 };

    const facetCacheKey = "category_filter_facets_v2:" + slug;
    let filterOptions = await readJsonCache(facetCacheKey);
    if (!filterOptions || !Array.isArray(filterOptions.sizes) || !Array.isArray(filterOptions.colors)) {
      const facetResult = await Product.aggregate([
        { $match: { $and: baseClauses } },
        {
          $facet: {
            sizes: [
              { $project: { values: { $setUnion: [
                { $ifNull: ["$sizes", []] },
                { $map: { input: { $ifNull: ["$variants", []] }, as: "variant", in: "$$variant.size" } },
              ] } } },
              { $unwind: "$values" },
              { $match: { values: { $type: "string", $ne: "" } } },
              { $group: { _id: "$values" } },
              { $sort: { _id: 1 } },
              { $limit: 100 },
            ],
            colors: [
              { $unwind: "$colors" },
              { $match: { "colors.name": { $type: "string", $ne: "" } } },
              { $group: { _id: "$colors.name", hex: { $first: "$colors.hex" } } },
              { $sort: { _id: 1 } },
              { $limit: 100 },
            ],
            variantColors: [
              { $unwind: "$variants" },
              { $match: { "variants.color": { $type: "string", $ne: "" } } },
              { $group: { _id: "$variants.color" } },
              { $sort: { _id: 1 } },
              { $limit: 100 },
            ],
            fits: [
              { $match: { "fit.type": { $type: "string", $ne: "" } } },
              { $group: { _id: "$fit.type" } },
              { $sort: { _id: 1 } },
              { $limit: 30 },
            ],
            brands: [
              { $project: { values: { $setUnion: [
                { $cond: [{ $eq: [{ $type: "$brand" }, "string"] }, ["$brand"], []] },
                { $cond: [{ $eq: [{ $type: "$brand.name" }, "string"] }, ["$brand.name"], []] },
                { $cond: [{ $eq: [{ $type: "$brandName" }, "string"] }, ["$brandName"], []] },
                { $cond: [{ $eq: [{ $type: "$attributes.brand" }, "string"] }, ["$attributes.brand"], []] },
                { $cond: [{ $eq: [{ $type: "$attributes.brandName" }, "string"] }, ["$attributes.brandName"], []] },
              ] } } },
              { $unwind: "$values" },
              { $match: { values: { $type: "string", $ne: "" } } },
              { $group: { _id: "$values" } },
              { $sort: { _id: 1 } },
              { $limit: 100 },
            ],
          },
        },
      ]).option({ maxTimeMS: 2500 });

      const rawFacets = facetResult[0] || {};
      const colorMap = new Map();
      for (const item of rawFacets.colors || []) {
        if (typeof item._id === "string" && item._id.trim()) colorMap.set(item._id, { name: item._id, hex: typeof item.hex === "string" ? item.hex : "" });
      }
      for (const item of rawFacets.variantColors || []) {
        if (typeof item._id === "string" && item._id.trim() && !colorMap.has(item._id)) colorMap.set(item._id, { name: item._id, hex: "" });
      }
      filterOptions = {
        sizes: [...new Set((rawFacets.sizes || []).map((item) => item._id).filter((value) => typeof value === "string" && value.trim()))],
        colors: [...colorMap.values()].sort((a, b) => a.name.localeCompare(b.name, "fa")),
        fits: (rawFacets.fits || []).map((item) => item._id).filter((value) => typeof value === "string" && value.trim()),
        brands: (rawFacets.brands || []).map((item) => item._id).filter((value) => typeof value === "string" && value.trim()),
      };
      await writeJsonCache(facetCacheKey, filterOptions, 120);
    }

    const [products, total, priceStats] = await Promise.all([
      Product.find(filter).sort(sort).skip(offset).limit(limit).maxTimeMS(1500).lean(),
      Product.countDocuments(filter).maxTimeMS(1500),
      Product.aggregate([
        { $match: { $and: baseClauses } },
        { $group: { _id: null, minPrice: { $min: "$price" }, maxPrice: { $max: "$price" }, count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 1500 }),
    ]);

    const stats = priceStats[0];
    const min = Number(stats?.minPrice);
    const max = Number(stats?.maxPrice);
    return res.json({
      products,
      priceBounds: {
        minPrice: Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0,
        maxPrice: Number.isFinite(max) ? Math.max(0, Math.ceil(max)) : 0,
        count: Number(stats?.count || 0),
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      filterOptions,
    });
  } catch (error) {
    console.error("Error in getProductsByCategory controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const toggleFeaturedProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    const wasFeatured = product.isFeatured;
    product.isFeatured = !product.isFeatured;
    await product.save();
    await updateFeaturedProductsCache();
    await recordAuditEvent(req, {
      action: "product.featured_toggled",
      targetType: "product",
      targetId: product._id,
      summary: "Featured setting updated: " + product.name,
      metadata: {
        productName: product.name,
        before: { isFeatured: wasFeatured },
        after: { isFeatured: product.isFeatured },
        changes: { isFeatured: { before: wasFeatured, after: product.isFeatured } },
      },
    });
    return res.json(product);
  } catch (error) {
    console.error("Error in toggleFeaturedProduct controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

async function updateFeaturedProductsCache() {
  try {
    const products = await Product.find({ isFeatured: true, isActive: { $ne: false } })
      .sort({ createdAt: -1, _id: -1 }).limit(100).maxTimeMS(1500).lean();
    await writeJsonCache("featured_products_v2", products, 300);
  } catch (error) {
    console.error("Unable to refresh featured-products cache", error.message);
  }
}


export const getBestsellingProducts = async (req, res) => {
  const limit = clampInteger(req.query.limit, 8, 1, 24);
  const cacheKey = `bestselling_products_v1:${limit}`;
  const cached = await readJsonCache(cacheKey);
  if (Array.isArray(cached)) return res.json({ products: cached });
  try {
    const products = await Order.aggregate([
      { $match: { paymentStatus: "paid", status: "paid" } },
      { $unwind: "$products" },
      { $group: {
        _id: "$products.product",
        soldQuantity: { $sum: "$products.quantity" },
        orderIds: { $addToSet: "$_id" },
      } },
      { $addFields: { orderCount: { $size: "$orderIds" } } },
      { $lookup: {
        from: Product.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "product",
      } },
      { $unwind: "$product" },
      { $match: { "product.isActive": { $ne: false } } },
      { $sort: { soldQuantity: -1, orderCount: -1, _id: 1 } },
      { $limit: limit },
      { $replaceRoot: { newRoot: {
        $mergeObjects: [
          "$product",
          { soldQuantity: "$soldQuantity", orderCount: "$orderCount" },
        ],
      } } },
    ]).option({ maxTimeMS: 2500 });
    await writeJsonCache(cacheKey, products, 60);
    return res.json({ products });
  } catch (error) {
    console.error("Error loading best-selling products", error.message);
    return res.status(500).json({ message: "Unable to load best-selling products" });
  }
};

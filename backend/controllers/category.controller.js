import mongoose from "mongoose";
import Category from "../models/category.model.js";
import Product from "../models/product.model.js";
import { recordAuditEvent } from "../lib/audit-log.js";
import { ImageUploadError, ImageStorageError, deleteManagedCloudinaryImage, resolveImageReference } from "../lib/image-upload.js";

const objectIdPattern = /^[a-f\d]{24}$/i;
const localized = (value, previous = {}) => ({
  fa: typeof value?.fa === "string" ? value.fa.trim() : String(previous.fa || "").trim(),
  en: typeof value?.en === "string" ? value.en.trim() : String(previous.en || "").trim(),
});
const safeImage = (value) => {
  if (typeof value !== "string") return "";
  const image = value.trim();
  return image.length <= 2048 && (image === "" || image.startsWith("/") && !image.startsWith("//") || /^https:\/\/\S+$/i.test(image))
    ? image
    : null;
};
const idString = (value) => value == null ? "" : String(value);
const sortCategories = (items) => items.sort((a, b) =>
  Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
  String(a.name?.fa || "").localeCompare(String(b.name?.fa || ""), "fa")
);

const getVisibleCategories = async () => {
  const all = await Category.find({}).select("-__v").sort({ sortOrder: 1, "name.fa": 1 }).lean();
  const activeIds = new Set(all.filter((item) => item.isActive).map((item) => idString(item._id)));
  return sortCategories(all.filter((item) =>
    item.isActive && (item.ancestors || []).every((ancestor) => activeIds.has(idString(ancestor)))
  ));
};

const getCategoryScope = async (slug) => {
  const selected = await Category.findOne({ slug }).select("-__v").lean();
  if (!selected) return null;
  const visible = await getVisibleCategories();
  const selectedId = idString(selected._id);
  const selectedVisible = visible.some((item) => idString(item._id) === selectedId);
  if (!selectedVisible) return { category: selected, ids: [], slugs: [], unavailable: true };
  const descendants = visible.filter((item) =>
    idString(item._id) === selectedId || (item.ancestors || []).some((ancestor) => idString(ancestor) === selectedId)
  );
  return {
    category: selected,
    ids: descendants.map((item) => item._id),
    slugs: descendants.map((item) => item.slug),
    unavailable: false,
  };
};

const validateCategoryInput = (body, previous = null) => {
  const name = localized(body.name, previous?.name);
  if (!name.fa || !name.en) return { error: "نام فارسی و انگلیسی دسته‌بندی الزامی است." };
  const description = localized(body.description, previous?.description);
  const image = body.image === undefined ? (previous?.image || "") : safeImage(body.image);
  if (image === null) return { error: "آدرس تصویر باید یک مسیر محلی یا یک URL امن HTTPS باشد." };
  const sortOrder = body.sortOrder === undefined ? (previous?.sortOrder || 0) : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    return { error: "ترتیب نمایش باید یک عدد صحیح نامنفی باشد." };
  }
  const slug = body.slug === undefined ? previous?.slug : String(body.slug || "").trim().toLowerCase();
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 96) {
    return { error: "Slug باید انگلیسی، کوچک و شامل حروف، عدد و خط تیره باشد." };
  }
  const attributes = body.attributes === undefined ? (previous?.attributes || []) : body.attributes;
  if (!Array.isArray(attributes)) return { error: "تعریف ویژگی‌ها باید به شکل فهرست ارسال شود." };
  const keys = new Set();
  for (const attribute of attributes) {
    if (!attribute || typeof attribute.key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(attribute.key)) {
      return { error: "کلید هر ویژگی باید یکتا و به شکل انگلیسی باشد." };
    }
    if (keys.has(attribute.key)) return { error: "کلید ویژگی تکراری است: " + attribute.key };
    keys.add(attribute.key);
    if (typeof attribute.name?.fa !== "string" || !attribute.name.fa.trim() ||
        typeof attribute.name?.en !== "string" || !attribute.name.en.trim()) {
      return { error: "نام فارسی و انگلیسی همه ویژگی‌ها الزامی است." };
    }
    if (!["select", "multi-select", "boolean", "number", "text"].includes(attribute.type)) {
      return { error: "نوع یکی از ویژگی‌ها معتبر نیست." };
    }
    if (["select", "multi-select"].includes(attribute.type) &&
        (!Array.isArray(attribute.options) || attribute.options.length === 0 ||
        attribute.options.some((option) =>
          typeof option?.value !== "string" || !option.value.trim() ||
          typeof option?.name?.fa !== "string" || !option.name.fa.trim() ||
          typeof option?.name?.en !== "string" || !option.name.en.trim()
        ))) {
      return { error: "ویژگی‌های انتخابی باید حداقل یک گزینه با نام فارسی و انگلیسی داشته باشند." };
    }
  }
  return {
    value: {
      name,
      slug,
      description,
      image,
      sortOrder,
      isActive: body.isActive === undefined ? (previous?.isActive ?? true) : Boolean(body.isActive),
      showInNavigation: body.showInNavigation === undefined ? (previous?.showInNavigation ?? true) : Boolean(body.showInNavigation),
      attributes,
    },
  };
};

export const getPublicCategories = async (_req, res) => {
  try {
    return res.json({ categories: await getVisibleCategories() });
  } catch (error) {
    console.error("Error fetching categories:", error.message);
    return res.status(500).json({ message: "دریافت دسته‌بندی‌ها ناموفق بود." });
  }
};

export const getCategoryBySlug = async (req, res) => {
  try {
    const scope = await getCategoryScope(req.params.slug);
    if (!scope || scope.unavailable) return res.status(404).json({ message: "دسته‌بندی پیدا نشد." });
    return res.json({ category: scope.category });
  } catch (error) {
    console.error("Error fetching category:", error.message);
    return res.status(500).json({ message: "دریافت دسته‌بندی ناموفق بود." });
  }
};

export const getAdminCategories = async (_req, res) => {
  try {
    const [categories, counts] = await Promise.all([
      Category.find({}).sort({ sortOrder: 1, "name.fa": 1 }).lean(),
      Product.aggregate([
        { $facet: {
          byId: [
            { $match: { categoryId: { $ne: null } } },
            { $group: { _id: "$categoryId", count: { $sum: 1 } } },
          ],
          bySlug: [
            { $group: { _id: "$category", count: { $sum: 1 } } },
          ],
        } },
      ]),
    ]);
    const countById = new Map((counts[0]?.byId || []).map((entry) => [idString(entry._id), entry.count]));
    const countBySlug = new Map((counts[0]?.bySlug || []).map((entry) => [String(entry._id), entry.count]));
    const childCounts = await Category.aggregate([
      { $match: { parentId: { $ne: null } } },
      { $group: { _id: "$parentId", count: { $sum: 1 } } },
    ]);
    const childCountById = new Map(childCounts.map((entry) => [idString(entry._id), entry.count]));
    return res.json({
      categories: categories.map((category) => ({
        ...category,
        productCount: Math.max(countById.get(idString(category._id)) || 0, countBySlug.get(category.slug) || 0),
        childCount: childCountById.get(idString(category._id)) || 0,
      })),
    });
  } catch (error) {
    console.error("Error fetching admin categories:", error.message);
    return res.status(500).json({ message: "دریافت دسته‌بندی‌ها ناموفق بود." });
  }
};

export const createCategory = async (req, res) => {
  let pendingUploadedImage = "";
  try {
    const requestBody = req.body || {};
    const imageInput = requestBody.image;
    const validationBody = typeof imageInput === "string" && imageInput.startsWith("data:")
      ? { ...requestBody, image: "" }
      : requestBody;
    const validated = validateCategoryInput(validationBody);
    if (validated.error) return res.status(400).json({ message: validated.error });
    const parentId = requestBody.parentId || null;
    let parent = null;
    if (parentId) {
      if (!objectIdPattern.test(String(parentId))) return res.status(400).json({ message: "دسته‌بندی والد معتبر نیست." });
      parent = await Category.findById(parentId);
      if (!parent) return res.status(400).json({ message: "دسته‌بندی والد پیدا نشد." });
      if (!parent.isActive) return res.status(400).json({ message: "دسته‌بندی غیرفعال نمی‌تواند والد دسته جدید باشد." });
    }
    validated.value.image = await resolveImageReference(imageInput, {
      folder: "categories",
      maxBytes: 2 * 1024 * 1024,
    });
    if (typeof imageInput === "string" && imageInput.startsWith("data:")) pendingUploadedImage = validated.value.image;
    const category = await Category.create({
      ...validated.value,
      parentId: parent?._id || null,
      ancestors: parent ? [...parent.ancestors, parent._id] : [],
    });
    pendingUploadedImage = "";
    await recordAuditEvent(req, {
      action: "category.created", targetType: "category", targetId: category._id,
      summary: "Category created: " + (category.name?.fa || category.slug),
      metadata: {
        after: {
          name: category.name,
          slug: category.slug,
          parentId: idString(category.parentId),
          description: category.description,
          image: category.image,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          showInNavigation: category.showInNavigation,
          attributes: category.attributes,
        },
      },
    });
    return res.status(201).json({ category });
  } catch (error) {
    if (pendingUploadedImage) {
      await deleteManagedCloudinaryImage(pendingUploadedImage, { folder: "categories" }).catch((cleanupError) => {
        console.error("Uploaded category image cleanup failed", { name: cleanupError?.name || "Error" });
      });
    }
    if (error instanceof ImageUploadError) return res.status(400).json({ message: error.message });
    if (error instanceof ImageStorageError) return res.status(502).json({ message: error.message });
    if (error?.code === 11000) return res.status(409).json({ message: "این slug قبلاً استفاده شده است." });
    if (error instanceof mongoose.Error.ValidationError) return res.status(400).json({ message: "اطلاعات دسته‌بندی معتبر نیست." });
    console.error("Error creating category:", error.message);
    return res.status(500).json({ message: "ایجاد دسته‌بندی ناموفق بود." });
  }
};

export const updateCategory = async (req, res) => {
  let pendingUploadedImage = "";
  try {
    if (!objectIdPattern.test(String(req.params.id))) return res.status(400).json({ message: "شناسه دسته‌بندی معتبر نیست." });
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "دسته‌بندی پیدا نشد." });
    if (req.body?.slug !== undefined && String(req.body.slug).trim().toLowerCase() !== category.slug) {
      return res.status(400).json({ message: "برای حفظ لینک‌های پایدار، slug پس از ایجاد قابل تغییر نیست." });
    }
    const requestBody = req.body || {};
    const imageInput = requestBody.image;
    const validationBody = typeof imageInput === "string" && imageInput.startsWith("data:")
      ? { ...requestBody, image: "" }
      : requestBody;
    const validated = validateCategoryInput({ ...validationBody, slug: category.slug }, category.toObject());
    if (validated.error) return res.status(400).json({ message: validated.error });
    const parentWasSent = Object.prototype.hasOwnProperty.call(requestBody, "parentId");
    let parent = category.parentId ? await Category.findById(category.parentId) : null;
    if (parentWasSent) {
      const parentId = req.body.parentId || null;
      if (parentId && !objectIdPattern.test(String(parentId))) return res.status(400).json({ message: "دسته‌بندی والد معتبر نیست." });
      parent = parentId ? await Category.findById(parentId) : null;
      if (parentId && !parent) return res.status(400).json({ message: "دسته‌بندی والد پیدا نشد." });
      if (parent && !parent.isActive && validated.value.isActive) return res.status(400).json({ message: "دسته فعال باید والد فعالی داشته باشد." });
      const categoryId = idString(category._id);
      if (parent && (idString(parent._id) === categoryId || parent.ancestors.some((ancestor) => idString(ancestor) === categoryId))) {
        return res.status(400).json({ message: "انتقال دسته باعث ایجاد چرخه در درخت می‌شود." });
      }
    }
    if (imageInput !== undefined) {
      validated.value.image = await resolveImageReference(imageInput, {
        folder: "categories",
        maxBytes: 2 * 1024 * 1024,
      });
      if (typeof imageInput === "string" && imageInput.startsWith("data:")) pendingUploadedImage = validated.value.image;
    }
    const before = {
      name: category.name,
      slug: category.slug,
      parentId: idString(category.parentId),
      description: category.description,
      image: category.image,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      showInNavigation: category.showInNavigation,
      attributes: category.attributes,
    };
    const oldPrefix = [...category.ancestors.map(idString), idString(category._id)];
    const newAncestors = parent ? [...parent.ancestors, parent._id] : [];
    Object.assign(category, validated.value);
    if (parentWasSent) category.parentId = parent?._id || null;
    category.ancestors = newAncestors;
    await category.save();
    pendingUploadedImage = "";
    if (before.image && before.image !== category.image) {
      await deleteManagedCloudinaryImage(before.image, { folder: "categories" }).catch((cleanupError) => {
        console.error("Replaced category image cleanup failed", { name: cleanupError?.name || "Error" });
      });
    }

    if (parentWasSent) {
      const descendants = await Category.find({ ancestors: category._id });
      const newPrefix = [...newAncestors.map(idString), idString(category._id)];
      for (const descendant of descendants) {
        const tail = descendant.ancestors.map(idString).slice(oldPrefix.length);
        descendant.ancestors = [...newPrefix, ...tail];
        await descendant.save();
      }
    }
    await recordAuditEvent(req, {
      action: "category.updated", targetType: "category", targetId: category._id,
      summary: "Category updated: " + (category.name?.fa || category.slug),
      metadata: {
        before,
        after: {
          name: category.name,
          slug: category.slug,
          parentId: idString(category.parentId),
          description: category.description,
          image: category.image,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          showInNavigation: category.showInNavigation,
          attributes: category.attributes,
        },
      },
    });
    return res.json({ category });
  } catch (error) {
    if (pendingUploadedImage) {
      await deleteManagedCloudinaryImage(pendingUploadedImage, { folder: "categories" }).catch((cleanupError) => {
        console.error("Unpersisted category image cleanup failed", { name: cleanupError?.name || "Error" });
      });
    }
    if (error instanceof ImageUploadError) return res.status(400).json({ message: error.message });
    if (error instanceof ImageStorageError) return res.status(502).json({ message: error.message });
    if (error?.code === 11000) return res.status(409).json({ message: "این slug قبلاً استفاده شده است." });
    if (error instanceof mongoose.Error.ValidationError) return res.status(400).json({ message: "اطلاعات دسته‌بندی معتبر نیست." });
    console.error("Error updating category:", error.message);
    return res.status(500).json({ message: "به‌روزرسانی دسته‌بندی ناموفق بود." });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    if (!objectIdPattern.test(String(req.params.id))) return res.status(400).json({ message: "شناسه دسته‌بندی معتبر نیست." });
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "دسته‌بندی پیدا نشد." });
    const [childCount, productCount] = await Promise.all([
      Category.countDocuments({ parentId: category._id }),
      Product.countDocuments({ $or: [{ categoryId: category._id }, { category: category.slug }] }),
    ]);
    if (childCount || productCount) {
      return res.status(409).json({
        message: "این دسته هنوز وابستگی دارد؛ ابتدا محصولات را منتقل و زیر‌دسته‌ها را حذف یا منتقل کنید، یا دسته را بایگانی کنید.",
        dependencies: { childCount, productCount },
      });
    }
    const deletedSnapshot = {
      name: category.name,
      slug: category.slug,
      parentId: idString(category.parentId),
      description: category.description,
      image: category.image,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      showInNavigation: category.showInNavigation,
      attributes: category.attributes,
    };
    await Category.deleteOne({ _id: category._id });
    await deleteManagedCloudinaryImage(category.image, { folder: "categories" }).catch((cleanupError) => {
      console.error("Deleted category image cleanup failed", { name: cleanupError?.name || "Error" });
    });
    await recordAuditEvent(req, {
      action: "category.deleted", targetType: "category", targetId: category._id,
      summary: "Category deleted: " + (category.name?.fa || category.slug),
      metadata: { before: deletedSnapshot },
    });
    return res.json({ success: true, id: category._id });
  } catch (error) {
    console.error("Error deleting category:", error.message);
    return res.status(500).json({ message: "حذف دسته‌بندی ناموفق بود." });
  }
};

export { getCategoryScope };

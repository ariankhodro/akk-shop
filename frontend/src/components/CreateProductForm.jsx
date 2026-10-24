import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PlusCircle, Upload, Loader, X, Ruler, Shirt } from "lucide-react";
import { useProductStore } from "../stores/useProductStore";
import { useCategoryStore } from "../stores/useCategoryStore";
import { getCurrencyLabel, STORE_CURRENCY } from "../lib/commerce";

const categoryPath = (category, categories) => {
  const byId = new Map(categories.map((item) => [String(item._id), item]));
  const parts = [];
  let current = category;
  let remaining = 20;
  while (current && remaining-- > 0) {
    parts.unshift(current.name?.fa || current.name?.en || current.slug);
    current = byId.get(String(current.parentId || ""));
  }
  return parts.join(" / ");
};
const storeCurrency = STORE_CURRENCY;
const priceUnitLabel = getCurrencyLabel(storeCurrency);
const legacyCategoryFallback = [
  { _id: "legacy:jeans", slug: "jeans", name: { fa: "شلوار جین", en: "Jeans" }, parentId: null, ancestors: [], attributes: [], isActive: true, isLegacyFallback: true },
  { _id: "legacy:t-shirts", slug: "t-shirts", name: { fa: "تی‌شرت", en: "T-shirts" }, parentId: null, ancestors: [], attributes: [], isActive: true, isLegacyFallback: true },
  { _id: "legacy:shoes", slug: "shoes", name: { fa: "کفش", en: "Shoes" }, parentId: null, ancestors: [], attributes: [], isActive: true, isLegacyFallback: true },
  { _id: "legacy:glasses", slug: "glasses", name: { fa: "عینک", en: "Glasses" }, parentId: null, ancestors: [], attributes: [], isActive: true, isLegacyFallback: true },
  { _id: "legacy:jackets", slug: "jackets", name: { fa: "کت و کاپشن", en: "Jackets" }, parentId: null, ancestors: [], attributes: [], isActive: true, isLegacyFallback: true },
  { _id: "legacy:suits", slug: "suits", name: { fa: "کت‌وشلوار", en: "Suits" }, parentId: null, ancestors: [], attributes: [], isActive: true, isLegacyFallback: true },
  { _id: "legacy:bags", slug: "bags", name: { fa: "کیف", en: "Bags" }, parentId: null, ancestors: [], attributes: [], isActive: true, isLegacyFallback: true },
];
const fitOptions = [
  ["true-to-size", "مطابق سایز استاندارد"],
  ["slim", "جذب"],
  ["regular", "معمولی"],
  ["relaxed", "آزاد"],
  ["oversized", "آزاد و اورسایز"],
  ["athletic", "ورزشی"],
];

const defaults = {
  name: "", description: "", price: "", stock: "0", category: "", categoryId: "",
  images: [], sizesText: "", colorsText: "", fitType: "regular",
  fitDescription: "", modelHeight: "", modelSize: "",
  sizeChartText: "",
};

const parseSizes = (value) => [...new Set(value.split(/[,\n،]+/).map((part) => part.trim()).filter(Boolean))].slice(0, 24);
const parseColors = (value) => {
  const found = value.split(/[,\n،]+/).map((part) => part.trim()).filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf(":");
    const name = (separator >= 0 ? entry.slice(0, separator) : entry).trim();
    const hex = separator >= 0 ? entry.slice(separator + 1).trim() : "#d5d0c5";
    return { name, hex: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#d5d0c5" };
  });
  return found.filter((color, index) => color.name && found.findIndex((item) => item.name.toLowerCase() === color.name.toLowerCase()) === index).slice(0, 16);
};
const variantKey = (size, color) => JSON.stringify([size, color]);
const parseSizeChart = (value) => value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
  const [size, chest, waist, hips, length] = line.split(/[,\u060C]+/).map((value) => value.trim());
  const measurement = (value) => value === undefined || value === "" ? null : Number(value);
  return { size, chestCm: measurement(chest), waistCm: measurement(waist), hipsCm: measurement(hips), lengthCm: measurement(length) };
}).filter((row) => row.size);

const CreateProductForm = () => {
  const [newProduct, setNewProduct] = useState(defaults);
  const [variantStocks, setVariantStocks] = useState({});
  const [imageError, setImageError] = useState("");
  const [attributeValues, setAttributeValues] = useState({});
  const { createProduct, loading } = useProductStore();
  const { categories: availableCategories, fetchCategories } = useCategoryStore();

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const categoryChoices = availableCategories.length ? availableCategories : legacyCategoryFallback;
  const selectedCategory = categoryChoices.find((category) => String(category._id) === String(newProduct.categoryId));
  const selectedCategoryAttributes = useMemo(() => {
    if (!selectedCategory) return [];
    const byId = new Map(availableCategories.map((category) => [String(category._id), category]));
    const ancestors = (selectedCategory.ancestors || []).map((id) => byId.get(String(id))).filter(Boolean);
    const chain = [...ancestors, selectedCategory].sort((a, b) => (a.ancestors || []).length - (b.ancestors || []).length);
    const definitions = new Map();
    for (const category of chain) {
      for (const attribute of category.attributes || []) {
        if (String(category._id) === String(selectedCategory._id) || attribute.inherited !== false) {
          definitions.set(attribute.key, attribute);
        }
      }
    }
    return [...definitions.values()].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }, [availableCategories, selectedCategory]);

  const sizes = useMemo(() => parseSizes(newProduct.sizesText), [newProduct.sizesText]);
  const colors = useMemo(() => parseColors(newProduct.colorsText), [newProduct.colorsText]);
  const combinations = useMemo(() => {
    if (!sizes.length && !colors.length) return [];
    const sizeOptions = sizes.length ? sizes : [""];
    const colorOptions = colors.length ? colors : [{ name: "", hex: "#d5d0c5" }];
    return sizeOptions.flatMap((size) => colorOptions.map((color) => ({
      size, color: color.name, hex: color.hex, key: variantKey(size, color.name),
    })));
  }, [sizes, colors]);

  const updateField = (field, value) => setNewProduct((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setImageError("");
    const sizeChart = parseSizeChart(newProduct.sizeChartText);
    if (combinations.length && combinations.some((variant) => !Number.isInteger(Number(variantStocks[variant.key] ?? 0)) || Number(variantStocks[variant.key] ?? 0) < 0)) {
      setImageError("موجودی هر ترکیب باید عدد صحیح و نامنفی باشد.");
      return;
    }
    if (sizeChart.some((row) => [row.chestCm, row.waistCm, row.hipsCm, row.lengthCm].some((value) => value !== null && (!Number.isFinite(value) || value < 0)))) {
      setImageError("اندازه‌های جدول سایز باید عددی نامنفی باشند.");
      return;
    }
    try {
      await createProduct({
        name: newProduct.name,
        description: newProduct.description,
        price: newProduct.price,
        stock: newProduct.stock,
        category: newProduct.category,
        categoryId: selectedCategory?.isLegacyFallback ? "" : newProduct.categoryId,
        attributes: attributeValues,
        image: newProduct.images[0] || "",
        images: newProduct.images,
        sizes,
        colors,
        variants: combinations.map((variant) => ({
          size: variant.size, color: variant.color, stock: Number(variantStocks[variant.key] ?? 0),
        })),
        fit: {
          type: newProduct.fitType,
          description: newProduct.fitDescription,
          modelHeight: newProduct.modelHeight,
          modelSize: newProduct.modelSize,
        },
        sizeChart,
      });
      setNewProduct(defaults);
      setVariantStocks({});
    } catch {
      // The store displays the API error to the administrator.
    }
  };

  const handleImageChange = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, 8);
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) || totalSize > 6 * 1024 * 1024) {
      setImageError("هر تصویر باید از نوع عکس و حداکثر ۵ مگابایت باشد؛ حجم کل تصاویر باید حداکثر ۶ مگابایت باشد.");
      event.target.value = "";
      return;
    }
    setImageError("");
    try {
      const encoded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("خواندن تصویر ناموفق بود"));
        reader.readAsDataURL(file);
      })));
      updateField("images", encoded);
    } catch {
      setImageError("خواندن تصویر ناموفق بود؛ دوباره تلاش کنید.");
    }
    event.target.value = "";
  };

  const fieldClass = "mt-1 block w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-3 py-2.5 text-sm text-[var(--ui-text)] shadow-sm focus:border-[#9aa58e] focus:outline-none focus:ring-2 focus:ring-[#68745f]";
  const labelClass = "block text-sm font-medium text-[var(--ui-muted)]";

  return (
    <motion.div dir="rtl" className="mx-auto mb-8 max-w-3xl rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-lg sm:p-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <h2 className="mb-2 text-2xl font-semibold text-[#9aa58e]">ایجاد محصول جدید</h2>
      <p className="mb-6 text-sm leading-6 text-[var(--ui-muted)]">اطلاعات پایه، گزینه‌های پوشاک و موجودی هر ترکیب را وارد کنید. محصولات قدیمی بدون گزینه سایز و رنگ هم پشتیبانی می‌شوند.</p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="space-y-4">
          <h3 className="border-b border-[var(--ui-border)] pb-2 text-sm font-bold text-[var(--ui-text)]">اطلاعات اصلی</h3>
          <label className={labelClass}>نام محصول
            <input type="text" value={newProduct.name} onChange={(event) => updateField("name", event.target.value)} className={fieldClass} maxLength={160} required />
          </label>
          <label className={labelClass}>توضیحات
            <textarea value={newProduct.description} onChange={(event) => updateField("description", event.target.value)} rows={3} className={fieldClass} maxLength={5000} required />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>قیمت ({priceUnitLabel})
              <input type="number" min="0" step="1" value={newProduct.price} onChange={(event) => updateField("price", event.target.value)} className={fieldClass} required />
            </label>
            {combinations.length === 0 ? (
              <label className={labelClass}>موجودی انبار
                <input type="number" min="0" step="1" value={newProduct.stock} onChange={(event) => updateField("stock", event.target.value)} className={fieldClass} required />
              </label>
            ) : (
              <p className="self-end rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-3 py-3 text-xs leading-5 text-[var(--ui-muted)]">موجودی محصول برای هر ترکیب سایز و رنگ، در بخش گزینه‌ها جداگانه تنظیم می‌شود.</p>
            )}
          </div>
          <label className={labelClass}>دسته‌بندی
            <select
              value={newProduct.categoryId}
              onChange={(event) => {
                const selected = availableCategories.find((item) => String(item._id) === event.target.value);
                setNewProduct((current) => ({ ...current, categoryId: event.target.value, category: selected?.slug || "" }));
                setAttributeValues({});
              }}
              className={fieldClass}
              required
            >
              <option value="">یک دسته‌بندی انتخاب کنید</option>
              {categoryChoices.filter((category) => category.isActive !== false).map((category) => (
                <option key={category._id} value={category._id}>{categoryPath(category, availableCategories)}</option>
              ))}
            </select>
            {availableCategories.length === 0 && <span className="mt-1 block text-xs text-[var(--ui-warning)]">فهرست سازگار با نسخه قبلی فعال است؛ برای مدیریت پویا و ویژگی‌های دسته‌ها، migration را اجرا کنید.</span>}
          </label>
        </section>

        {selectedCategoryAttributes.length > 0 && (
          <section className="space-y-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4">
            <h3 className="border-b border-[var(--ui-border)] pb-2 text-sm font-bold text-[var(--ui-text)]">ویژگی‌های دسته‌بندی</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {selectedCategoryAttributes.map((attribute) => (
                <label key={attribute.key} className={labelClass}>
                  {attribute.name?.fa || attribute.name?.en || attribute.key}{attribute.required ? " *" : ""}
                  {attribute.type === "select" ? (
                    <select required={Boolean(attribute.required)} className={fieldClass} value={attributeValues[attribute.key] ?? ""} onChange={(event) => setAttributeValues((current) => ({ ...current, [attribute.key]: event.target.value }))}>
                      <option value="">انتخاب کنید</option>
                      {(attribute.options || []).map((option) => <option key={option.value} value={option.value}>{option.name?.fa || option.name?.en || option.value}</option>)}
                    </select>
                  ) : attribute.type === "multi-select" ? (
                    <select multiple className={fieldClass + " min-h-28"} value={Array.isArray(attributeValues[attribute.key]) ? attributeValues[attribute.key] : []} onChange={(event) => setAttributeValues((current) => ({ ...current, [attribute.key]: [...event.target.selectedOptions].map((option) => option.value) }))}>
                      {(attribute.options || []).map((option) => <option key={option.value} value={option.value}>{option.name?.fa || option.name?.en || option.value}</option>)}
                    </select>
                  ) : attribute.type === "boolean" ? (
                    <span className="mt-2 flex min-h-10 items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-3">
                      <input type="checkbox" checked={Boolean(attributeValues[attribute.key])} onChange={(event) => setAttributeValues((current) => ({ ...current, [attribute.key]: event.target.checked }))} />
                      بله
                    </span>
                  ) : (
                    <input type={attribute.type === "number" ? "number" : "text"} required={Boolean(attribute.required)} min={attribute.type === "number" ? "0" : undefined} maxLength={attribute.type === "text" ? 500 : undefined} className={fieldClass} value={attributeValues[attribute.key] ?? ""} onChange={(event) => setAttributeValues((current) => ({ ...current, [attribute.key]: event.target.value }))} />
                  )}
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="border-b border-[var(--ui-border)] pb-2 text-sm font-bold text-[var(--ui-text)]">گالری تصاویر محصول</h3>
          <p className="text-xs leading-5 text-[var(--ui-muted)]">تا ۸ تصویر اضافه کنید؛ تصویر اول تصویر اصلی محصول خواهد بود. حجم کل تصاویر باید حداکثر ۶ مگابایت باشد. عکس مدل و نمای نزدیک جزئیات، به تصمیم خرید کمک می‌کند.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" id="product-images" className="sr-only" accept="image/*" multiple onChange={handleImageChange} />
            <label htmlFor="product-images" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-4 py-2.5 text-sm font-medium text-[var(--ui-text)] transition hover:bg-[var(--ui-hover)]"><Upload size={18} aria-hidden="true" />انتخاب تصاویر</label>
            <span className="text-xs text-[var(--ui-muted)]">{newProduct.images.length ? newProduct.images.length + " تصویر انتخاب شده" : "هنوز تصویری انتخاب نشده"}</span>
          </div>
          {newProduct.images.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {newProduct.images.map((image, index) => (
                <div key={image} className="relative overflow-hidden rounded-xl border border-[var(--ui-border)]">
                  <img src={image} alt={"پیش‌نمایش تصویر " + (index + 1)} className="aspect-[4/5] w-full object-cover" />
                  {index === 0 && <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-[var(--ui-text)]">تصویر اصلی</span>}
                  <button type="button" aria-label={"حذف تصویر " + (index + 1)} onClick={() => updateField("images", newProduct.images.filter((_, imageIndex) => imageIndex !== index))} className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-[var(--ui-text)] hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><X size={14} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--ui-border)] pb-2"><Shirt size={17} className="text-[#9aa58e]" aria-hidden="true" /><h3 className="text-sm font-bold text-[var(--ui-text)]">سایز، رنگ و موجودی هر گزینه</h3></div>
          <label className={labelClass}>سایزها (با ویرگول جدا کنید)
            <input type="text" value={newProduct.sizesText} onChange={(event) => updateField("sizesText", event.target.value)} className={fieldClass} placeholder="مثلاً XS, S, M, L, XL یا 38, 40, 42" />
          </label>
          <label className={labelClass}>رنگ‌ها (نام: کد رنگ، با ویرگول جدا کنید)
            <input type="text" value={newProduct.colorsText} onChange={(event) => updateField("colorsText", event.target.value)} className={fieldClass} placeholder="مشکی: #222222, سفید: #f7f7f4, زیتونی: #68745f" />
          </label>
          {combinations.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-[var(--ui-border)]">
              <div className="flex items-center justify-between gap-3 bg-[var(--ui-surface-raised)]/60 px-3 py-3">
                <p className="text-sm font-semibold text-[var(--ui-text)]">موجودی ترکیب‌ها</p>
                <span className="text-xs text-[var(--ui-muted)]">{combinations.length} گزینه</span>
              </div>
              <div className="divide-y divide-[var(--ui-border)]">
                {combinations.map((variant) => (
                  <div key={variant.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
                    <div className="flex items-center gap-2 text-sm text-[var(--ui-text)]">
                      {variant.color && <span className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: variant.hex }} />}
                      <span>{[variant.size && "سایز " + variant.size, variant.color].filter(Boolean).join(" / ")}</span>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-[var(--ui-muted)]">موجودی
                      <input type="number" min="0" step="1" value={variantStocks[variant.key] ?? "0"} onChange={(event) => setVariantStocks((current) => ({ ...current, [variant.key]: event.target.value }))} className="w-24 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-2 py-2 text-sm text-[var(--ui-text)] focus:border-[#9aa58e] focus:outline-none focus:ring-2 focus:ring-[#68745f]" required />
                    </label>
                  </div>
                ))}
              </div>
              <p className="bg-[var(--ui-surface-raised)] px-3 py-3 text-xs leading-5 text-[var(--ui-muted)]">ترکیب‌های با موجودی صفر در فروشگاه به‌عنوان ناموجود نمایش داده می‌شوند.</p>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--ui-border)] pb-2"><Shirt size={17} className="text-[#9aa58e]" aria-hidden="true" /><h3 className="text-sm font-bold text-[var(--ui-text)]">راهنمای تن‌خور</h3></div>
          <label className={labelClass}>نوع تن‌خور
            <select value={newProduct.fitType} onChange={(event) => updateField("fitType", event.target.value)} className={fieldClass}>
              {fitOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={labelClass}>توضیح تن‌خور (اختیاری)
            <textarea value={newProduct.fitDescription} onChange={(event) => updateField("fitDescription", event.target.value)} rows={2} maxLength={500} className={fieldClass} placeholder="مثلاً برش آزاد در قسمت شانه و کمر" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>قد مدل (اختیاری)
              <input type="text" value={newProduct.modelHeight} onChange={(event) => updateField("modelHeight", event.target.value)} className={fieldClass} placeholder="مثلاً ۱۸۵ سانتی‌متر" maxLength={40} />
            </label>
            <label className={labelClass}>سایز پوشیده‌شده توسط مدل
              <input type="text" value={newProduct.modelSize} onChange={(event) => updateField("modelSize", event.target.value)} className={fieldClass} placeholder="مثلاً M" maxLength={24} />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 border-b border-[var(--ui-border)] pb-2"><Ruler size={17} className="text-[#9aa58e]" aria-hidden="true" /><h3 className="text-sm font-bold text-[var(--ui-text)]">جدول اندازه‌گیری (اختیاری)</h3></div>
          <p className="text-xs leading-5 text-[var(--ui-muted)]">هر خط برای یک سایز و مقادیر به‌ترتیب: سایز، دور سینه، دور کمر، دور باسن، قد لباس. همه اندازه‌ها بر حسب سانتی‌متر هستند؛ مقدار خالی مجاز است.</p>
          <textarea value={newProduct.sizeChartText} onChange={(event) => updateField("sizeChartText", event.target.value)} rows={4} className={fieldClass} placeholder={"S, 92, 76, 96, 65\nM, 98, 82, 102, 68\nL, 104, 88, 108, 71"} />
          <p className="text-[11px] text-[var(--ui-muted)]">برای کالاهای بدون جدول اندازه، این بخش را خالی بگذارید.</p>
        </section>

        {imageError && <p role="alert" className="rounded-xl border border-[var(--ui-danger-border)] bg-red-950/40 p-3 text-sm leading-6 text-[var(--ui-danger)]">{imageError}</p>}
        <button type="submit" disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 py-3 text-sm font-semibold text-[var(--ui-button-text)] shadow-sm transition hover:bg-[var(--ui-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <><Loader className="h-5 w-5 animate-spin" aria-hidden="true" />در حال ذخیره…</> : <><PlusCircle className="h-5 w-5" aria-hidden="true" />ایجاد محصول</>}
        </button>
      </form>
    </motion.div>
  );
};
export default CreateProductForm;

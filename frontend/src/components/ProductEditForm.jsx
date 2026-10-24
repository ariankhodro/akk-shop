import { useEffect, useMemo, useState } from "react";
import { ExternalLink, ImagePlus, LoaderCircle, Save, X } from "lucide-react";
import { useProductStore } from "../stores/useProductStore";
import { useCategoryStore } from "../stores/useCategoryStore";
import { formatPrice, getCurrencyLabel, STORE_CURRENCY } from "../lib/commerce";
import { useDialog } from "../lib/use-dialog";
import PartFieldsEditor from "./admin/PartFieldsEditor";
import { partFieldsError, partFieldsFromProduct, partFieldsPayload } from "../lib/admin-part-fields";

const currencyLabel = getCurrencyLabel(STORE_CURRENCY);
const fallbackCategory = (slug) => ({
  _id: "legacy:" + slug,
  slug,
  name: { fa: slug || "دسته قدیمی" },
  parentId: null,
  ancestors: [],
  attributes: [],
  isActive: true,
  isLegacyFallback: true,
});
const categoryPath = (category, categories) => {
  const byId = new Map(categories.map((item) => [String(item._id), item]));
  const path = [];
  let current = category;
  let depth = 0;
  while (current && depth++ < 20) {
    path.unshift(current.name?.fa || current.name?.en || current.slug);
    current = byId.get(String(current.parentId || ""));
  }
  return path.join(" / ");
};
const parseSizes = (value) => [...new Set(String(value || "").split(/[,\n،]+/).map((part) => part.trim()).filter(Boolean))].slice(0, 24);
const parseColors = (value) => {
  const found = String(value || "").split(/[,\n،]+/).map((part) => part.trim()).filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf(":");
    const name = (separator >= 0 ? entry.slice(0, separator) : entry).trim();
    const hex = separator >= 0 ? entry.slice(separator + 1).trim() : "#d2d6dc";
    return { name, hex: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#d2d6dc" };
  });
  return found.filter((color, index) => color.name && found.findIndex((item) => item.name.toLowerCase() === color.name.toLowerCase()) === index).slice(0, 16);
};
const variantKey = (size, color) => JSON.stringify([size, color]);
const makeInitialForm = (product) => {
  const sizes = Array.isArray(product.sizes) && product.sizes.length
    ? product.sizes
    : [...new Set((product.variants || []).map((variant) => variant.size).filter(Boolean))];
  const colors = Array.isArray(product.colors) && product.colors.length
    ? product.colors
    : [...new Map((product.variants || []).filter((variant) => variant.color).map((variant) => [variant.color, { name: variant.color, hex: "#d2d6dc" }])).values()];
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  return {
    name: product.name || "",
    description: product.description || "",
    price: String(product.price ?? ""),
    stock: String(product.stock ?? ""),
    category: product.category || "",
    categoryId: product.categoryId ? String(product.categoryId) : "",
    images,
    sizesText: sizes.join(", "),
    colorsText: colors.map((color) => color.name + ": " + (color.hex || "#d2d6dc")).join(", "),
  };
};

const ProductEditForm = ({ product, onClose, onSaved }) => {
  const dialogRef = useDialog({ open: true, onClose });
  const [form, setForm] = useState(() => makeInitialForm(product));
  const [variantStocks, setVariantStocks] = useState(() => Object.fromEntries(
    (product.variants || []).map((variant) => [variantKey(variant.size || "", variant.color || ""), String(variant.stock ?? 0)])
  ));
  const [attributes, setAttributes] = useState(() => {
    const value = product.attributes || {};
    return value instanceof Map ? Object.fromEntries(value) : { ...value };
  });
  const [partFields, setPartFields] = useState(() => partFieldsFromProduct(product));
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const { updateProduct } = useProductStore();
  const { adminCategories, fetchAdminCategories } = useCategoryStore();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fetchAdminCategories();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [fetchAdminCategories]);

  const categoryChoices = useMemo(() => {
    const available = adminCategories.filter((category) => category.isActive !== false);
    const existingMatches = available.some((category) => category.slug === form.category || String(category._id) === form.categoryId);
    if (existingMatches) return available;
    if (form.category) return [fallbackCategory(form.category), ...available];
    return available;
  }, [adminCategories, form.category, form.categoryId]);
  const selectedCategory = categoryChoices.find((category) => String(category._id) === String(form.categoryId))
    || categoryChoices.find((category) => category.slug === form.category);
  const attributeDefinitions = useMemo(() => {
    if (!selectedCategory) return [];
    const byId = new Map(adminCategories.map((category) => [String(category._id), category]));
    const ancestors = (selectedCategory.ancestors || []).map((id) => byId.get(String(id))).filter(Boolean);
    const chain = [...ancestors, selectedCategory].sort((a, b) => (a.ancestors || []).length - (b.ancestors || []).length);
    const definitions = new Map();
    for (const category of chain) {
      for (const attribute of category.attributes || []) {
        if (String(category._id) === String(selectedCategory._id) || attribute.inherited !== false) definitions.set(attribute.key, attribute);
      }
    }
    return [...definitions.values()].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }, [adminCategories, selectedCategory]);

  useEffect(() => {
    if (form.categoryId || !form.category || !adminCategories.length) return;
    const match = adminCategories.find((category) => category.slug === form.category && category.isActive !== false);
    if (match) setForm((current) => ({ ...current, categoryId: String(match._id) }));
  }, [adminCategories, form.category, form.categoryId]);

  const sizes = useMemo(() => parseSizes(form.sizesText), [form.sizesText]);
  const colors = useMemo(() => parseColors(form.colorsText), [form.colorsText]);
  const combinations = useMemo(() => {
    if (!sizes.length && !colors.length) return [];
    const sizeOptions = sizes.length ? sizes : [""];
    const colorOptions = colors.length ? colors : [{ name: "", hex: "#d2d6dc" }];
    return sizeOptions.flatMap((size) => colorOptions.map((color) => ({
      size, color: color.name, hex: color.hex, key: variantKey(size, color.name),
    })));
  }, [sizes, colors]);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const fieldClass = "mt-1 block w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2.5 text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[#fb923c]/20";
  const labelClass = "block text-sm font-medium text-[var(--ui-muted)]";

  const handleImageChange = async (event) => {
    const files = Array.from(event.target.files || []);
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (form.images.length + files.length > 8 || files.some((file) => !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) || totalSize > 6 * 1024 * 1024) {
      setFormError("حداکثر ۸ تصویر و مجموعاً ۶ مگابایت مجاز است؛ هر تصویر باید از نوع عکس و حداکثر ۵ مگابایت باشد.");
      event.target.value = "";
      return;
    }
    setFormError("");
    setImageBusy(true);
    try {
      const encoded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("خواندن تصویر ناموفق بود"));
        reader.readAsDataURL(file);
      })));
      setForm((current) => ({ ...current, images: [...current.images, ...encoded].slice(0, 8) }));
    } catch {
      setFormError("خواندن تصویر ناموفق بود؛ دوباره تلاش کنید.");
    } finally {
      setImageBusy(false);
      event.target.value = "";
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    if (!Number.isSafeInteger(Number(form.price)) || Number(form.price) < 0) {
      setFormError("قیمت باید عدد صحیح و نامنفی به تومان باشد.");
      return;
    }
    if (!combinations.length && form.stock !== "" && (!Number.isInteger(Number(form.stock)) || Number(form.stock) < 0)) {
      setFormError("موجودی انبار باید عدد صحیح و نامنفی باشد یا برای کالای قدیمی خالی بماند.");
      return;
    }
    if (!combinations.length && form.stock === "" && (product.stock !== null && product.stock !== undefined || (product.variants || []).length > 0)) {
      setFormError("برای محصولی که قبلاً موجودی داشته، عدد موجودی را وارد کنید؛ خالی‌گذاشتن آن ردیابی موجودی را خاموش می‌کند.");
      return;
    }
    if (combinations.some((variant) => !Number.isInteger(Number(variantStocks[variant.key] ?? 0)) || Number(variantStocks[variant.key] ?? 0) < 0)) {
      setFormError("موجودی هر ترکیب باید عدد صحیح و نامنفی باشد.");
      return;
    }
    const partError = partFieldsError(partFields, form.price);
    if (partError) {
      setFormError(partError);
      return;
    }
    if (!selectedCategory?.slug && !form.category.trim()) {
      setFormError("یک دسته‌بندی انتخاب کنید.");
      return;
    }
    setSaving(true);
    try {
      await updateProduct(product._id, {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price),
        stock: combinations.length ? null : (form.stock === "" ? null : Number(form.stock)),
        // The stock the admin was looking at: the server applies the change as a delta
        // against it so reservations made meanwhile are never overwritten.
        stockBaseline: product.stock ?? null,
        category: selectedCategory?.slug || form.category.trim(),
        categoryId: selectedCategory?.isLegacyFallback
          ? (!adminCategories.length && form.categoryId && !String(form.categoryId).startsWith("legacy:") ? form.categoryId : "")
          : (selectedCategory?._id || form.categoryId),
        attributes,
        image: form.images[0] || "",
        images: form.images,
        sizes,
        colors,
        variants: combinations.map((variant) => ({
          size: variant.size, color: variant.color, stock: Number(variantStocks[variant.key] ?? 0),
          stockBaseline: (product.variants || []).find((stored) => (stored.size || "") === (variant.size || "") && (stored.color || "") === (variant.color || ""))?.stock ?? null,
        })),
        ...partFieldsPayload(partFields),
      });
      onSaved();
    } catch {
      // The product store displays the API error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="product-edit-title" dir="rtl" className="mx-auto my-4 max-w-5xl rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-[var(--ui-text)] shadow-2xl sm:my-8 sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-[var(--ui-border)] pb-4">
          <div>
            <h2 id="product-edit-title" className="text-xl font-bold text-[var(--ui-accent)] sm:text-2xl">ویرایش قطعه</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--ui-muted)]">تغییرات پس از ذخیره در صفحه عمومی محصول نمایش داده می‌شود. محصول می‌تواند جداگانه بایگانی یا بازیابی شود.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="بستن پنجره ویرایش" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border)] text-[var(--ui-muted)] hover:bg-[var(--ui-hover)]"><X size={18} aria-hidden="true" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 space-y-6">
              <section className="space-y-4">
                <h3 className="border-b border-[var(--ui-border)] pb-2 text-sm font-bold">اطلاعات پایه</h3>
                <label className={labelClass}>نام قطعه
                  <input value={form.name} onChange={(event) => updateField("name", event.target.value)} required maxLength={160} className={fieldClass} />
                </label>
                <label className={labelClass}>توضیحات
                  <textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} required maxLength={5000} rows={4} className={fieldClass} />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={labelClass}>قیمت خرده‌فروشی ({currencyLabel})
                    <input type="number" min="0" step="1" value={form.price} onChange={(event) => updateField("price", event.target.value)} required className={fieldClass} />
                  </label>
                  {combinations.length === 0 ? (
                    <label className={labelClass}>موجودی انبار
                      <input type="number" min="0" step="1" value={form.stock} onChange={(event) => updateField("stock", event.target.value)} className={fieldClass} />
                    </label>
                  ) : <p className="self-end rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-3 text-xs leading-5 text-[var(--ui-muted)]">موجودی هر گزینه در بخش گزینه‌ها تنظیم می‌شود.</p>}
                </div>
                <label className={labelClass}>دسته‌بندی
                  <select value={selectedCategory ? (selectedCategory.isLegacyFallback ? "legacy:" + selectedCategory.slug : String(selectedCategory._id)) : form.categoryId} onChange={(event) => {
                    const selected = categoryChoices.find((category) => (category.isLegacyFallback ? "legacy:" + category.slug : String(category._id)) === event.target.value);
                    setForm((current) => ({ ...current, categoryId: selected ? String(selected._id) : "", category: selected?.slug || "" }));
                    setAttributes({});
                  }} required className={fieldClass}>
                    <option value="">انتخاب دسته‌بندی</option>
                    {categoryChoices.map((category) => <option key={category._id} value={category.isLegacyFallback ? "legacy:" + category.slug : String(category._id)}>{categoryPath(category, adminCategories)}</option>)}
                  </select>
                </label>
              </section>

              <PartFieldsEditor value={partFields} onChange={setPartFields} retailPrice={form.price} fieldClass={fieldClass} labelClass={labelClass} idPrefix={"edit-part-" + product._id} />

              {attributeDefinitions.length > 0 && (
                <section className="space-y-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4">
                  <h3 className="border-b border-[var(--ui-border)] pb-2 text-sm font-bold">ویژگی‌های دسته‌بندی</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {attributeDefinitions.map((attribute) => (
                      <label key={attribute.key} className={labelClass}>
                        {attribute.name?.fa || attribute.name?.en || attribute.key}{attribute.required ? " *" : ""}
                        {attribute.type === "select" ? (
                          <select required={Boolean(attribute.required)} value={attributes[attribute.key] ?? ""} onChange={(event) => setAttributes((current) => ({ ...current, [attribute.key]: event.target.value }))} className={fieldClass}>
                            <option value="">انتخاب کنید</option>
                            {(attribute.options || []).map((option) => <option key={option.value} value={option.value}>{option.name?.fa || option.name?.en || option.value}</option>)}
                          </select>
                        ) : attribute.type === "multi-select" ? (
                          <select multiple value={Array.isArray(attributes[attribute.key]) ? attributes[attribute.key] : []} onChange={(event) => setAttributes((current) => ({ ...current, [attribute.key]: [...event.target.selectedOptions].map((option) => option.value) }))} className={fieldClass + " min-h-28"}>
                            {(attribute.options || []).map((option) => <option key={option.value} value={option.value}>{option.name?.fa || option.name?.en || option.value}</option>)}
                          </select>
                        ) : attribute.type === "boolean" ? (
                          <span className="mt-2 flex min-h-10 items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3">
                            <input type="checkbox" checked={Boolean(attributes[attribute.key])} onChange={(event) => setAttributes((current) => ({ ...current, [attribute.key]: event.target.checked }))} />
                            بله
                          </span>
                        ) : (
                          <input type={attribute.type === "number" ? "number" : "text"} min={attribute.type === "number" ? "0" : undefined} maxLength={attribute.type === "text" ? 500 : undefined} required={Boolean(attribute.required)} value={attributes[attribute.key] ?? ""} onChange={(event) => setAttributes((current) => ({ ...current, [attribute.key]: event.target.value }))} className={fieldClass} />
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <h3 className="border-b border-[var(--ui-border)] pb-2 text-sm font-bold">گالری تصاویر</h3>
                <p className="text-xs leading-5 text-[var(--ui-muted)]">تصویر اول تصویر اصلی محصول خواهد بود. تا ۸ تصویر مجاز است؛ تصاویر تازه هنگام ذخیره بارگذاری می‌شوند.</p>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-4 py-2.5 text-sm hover:bg-[var(--ui-hover)]">
                  <ImagePlus size={17} aria-hidden="true" /> افزودن تصاویر
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={handleImageChange} disabled={imageBusy || form.images.length >= 8} />
                </label>
                {imageBusy && <p role="status" className="text-xs text-[var(--ui-muted)]">در حال آماده‌سازی تصاویر…</p>}
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {form.images.map((image, index) => (
                    <div key={image} className="relative overflow-hidden rounded-xl border border-[var(--ui-border)]">
                      <img src={image} alt={"پیش‌نمایش تصویر " + (index + 1)} className="aspect-square w-full object-cover" />
                      {index === 0 && <span className="absolute bottom-2 right-2 rounded-full bg-black/75 px-2 py-1 text-[10px]">تصویر اصلی</span>}
                      <button type="button" onClick={() => updateField("images", form.images.filter((_, imageIndex) => index !== imageIndex))} aria-label={"حذف تصویر " + (index + 1)} className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-[var(--ui-text)]"><X size={14} aria-hidden="true" /></button>
                    </div>
                  ))}
                  {!form.images.length && <p className="col-span-full text-xs text-[var(--ui-muted)]">هنوز تصویری ثبت نشده است.</p>}
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="border-b border-[var(--ui-border)] pb-2 text-sm font-bold">گزینه‌ها و موجودی هر گزینه (اختیاری)</h3>
                <label className={labelClass}>نوع / موقعیت
                  <input value={form.sizesText} onChange={(event) => updateField("sizesText", event.target.value)} placeholder="چپ, راست" className={fieldClass} />
                </label>
                <label className={labelClass}>رنگ (نام: کد رنگ)
                  <input value={form.colorsText} onChange={(event) => updateField("colorsText", event.target.value)} placeholder="مشکی: #222222, نقره‌ای: #c0c0c0" className={fieldClass} />
                </label>
                {combinations.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-[var(--ui-border)]">
                    <div className="bg-[var(--ui-surface-raised)]/60 px-3 py-3 text-sm font-semibold">موجودی ترکیب‌ها · {combinations.length} گزینه</div>
                    {combinations.map((variant) => (
                      <label key={variant.key} className="flex items-center justify-between gap-3 border-t border-[var(--ui-border)] px-3 py-3 text-sm text-[var(--ui-text)]">
                        <span className="flex min-w-0 items-center gap-2">{variant.color && <span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: variant.hex }} />} {[variant.size, variant.color].filter(Boolean).join(" / ") || "پیش‌فرض"}</span>
                        <input type="number" min="0" step="1" required value={variantStocks[variant.key] ?? "0"} onChange={(event) => setVariantStocks((current) => ({ ...current, [variant.key]: event.target.value }))} className="w-24 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-2 py-2 text-sm text-[var(--ui-text)]" aria-label={"موجودی " + [variant.size, variant.color].filter(Boolean).join(" / ")} />
                      </label>
                    ))}
                    <p className="bg-[var(--ui-surface-raised)] px-3 py-3 text-xs text-[var(--ui-muted)]">هر گزینه باید موجودی مستقل داشته باشد.</p>
                  </div>
                )}
              </section>

              {formError && <p role="alert" className="rounded-xl border border-[var(--ui-danger-border)]/50 bg-[var(--ui-danger-bg)] p-3 text-sm leading-6 text-[var(--ui-danger)]">{formError}</p>}
              <div className="flex flex-wrap gap-2 border-t border-[var(--ui-border)] pt-4">
                <button type="submit" disabled={saving || imageBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-5 py-2.5 text-sm font-bold text-[var(--ui-button-text)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-50">
                  {saving ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
                  {saving ? "در حال ذخیره…" : "ذخیره تغییرات"}
                </button>
                <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--ui-border)] px-5 py-2.5 text-sm text-[var(--ui-text)] hover:bg-[var(--ui-hover)]">انصراف</button>
              </div>
            </div>

            <aside className="h-fit rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4">
              <h3 className="text-sm font-bold text-[var(--ui-text)]">پیش‌نمایش قطعه</h3>
              <div className="mt-3 overflow-hidden rounded-xl bg-[var(--ui-surface)]">
                {form.images[0] ? <img src={form.images[0]} alt="تصویر اصلی پیش‌نمایش" className="aspect-square w-full object-contain" /> : <div className="flex aspect-square items-center justify-center text-sm text-[var(--ui-muted)]">بدون تصویر</div>}
                <div className="space-y-2 p-3">
                  <p className="font-semibold text-[var(--ui-text)]">{form.name || "نام قطعه"}</p>
                  {partFields.sku && <p dir="ltr" className="text-left text-xs text-[var(--ui-muted)]">{partFields.sku}</p>}
                  <p className="line-clamp-4 text-xs leading-5 text-[var(--ui-muted)]">{form.description || "توضیحات محصول در این بخش نمایش داده می‌شود."}</p>
                  <p className="text-lg font-bold text-[var(--ui-accent)]">{formatPrice(Number(form.price) || 0, STORE_CURRENCY)}</p>
                  {partFields.wholesalePrice !== "" && <p className="text-xs text-[var(--ui-muted)]">عمده: {formatPrice(Number(partFields.wholesalePrice) || 0, STORE_CURRENCY)} · از {new Intl.NumberFormat("fa-IR").format(Number(partFields.wholesaleMinQuantity) || 1)} عدد</p>}
                  <p className="text-xs text-[var(--ui-muted)]">{selectedCategory?.name?.fa || form.category || "بدون دسته‌بندی"}</p>
                  {combinations.length > 0 && <p className="text-xs text-[var(--ui-muted)]">{combinations.length} گزینه</p>}
                  {partFields.fitments.length > 0 && <p className="text-xs text-[var(--ui-muted)]">سازگار با {new Intl.NumberFormat("fa-IR").format(partFields.fitments.length)} خودرو</p>}
                  <a href={"/product/" + product._id} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[var(--ui-accent)] underline underline-offset-4">
                    بازکردن صفحه عمومی <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </aside>
          </div>
        </form>
      </section>
    </div>
  );
};

export default ProductEditForm;

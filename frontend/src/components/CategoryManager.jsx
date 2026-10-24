import { useEffect, useMemo, useState } from "react";
import { Archive, FolderPlus, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useCategoryStore } from "../stores/useCategoryStore";

const emptyForm = () => ({
  name: { fa: "", en: "" },
  slug: "",
  parentId: "",
  description: { fa: "", en: "" },
  image: "",
  sortOrder: "0",
  isActive: true,
  showInNavigation: true,
  attributes: [],
});

const slugify = (value) => {
  const transliteration = {
    "ا":"a","آ":"a","ب":"b","پ":"p","ت":"t","ث":"s","ج":"j","چ":"ch","ح":"h","خ":"kh",
    "د":"d","ذ":"z","ر":"r","ز":"z","ژ":"zh","س":"s","ش":"sh","ص":"s","ض":"z","ط":"t","ظ":"z",
    "ع":"a","غ":"gh","ف":"f","ق":"gh","ک":"k","گ":"g","ل":"l","م":"m","ن":"n","و":"u","ه":"h",
    "ی":"y","ئ":"y","ء":""
  };
  return String(value || "").toLowerCase().trim()
    .replace(/[آا‌بپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئء]/g, (letter) => transliteration[letter] ?? letter)
    .normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
};

const idOf = (value) => value == null ? "" : String(value);
const labelOf = (category) => category?.name?.fa || category?.name?.en || category?.slug || "بدون نام";

const getPath = (category, categories) => {
  const byId = new Map(categories.map((item) => [idOf(item._id), item]));
  const parts = [];
  let current = category;
  let remaining = 20;
  while (current && remaining-- > 0) {
    parts.unshift(labelOf(current));
    current = byId.get(idOf(current.parentId));
  }
  return parts.join(" / ");
};

const normalizeAttribute = (attribute, index) => ({
  key: attribute.key || "",
  name: { fa: attribute.name?.fa || "", en: attribute.name?.en || "" },
  type: attribute.type || "select",
  optionsText: (attribute.options || []).map((option) =>
    [option.value, option.name?.fa, option.name?.en].join("|")
  ).join("\n"),
  required: Boolean(attribute.required),
  filterable: attribute.filterable !== false,
  searchable: attribute.searchable !== false,
  inherited: attribute.inherited !== false,
  sortOrder: String(attribute.sortOrder ?? index),
});

const CategoryManager = () => {
  const {
    adminCategories: categories,
    loading,
    error,
    fetchAdminCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useCategoryStore();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState({});
  const [query, setQuery] = useState("");

  useEffect(() => { fetchAdminCategories(); }, [fetchAdminCategories]);

  const sorted = useMemo(() => [...categories].sort((a, b) =>
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
    labelOf(a).localeCompare(labelOf(b), "fa")
  ), [categories]);

  const descendantsOf = (id) => {
    const result = new Set([idOf(id)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) {
        if (result.has(idOf(category.parentId)) && !result.has(idOf(category._id))) {
          result.add(idOf(category._id));
          changed = true;
        }
      }
    }
    return result;
  };

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId("");
    setFormOpen(false);
    setNotice("");
  };

  const startCreate = (parentId = "") => {
    setForm({ ...emptyForm(), parentId: idOf(parentId), showInNavigation: true });
    setEditingId("");
    setNotice("");
    setFormOpen(true);
  };

  const startEdit = (category) => {
    setForm({
      name: { fa: category.name?.fa || "", en: category.name?.en || "" },
      slug: category.slug || "",
      parentId: idOf(category.parentId),
      description: { fa: category.description?.fa || "", en: category.description?.en || "" },
      image: category.image || "",
      sortOrder: String(category.sortOrder ?? 0),
      isActive: category.isActive !== false,
      showInNavigation: category.showInNavigation !== false,
      attributes: (category.attributes || []).map(normalizeAttribute),
    });
    setEditingId(idOf(category._id));
    setNotice("");
    setFormOpen(true);
  };

  const updateLocalized = (group, key, value) => {
    setForm((current) => ({
      ...current,
      [group]: { ...current[group], [key]: value },
    }));
    if (group === "name" && key === "fa" && !editingId) {
      setForm((current) => ({ ...current, slug: slugify(value) }));
    }
  };

  const handleCategoryImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("لطفاً یک فایل تصویری انتخاب کنید.");
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setNotice("حجم تصویر دسته‌بندی باید حداکثر ۲ مگابایت باشد.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({ ...current, image: String(reader.result || "") }));
      setNotice("");
    };
    reader.onerror = () => setNotice("خواندن تصویر ناموفق بود؛ دوباره تلاش کنید.");
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const updateAttribute = (index, key, value) => {
    setForm((current) => ({
      ...current,
      attributes: current.attributes.map((attribute, i) =>
        i === index ? { ...attribute, [key]: value } : attribute
      ),
    }));
  };

  const parseAttributeOptions = (text) => String(text || "").split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, fa, en] = line.split("|").map((part) => (part || "").trim());
      return { value, name: { fa: fa || value, en: en || value } };
    });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setNotice("");
    const attributes = form.attributes.map((attribute, index) => ({
      key: attribute.key.trim(),
      name: { fa: attribute.name.fa.trim(), en: attribute.name.en.trim() },
      type: attribute.type,
      options: ["select", "multi-select"].includes(attribute.type) ? parseAttributeOptions(attribute.optionsText) : [],
      required: Boolean(attribute.required),
      filterable: Boolean(attribute.filterable),
      searchable: Boolean(attribute.searchable),
      inherited: Boolean(attribute.inherited),
      sortOrder: Number(attribute.sortOrder || index),
    }));
    const payload = {
      name: { fa: form.name.fa.trim(), en: form.name.en.trim() },
      slug: form.slug.trim(),
      parentId: form.parentId || null,
      description: { fa: form.description.fa.trim(), en: "" },
      image: form.image.trim(),
      sortOrder: Number(form.sortOrder),
      isActive: Boolean(form.isActive),
      showInNavigation: Boolean(form.showInNavigation),
      attributes,
    };
    const success = editingId
      ? await updateCategory(editingId, payload)
      : await createCategory(payload);
    if (success) resetForm();
    else setNotice(useCategoryStore.getState().error || "ذخیره دسته‌بندی ناموفق بود.");
  };

  const toggleActive = async (category) => {
    await updateCategory(idOf(category._id), { isActive: !category.isActive });
  };

  const handleDelete = async (category) => {
    const warning = "حذف دائمی «" + labelOf(category) + "»؟ اگر محصول یا زیر‌دسته‌ای وابسته باشد، حذف رد می‌شود.";
    if (!window.confirm(warning)) return;
    const success = await deleteCategory(idOf(category._id));
    if (!success) setNotice(useCategoryStore.getState().error || "حذف دسته‌بندی ناموفق بود.");
  };

  const filtered = query.trim().toLocaleLowerCase("fa-IR");
  const visibleCategories = filtered
    ? sorted.filter((category) =>
        [category.name?.fa, category.name?.en, category.slug, getPath(category, sorted)]
          .some((value) => String(value || "").toLocaleLowerCase("fa-IR").includes(filtered))
      )
    : sorted;
  const visibleIds = new Set(visibleCategories.map((category) => idOf(category._id)));
  const roots = visibleCategories.filter((category) => !category.parentId || !visibleIds.has(idOf(category.parentId)));
  const editableParents = sorted.filter((category) =>
    category.isActive && (!editingId || !descendantsOf(editingId).has(idOf(category._id)))
  );

  const renderCategory = (category, depth = 0) => {
    const children = visibleCategories.filter((item) => idOf(item.parentId) === idOf(category._id));
    const isExpanded = filtered || expanded[idOf(category._id)] !== false;
    return (
      <div key={idOf(category._id)} className="border-b border-[var(--ui-border)]/80 last:border-b-0">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 hover:bg-[var(--ui-hover)]" style={{ paddingRight: (12 + depth * 20) + "px" }}>
          <button
            type="button"
            onClick={() => setExpanded((current) => ({ ...current, [idOf(category._id)]: !isExpanded }))}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ui-muted)] hover:bg-[var(--ui-hover)]"
            aria-label={isExpanded ? "بستن زیر‌دسته‌ها" : "نمایش زیر‌دسته‌ها"}
          >
            <span className="text-lg leading-none">{children.length ? (isExpanded ? "−" : "+") : "·"}</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--ui-text)]">{labelOf(category)}</span>
              <span className="text-xs text-[var(--ui-muted)]" dir="ltr">{category.slug}</span>
              {!category.isActive && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-[var(--ui-warning)]">بایگانی / غیرفعال</span>}
            </div>
            <p className="mt-1 text-xs text-[var(--ui-muted)]">
              {category.name?.en || ""} · {Number(category.productCount || 0)} محصول · {Number(category.childCount || 0)} زیر‌دسته
            </p>
          </div>
          <button type="button" onClick={() => startCreate(category._id)} title="افزودن زیر‌دسته" className="rounded-lg p-2 text-[var(--ui-success)] hover:bg-[var(--ui-hover)]"><FolderPlus size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => startEdit(category)} title="ویرایش" className="rounded-lg p-2 text-sky-300 hover:bg-[var(--ui-hover)]"><Pencil size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => toggleActive(category)} title={category.isActive ? "بایگانی" : "فعال‌سازی"} className="rounded-lg p-2 text-[var(--ui-warning)] hover:bg-[var(--ui-hover)]"><Archive size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => handleDelete(category)} title="حذف دائمی" className="rounded-lg p-2 text-[var(--ui-danger)] hover:bg-[var(--ui-hover)]"><Trash2 size={16} aria-hidden="true" /></button>
        </div>
        {isExpanded && children.length > 0 && <div>{children.map((child) => renderCategory(child, depth + 1))}</div>}
      </div>
    );
  };

  const fieldClass = "mt-1 block w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2.5 text-sm text-[var(--ui-text)] outline-none transition focus:border-[#fb923c] focus:ring-2 focus:ring-[#ea580c]/30";
  const labelClass = "block text-sm font-medium text-[var(--ui-muted)]";

  return (
    <section dir="rtl" className="mx-auto max-w-6xl space-y-5 text-[var(--ui-text)]">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5">
        <div>
          <h2 className="text-2xl font-semibold text-[#fb923c]">مدیریت دسته‌بندی‌ها</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-muted)]">درخت دسته‌ها، نام‌های فارسی و انگلیسی، ویژگی‌های محصول و نمایش هر دسته در منوی همبرگری موبایل و دسکتاپ را از این بخش مدیریت کنید.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fetchAdminCategories()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--ui-border)] px-3 py-2 text-sm text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"><RefreshCw size={15} aria-hidden="true" /> تازه‌سازی</button>
          <button type="button" onClick={() => startCreate()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold text-[var(--ui-button-text)] hover:bg-[#78866d]"><Plus size={16} aria-hidden="true" /> دسته اصلی جدید</button>
        </div>
      </header>

      {(notice || error) && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[var(--ui-danger)]">{notice || error}</div>}

      {formOpen && (
        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold text-[#fb923c]">{editingId ? "ویرایش دسته‌بندی" : "ایجاد دسته‌بندی"}</h3>
            <button type="button" onClick={resetForm} aria-label="بستن فرم" className="rounded-lg p-2 text-[var(--ui-muted)] hover:bg-[var(--ui-hover)]"><X size={18} aria-hidden="true" /></button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>نام فارسی
              <input className={fieldClass} required maxLength={120} value={form.name.fa} onChange={(event) => updateLocalized("name", "fa", event.target.value)} />
            </label>
            <label className={labelClass}>English name
              <input className={fieldClass} required maxLength={120} dir="ltr" value={form.name.en} onChange={(event) => updateLocalized("name", "en", event.target.value)} />
            </label>
            <label className={labelClass}>شناسه لاتین برگرفته از نام فارسی
              <input className={fieldClass} required maxLength={96} pattern="[a-z0-9]+(-[a-z0-9]+)*" dir="ltr" disabled={Boolean(editingId)} value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value.toLowerCase() }))} />
              <span className="mt-1 block text-xs text-[var(--ui-muted)]">هنگام ایجاد، از نام فارسی به شکل لاتین ساخته می‌شود؛ شناسه دسته‌های موجود برای حفظ لینک‌ها تغییر نمی‌کند.</span>
            </label>
            <label className={labelClass}>دسته والد
              <select className={fieldClass} value={form.parentId} onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value }))}>
                <option value="">بدون والد (دسته اصلی)</option>
                {editableParents.map((category) => <option key={idOf(category._id)} value={idOf(category._id)}>{getPath(category, sorted)}</option>)}
              </select>
            </label>
            <label className={labelClass}>ترتیب نمایش
              <input className={fieldClass} type="number" min="0" max="100000" step="1" required value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} />
            </label>
            <div className={labelClass}>
              تصویر دسته‌بندی (حداکثر ۲ مگابایت)
              <input className={fieldClass} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleCategoryImageChange} />
              <span className="mt-1 block text-xs text-[var(--ui-muted)]">فرمت‌های تصویری؛ حداکثر ۲ مگابایت.</span>
              {form.image && <div className="mt-3 flex items-center gap-3">
                <img src={form.image} alt="پیش‌نمایش تصویر دسته‌بندی" className="h-20 w-20 rounded-xl border border-[var(--ui-border)] object-cover" />
                <button type="button" onClick={() => setForm((current) => ({ ...current, image: "" }))} className="rounded-lg border border-[var(--ui-border)] px-3 py-2 text-xs hover:bg-[var(--ui-hover)]">حذف تصویر</button>
              </div>}
            </div>
          </div>
          <div>
            <label className={labelClass}>توضیحات فارسی
              <textarea className={fieldClass} rows={3} maxLength={1000} value={form.description.fa} onChange={(event) => updateLocalized("description", "fa", event.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl bg-[var(--ui-input-bg)] p-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> فعال در فروشگاه</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.showInNavigation} onChange={(event) => setForm((current) => ({ ...current, showInNavigation: event.target.checked }))} /> نمایش در منوی همبرگری فروشگاه</label>
          </div>

          <section className="space-y-3 rounded-xl border border-[var(--ui-border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-[var(--ui-text)]">ویژگی‌های این دسته</h4>
                <p className="mt-1 text-xs leading-5 text-[var(--ui-muted)]">برای گزینه‌ها هر خط را به شکل value|نام فارسی|English label وارد کنید. ویژگی ارث‌پذیر به زیر‌دسته‌ها منتقل می‌شود.</p>
              </div>
              <button type="button" onClick={() => setForm((current) => ({ ...current, attributes: [...current.attributes, normalizeAttribute({ key: "", type: "select", options: [], inherited: true }, current.attributes.length)] }))} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--ui-border)] px-3 py-2 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"><Plus size={14} aria-hidden="true" /> ویژگی جدید</button>
            </div>
            {form.attributes.length === 0 && <p className="rounded-lg bg-[var(--ui-surface-raised)] p-4 text-sm text-[var(--ui-muted)]">ویژگی اختصاصی تعریف نشده است. ویژگی‌های والد در صورت ارث‌پذیری در فرم محصول نمایش داده می‌شوند.</p>}
            {form.attributes.map((attribute, index) => (
              <div key={index} className="space-y-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#c8d0bd]">ویژگی {index + 1}</span>
                  <button type="button" onClick={() => setForm((current) => ({ ...current, attributes: current.attributes.filter((_, i) => i !== index) }))} aria-label="حذف ویژگی از فرم" className="rounded-lg p-2 text-[var(--ui-danger)] hover:bg-[var(--ui-hover)]"><Trash2 size={15} aria-hidden="true" /></button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className={labelClass}>کلید داخلی
                    <input className={fieldClass} required pattern="[a-z][a-z0-9_]*" dir="ltr" placeholder="engine_type" value={attribute.key} onChange={(event) => updateAttribute(index, "key", event.target.value.toLowerCase())} />
                  </label>
                  <label className={labelClass}>نام فارسی
                    <input className={fieldClass} required value={attribute.name.fa} onChange={(event) => updateAttribute(index, "name", { ...attribute.name, fa: event.target.value })} />
                  </label>
                  <label className={labelClass}>English label
                    <input className={fieldClass} required dir="ltr" value={attribute.name.en} onChange={(event) => updateAttribute(index, "name", { ...attribute.name, en: event.target.value })} />
                  </label>
                  <label className={labelClass}>نوع ویژگی
                    <select className={fieldClass} value={attribute.type} onChange={(event) => updateAttribute(index, "type", event.target.value)}>
                      <option value="select">یک گزینه</option><option value="multi-select">چند گزینه</option><option value="boolean">بله / خیر</option><option value="number">عدد</option><option value="text">متن</option>
                    </select>
                  </label>
                </div>
                {["select", "multi-select"].includes(attribute.type) && (
                  <label className={labelClass}>گزینه‌ها (هر خط: value|نام فارسی|English label)
                    <textarea className={fieldClass} rows={3} dir="ltr" placeholder={"petrol|بنزینی|Petrol\nturbo|توربو|Turbo"} value={attribute.optionsText} onChange={(event) => updateAttribute(index, "optionsText", event.target.value)} required />
                  </label>
                )}
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--ui-muted)]">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={attribute.required} onChange={(event) => updateAttribute(index, "required", event.target.checked)} /> اجباری</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={attribute.filterable} onChange={(event) => updateAttribute(index, "filterable", event.target.checked)} /> قابل فیلتر</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={attribute.searchable} onChange={(event) => updateAttribute(index, "searchable", event.target.checked)} /> قابل جست‌وجو</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={attribute.inherited} onChange={(event) => updateAttribute(index, "inherited", event.target.checked)} /> ارث‌بری برای زیر‌دسته‌ها</label>
                </div>
              </div>
            ))}
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--ui-button-text)] hover:bg-[#78866d] disabled:cursor-not-allowed disabled:opacity-60"><Save size={16} aria-hidden="true" /> {loading ? "در حال ذخیره…" : "ذخیره دسته‌بندی"}</button>
            <button type="button" onClick={resetForm} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--ui-border)] px-5 py-2.5 text-sm text-[var(--ui-muted)] hover:bg-[var(--ui-hover)]">انصراف</button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ui-border)] px-4 py-4 sm:px-5">
          <div><h3 className="font-semibold">درخت دسته‌بندی‌ها</h3><p className="mt-1 text-xs text-[var(--ui-muted)]">{categories.length} دسته ثبت‌شده</p></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 w-full max-w-xs rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2 text-sm text-[var(--ui-text)] outline-none focus:border-[#fb923c]" placeholder="جست‌وجوی نام یا slug…" />
        </div>
        {loading && categories.length === 0 ? (
          <div role="status" className="p-8 text-center text-sm text-[var(--ui-muted)]">در حال دریافت دسته‌بندی‌ها…</div>
        ) : roots.length ? (
          <div>{roots.map((category) => renderCategory(category))}</div>
        ) : (
          <div className="space-y-3 p-8 text-center">
            <p className="text-sm text-[var(--ui-muted)]">{filtered ? "دسته‌ای با این جست‌وجو پیدا نشد." : "هنوز دسته‌ای ثبت نشده است."}</p>
            {!filtered && <button type="button" onClick={() => startCreate()} className="inline-flex items-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold"><Plus size={15} aria-hidden="true" /> اولین دسته را بسازید</button>}
          </div>
        )}
      </div>
      <p className="text-xs leading-5 text-[var(--ui-muted)]">حذف دائمی فقط زمانی مجاز است که دسته هیچ محصول یا زیر‌دسته‌ای نداشته باشد. برای نگه‌داشتن تاریخچه و لینک‌ها، در بیشتر مواقع غیرفعال‌سازی یا بایگانی امن‌تر است.</p>
    </section>
  );
};

export default CategoryManager;

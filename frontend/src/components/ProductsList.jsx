import { useCallback, useEffect, useState } from "react";
import { Archive, ExternalLink, LoaderCircle, Pencil, RefreshCw, RotateCcw, Save, Star, Trash2 } from "lucide-react";
import { useProductStore } from "../stores/useProductStore";
import { useCategoryStore } from "../stores/useCategoryStore";
import { formatPrice, isStockTracked } from "../lib/commerce";
import ProductEditForm from "./ProductEditForm";

const PAGE_SIZE = 12;
const numberFa = (value) => new Intl.NumberFormat("fa-IR").format(Number(value) || 0);
const labels = { jeans: "شلوار جین", "t-shirts": "تی‌شرت", shoes: "کفش", glasses: "عینک", jackets: "کت و کاپشن", suits: "کت‌وشلوار", bags: "کیف" };
const stockLabel = (product) => {
  if ((product.variants || []).length) {
    const total = product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
    return total > 0 ? "موجودی " + numberFa(total) : "ناموجود";
  }
  if (!isStockTracked(product)) return "ثبت نشده";
  return Number(product.stock) > 0 ? "موجودی " + numberFa(product.stock) : "ناموجود";
};

const ProductsList = () => {
  const {
    products, loading, error, fetchAllProducts, deleteProduct,
    toggleFeaturedProduct, updateProductStock, updateProductVariantStock, setProductActive,
  } = useProductStore();
  const { adminCategories, fetchAdminCategories } = useCategoryStore();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingProduct, setEditingProduct] = useState(null);
  const [stockDrafts, setStockDrafts] = useState({});
  const [variantDrafts, setVariantDrafts] = useState({});

  useEffect(() => { fetchAdminCategories(); }, [fetchAdminCategories]);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  const loadProducts = useCallback(async () => {
    const data = await fetchAllProducts({
      q: debouncedSearch,
      category: categoryFilter,
      stock: stockFilter,
      status: statusFilter,
      page,
      limit: PAGE_SIZE,
    });
    if (data?.pagination) setPagination(data.pagination);
    else setPagination({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  }, [fetchAllProducts, debouncedSearch, categoryFilter, stockFilter, statusFilter, page]);

  useEffect(() => { loadProducts(); }, [loadProducts, refreshKey]);

  const changeFilter = (setter, value) => {
    setter(value);
    setPage(1);
  };
  const reload = () => setRefreshKey((current) => current + 1);

  const saveStock = async (product) => {
    const raw = stockDrafts[product._id] ?? (isStockTracked(product) ? String(product.stock) : "");
    if (raw === "" || !Number.isInteger(Number(raw)) || Number(raw) < 0) return;
    const saved = await updateProductStock(product._id, Number(raw));
    if (saved) {
      setStockDrafts((current) => ({ ...current, [product._id]: String(raw) }));
      reload();
    }
  };

  const saveVariantStock = async (product, variant) => {
    const key = product._id + "::" + (variant.size || "") + "::" + (variant.color || "");
    const raw = variantDrafts[key] ?? String(variant.stock);
    if (raw === "" || !Number.isInteger(Number(raw)) || Number(raw) < 0) return;
    const saved = await updateProductVariantStock(product._id, variant.size || "", variant.color || "", Number(raw));
    if (saved) {
      setVariantDrafts((current) => ({ ...current, [key]: String(raw) }));
      reload();
    }
  };

  const toggleArchive = async (product) => {
    const next = product.isActive === false;
    if (!next && !window.confirm("محصول «" + product.name + "» از فروشگاه عمومی بایگانی می‌شود و دیگر برای خرید نمایش داده نخواهد شد. ادامه می‌دهید؟")) return;
    const saved = await setProductActive(product._id, next);
    if (saved) reload();
  };

  const permanentlyDelete = async (product) => {
    const approved = window.confirm("حذف دائمی محصول «" + product.name + "» برگشت‌پذیر نیست. سوابق سفارش موجود ممکن است همچنان نام و قیمت ثبت‌شده را نگه دارند. مطمئن هستید؟");
    if (!approved) return;
    const deleted = await deleteProduct(product._id);
    if (deleted) reload();
  };

  const categoryName = (product) => adminCategories.find((category) =>
    String(category._id) === String(product.categoryId)
  )?.name?.fa || labels[product.category] || product.category || "—";

  return (
    <section dir="rtl" className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-[var(--ui-text)]">محصولات و موجودی</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--ui-muted)]">محصولات را ویرایش، پیش‌نمایش، بایگانی یا بازیابی کنید. حذف دائمی فقط برای محصولات بایگانی‌شده نمایش داده می‌شود.</p>
        </div>
        <button type="button" onClick={reload} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ui-border)] px-4 py-2 text-sm text-[var(--ui-text)] hover:bg-[var(--ui-hover)] disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" /> تازه‌سازی
        </button>
      </header>

      <div className="grid gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs font-semibold text-[var(--ui-muted)]">جست‌وجو
          <input type="search" value={search} onChange={(event) => changeFilter(setSearch, event.target.value)} placeholder="نام، توضیحات یا نام دسته…" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)]" />
        </label>
        <label className="block text-xs font-semibold text-[var(--ui-muted)]">دسته‌بندی
          <select value={categoryFilter} onChange={(event) => changeFilter(setCategoryFilter, event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)]">
            <option value="">همه دسته‌بندی‌ها</option>
            {adminCategories.map((category) => <option key={category._id} value={category.slug}>{category.name?.fa || category.name?.en || category.slug}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-[var(--ui-muted)]">وضعیت موجودی
          <select value={stockFilter} onChange={(event) => changeFilter(setStockFilter, event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)]">
            <option value="">همه وضعیت‌ها</option>
            <option value="in_stock">دارای موجودی</option>
            <option value="out_of_stock">ناموجود</option>
            <option value="untracked">بدون ثبت موجودی</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-[var(--ui-muted)]">وضعیت انتشار
          <select value={statusFilter} onChange={(event) => changeFilter(setStatusFilter, event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)]">
            <option value="active">منتشرشده</option>
            <option value="archived">بایگانی‌شده</option>
            <option value="all">همه محصولات</option>
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ui-border)] px-4 py-3 sm:px-5">
          <h3 className="font-semibold text-[var(--ui-text)]">فهرست محصولات</h3>
          <span className="text-xs text-[var(--ui-muted)]">{numberFa(pagination.total)} محصول</span>
        </div>
        {loading && products.length === 0 ? (
          <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-[var(--ui-muted)]"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />در حال دریافت محصولات…</div>
        ) : error && products.length === 0 ? (
          <div className="space-y-3 p-8 text-center">
            <p role="alert" className="text-sm leading-6 text-[var(--ui-danger)]">{error}</p>
            <button type="button" onClick={reload} className="rounded-full border border-[var(--ui-border)] px-4 py-2 text-sm text-[var(--ui-text)]">تلاش دوباره</button>
          </div>
        ) : products.length === 0 ? (
          <div className="space-y-3 p-8 text-center">
            <p className="text-sm text-[var(--ui-muted)]">{debouncedSearch || categoryFilter || stockFilter ? "محصولی با این فیلترها پیدا نشد." : "هنوز محصولی ثبت نشده است."}</p>
            {(debouncedSearch || categoryFilter || stockFilter || statusFilter !== "active") && <button type="button" onClick={() => { setSearch(""); setDebouncedSearch(""); setCategoryFilter(""); setStockFilter(""); setStatusFilter("active"); setPage(1); }} className="text-sm font-semibold text-[var(--ui-accent)] underline underline-offset-4">پاک‌کردن فیلترها</button>}
          </div>
        ) : (
          <>
            {error && <p role="alert" className="border-b border-red-900/50 bg-red-950/20 px-4 py-2 text-xs text-[var(--ui-danger)]">{error}</p>}
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full divide-y divide-[var(--ui-border)]">
                <thead className="bg-[var(--ui-input-bg)]">
                  <tr>
                    {["محصول", "قیمت", "دسته‌بندی", "موجودی", "انتشار", "عملیات"].map((label) => <th key={label} scope="col" className="px-4 py-3 text-right text-xs font-semibold text-[var(--ui-muted)]">{label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ui-border)]">
                  {products.map((product) => (
                    <tr key={product._id} className="align-top transition hover:bg-[var(--ui-hover)]">
                      <td className="px-4 py-4">
                        <div className="flex max-w-sm items-start gap-3">
                          {product.image ? <img src={product.image} alt="" loading="lazy" className="h-14 w-12 shrink-0 rounded-lg bg-[var(--ui-surface-raised)] object-cover" /> : <span className="h-14 w-12 shrink-0 rounded-lg bg-[var(--ui-surface-raised)]" />}
                          <div className="min-w-0">
                            <p className="font-semibold text-[var(--ui-text)]">{product.name}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ui-muted)]">{product.description || "بدون توضیحات"}</p>
                            {product.isActive !== false ? (
                              <a href={"/product/" + product._id} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--ui-accent)] hover:underline">
                                پیش‌نمایش عمومی <ExternalLink size={12} aria-hidden="true" />
                              </a>
                            ) : <p className="mt-2 text-xs text-[var(--ui-muted)]">برای پیش‌نمایش عمومی، ابتدا محصول را بازیابی کنید.</p>}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-[var(--ui-text)]"><span dir="ltr">{formatPrice(product.price)}</span></td>
                      <td className="max-w-48 px-4 py-4 text-sm text-[var(--ui-muted)]">{categoryName(product)}</td>
                      <td className="min-w-56 px-4 py-4">
                        {(product.variants || []).length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs text-[var(--ui-muted)]">مجموع: {stockLabel(product)}</p>
                            <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border border-[var(--ui-border)] p-2">
                              {product.variants.map((variant) => {
                                const key = product._id + "::" + (variant.size || "") + "::" + (variant.color || "");
                                const option = [variant.size && "سایز " + variant.size, variant.color].filter(Boolean).join(" / ") || "پیش‌فرض";
                                return <div key={key} className="flex items-center justify-between gap-2">
                                  <span className="max-w-28 text-xs text-[var(--ui-muted)]">{option}</span>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <input type="number" min="0" step="1" aria-label={"موجودی " + product.name + " " + option} value={variantDrafts[key] ?? String(variant.stock)} onChange={(event) => setVariantDrafts((current) => ({ ...current, [key]: event.target.value }))} className="w-16 rounded-md border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-2 py-1.5 text-sm text-[var(--ui-text)]" />
                                    <button type="button" onClick={() => saveVariantStock(product, variant)} aria-label={"ذخیره موجودی " + option} className="rounded-md p-1.5 text-[var(--ui-accent)] hover:bg-[var(--ui-hover)]"><Save size={15} aria-hidden="true" /></button>
                                  </div>
                                </div>;
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-[var(--ui-muted)]">{stockLabel(product)}</p>
                            <div className="flex items-center gap-2">
                              <input type="number" min="0" step="1" aria-label={"موجودی " + product.name} value={stockDrafts[product._id] ?? (isStockTracked(product) ? String(product.stock) : "")} onChange={(event) => setStockDrafts((current) => ({ ...current, [product._id]: event.target.value }))} className="w-20 rounded-md border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-2 py-1.5 text-sm text-[var(--ui-text)]" />
                              <button type="button" onClick={() => saveStock(product)} aria-label={"ذخیره موجودی " + product.name} className="rounded-md p-1.5 text-[var(--ui-accent)] hover:bg-[var(--ui-hover)]"><Save size={16} aria-hidden="true" /></button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className={"inline-flex rounded-full px-2.5 py-1 text-xs font-semibold " + (product.isActive === false ? "bg-[var(--ui-surface-raised)] text-[var(--ui-muted)]" : "bg-emerald-900/40 text-[var(--ui-success)]")}>{product.isActive === false ? "بایگانی" : "منتشر"}</span>
                        <button type="button" disabled={product.isActive === false} onClick={() => toggleFeaturedProduct(product._id)} aria-label={product.isFeatured ? "حذف از محصولات منتخب" : "افزودن به محصولات منتخب"} className={"mt-2 inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--ui-border)] px-3 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-hover)] disabled:opacity-40"}>
                          <Star size={14} fill={product.isFeatured ? "currentColor" : "none"} aria-hidden="true" />{product.isFeatured ? "محصول منتخب" : "ویژه‌کردن"}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex flex-col items-stretch gap-2">
                          <button type="button" onClick={() => setEditingProduct(product)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] px-3 text-xs font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"><Pencil size={14} aria-hidden="true" />ویرایش</button>
                          <button type="button" onClick={() => toggleArchive(product)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[var(--ui-border)] px-3 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-hover)]">
                            {product.isActive === false ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
                            {product.isActive === false ? "بازیابی" : "بایگانی"}
                          </button>
                          {product.isActive === false && <button type="button" onClick={() => permanentlyDelete(product)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-red-900/70 px-3 text-xs text-[var(--ui-danger)] hover:bg-red-950/40"><Trash2 size={14} aria-hidden="true" />حذف دائمی</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ui-border)] px-4 py-3 text-sm text-[var(--ui-muted)]">
              <span>صفحه {numberFa(pagination.page || page)} از {numberFa(Math.max(1, pagination.totalPages || 1))}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="min-h-9 rounded-full border border-[var(--ui-border)] px-4 disabled:opacity-40">جدیدتر</button>
                <button type="button" disabled={page >= (pagination.totalPages || 1) || loading} onClick={() => setPage((value) => value + 1)} className="min-h-9 rounded-full border border-[var(--ui-border)] px-4 disabled:opacity-40">قدیمی‌تر</button>
              </div>
            </div>
          </>
        )}
      </div>
      {editingProduct && <ProductEditForm key={editingProduct._id} product={editingProduct} onClose={() => setEditingProduct(null)} onSaved={() => { setEditingProduct(null); reload(); }} />}
    </section>
  );
};

export default ProductsList;

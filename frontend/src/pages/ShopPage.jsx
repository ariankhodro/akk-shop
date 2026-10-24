import { useEffect, useState } from "react";
import PartFilters from "../components/PartFilters";
import { applyPartFilterPatch, readPartFilters } from "../lib/part-filter-params.js";
import { PART_QUALITY_LABELS } from "../lib/commerce";
import PageMeta from "../components/PageMeta";
import { hasIndexExcludedQuery } from "../lib/seo-utils.js";
import { Search, LoaderCircle, Wrench, Package, SlidersHorizontal, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "../lib/axios";
import ProductCard from "../components/ProductCard";
import { formatPrice } from "../lib/commerce";
import { useCategoryStore } from "../stores/useCategoryStore";

const sortLabels = {
  oldest: "قدیمی‌ترین",
  priceAsc: "ارزان‌ترین",
  priceDesc: "گران‌ترین",
  nameAsc: "نام قطعه (الف تا ی)",
};

const persianNumber = (value) =>
  new Intl.NumberFormat("fa-IR").format(Number(value) || 0);

const ShopPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { categories, fetchCategories } = useCategoryStore();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") || "");
  useEffect(() => setSearchDraft(searchParams.get("q") || ""), [searchParams]);
  const partFilters = readPartFilters(searchParams);
  const updatePartFilters = (patch) => setSearchParams(applyPartFilterPatch(searchParams, patch));
  const submitSearch = (event) => {
    event.preventDefault();
    setSearchParams(applyPartFilterPatch(searchParams, { q: searchDraft }));
  };
  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    axios
      .get(`/products/search?${searchParams.toString()}`)
      .then(({ data }) => {
        if (!active) return;
        setProducts(data.products || []);
        setPagination(
          data.pagination || { page: 1, total: 0, totalPages: 0 },
        );
      })
      .catch((requestError) => {
        if (!active) return;
        setProducts([]);
        setPagination({ page: 1, total: 0, totalPages: 0 });
        setError(
          requestError.response?.data?.message ||
            "دریافت قطعات ناموفق بود.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [searchParams]);

  const changePage = (page) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const query = searchParams.get("q")?.trim() || "";
  const category = searchParams.get("category") || "";
  const minPrice = searchParams.get("minPrice") || "";
  const maxPrice = searchParams.get("maxPrice") || "";
  const sort = searchParams.get("sort") || "newest";
  const activeFilters = [
    category ? { key: "category", label: "دسته‌بندی: " + (categories.find((item) => item.slug === category)?.name?.fa || category) } : null,
    partFilters.make ? { key: "make", label: "خودرو: " + [partFilters.make, partFilters.model, partFilters.year].filter(Boolean).join(" ") } : null,
    ...partFilters.quality.map((value) => ({ key: "quality", value, label: "کیفیت: " + (PART_QUALITY_LABELS[value] || value) })),
    ...partFilters.partBrand.map((value) => ({ key: "partBrand", value, label: "برند: " + value })),
    partFilters.inStock ? { key: "inStock", label: "فقط موجود" } : null,
    minPrice ? { key: "minPrice", label: `از ${formatPrice(minPrice)}` } : null,
    maxPrice ? { key: "maxPrice", label: `تا ${formatPrice(maxPrice)}` } : null,
    sort !== "newest" && sortLabels[sort]
      ? { key: "sort", label: `مرتب‌سازی: ${sortLabels[sort]}` }
      : null,
  ].filter(Boolean);

  const removeFilter = (key, value) => {
    if (value !== undefined) {
      setSearchParams(applyPartFilterPatch(searchParams, { [key]: searchParams.getAll(key).filter((item) => item !== value) }));
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    if (key === "make") { next.delete("model"); next.delete("year"); }
    next.delete("page");
    setSearchParams(next);
  };

  const clearAllFilters = () => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    setSearchParams(next);
  };

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-[#f5f6f8] px-3 py-7 text-[#1c1f24] sm:px-6 sm:py-10 lg:px-8"
    >
      <PageMeta title="فروشگاه قطعات یدکی خودروهای چینی" description="جست‌وجو با نام یا کد فنی، فیلتر بر اساس خودرو و خرید قطعات یدکی خودروهای چینی در میبا." path="/shop" type="collection" itemList={products} robots={hasIndexExcludedQuery(Object.fromEntries(searchParams.entries())) ? "noindex, follow" : "index, follow, max-image-preview:large"} />
      <div className="mx-auto max-w-[1920px]">
        <header className="mb-6 flex flex-col gap-4 border-b border-[#e2e5ea] pb-5 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
          <div className="min-w-0">
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#ea580c]">
              <Wrench size={15} aria-hidden="true" />
              فروشگاه قطعات
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {query ? "نتایج جست‌وجو" : partFilters.make ? "قطعات " + [partFilters.make, partFilters.model].filter(Boolean).join(" ") : "همه قطعات"}
              <span className="text-[#ea580c]">.</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6b717b]">
              {query ? (
                <>
                  نتیجه‌های مرتبط با{" "}
                  <span className="font-semibold text-[#33373e]">
                    «{query}»
                  </span>
                </>
              ) : (
                "نام قطعه یا کد فنی را جست‌وجو کنید، یا خودروی خود را انتخاب کنید تا فقط قطعات سازگار نمایش داده شوند."
              )}
            </p>
          </div>

          <div
            aria-live="polite"
            className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-full border border-[#e2e5ea] bg-[#ffffff] px-4 py-2 text-sm text-[#5a606a] sm:self-auto"
          >
            {loading ? (
              <>
                <LoaderCircle
                  size={16}
                  className="animate-spin text-[#ea580c]"
                  aria-hidden="true"
                />
                در حال جست‌وجو…
              </>
            ) : (
              <>
                <Package
                  size={16}
                  className="text-[#ea580c]"
                  aria-hidden="true"
                />
                {persianNumber(pagination.total)} قطعه
              </>
            )}
          </div>
        </header>

        <form role="search" onSubmit={submitSearch} className="mb-5 flex gap-2">
          <label htmlFor="shop-search" className="sr-only">جست‌وجوی نام یا کد فنی قطعه</label>
          <div className="relative min-w-0 flex-1">
            <Search size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" aria-hidden="true" />
            <input id="shop-search" type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="نام قطعه یا کد فنی (مثلاً T11-3501080)" className="min-h-12 w-full rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] pr-11 pl-4 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/25" />
          </div>
          <button type="submit" className="min-h-12 shrink-0 rounded-2xl bg-[var(--ui-accent)] px-5 text-sm font-bold text-white transition hover:bg-[var(--ui-accent-hover)]">جست‌وجو</button>
          <button type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="shop-filters" className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 text-sm font-semibold lg:hidden">
            <SlidersHorizontal size={16} aria-hidden="true" /><span className="hidden sm:inline">فیلترها</span>
          </button>
        </form>

        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside id="shop-filters" aria-label="فیلترهای قطعات" className={(filtersOpen ? "block" : "hidden") + " lg:block"}>
          <div className="space-y-4 lg:sticky lg:top-28">
            <label className="block rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-sm font-bold text-[var(--ui-text)]" htmlFor="shop-category">دسته‌بندی
              <select id="shop-category" value={category} onChange={(event) => setSearchParams(applyPartFilterPatch(searchParams, { category: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm font-normal">
                <option value="">همه دسته‌بندی‌ها</option>
                {categories.map((item) => <option key={item.slug} value={item.slug}>{item.name?.fa || item.slug}</option>)}
              </select>
            </label>
            <label className="block rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-sm font-bold text-[var(--ui-text)]" htmlFor="shop-sort">مرتب‌سازی
              <select id="shop-sort" value={sort} onChange={(event) => setSearchParams(applyPartFilterPatch(searchParams, { sort: event.target.value === "newest" ? "" : event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm font-normal">
                <option value="newest">جدیدترین</option>
                {Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <PartFilters values={partFilters} onChange={updatePartFilters} idPrefix="shop" compact />
          </div>
        </aside>
        <div className="min-w-0">

        {activeFilters.length > 0 && (
          <section aria-label="فیلترهای فعال" className="mb-6 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 pl-1 text-xs font-semibold text-[#5a606a]">
              <SlidersHorizontal size={15} className="text-[#ea580c]" aria-hidden="true" />
              فیلترهای فعال
              <span className="tabular-nums text-[#7d838d]">({persianNumber(activeFilters.length)})</span>
            </span>
            {activeFilters.map((filter) => (
              <button
                key={filter.key + (filter.value || "")}
                type="button"
                onClick={() => removeFilter(filter.key, filter.value)}
                aria-label={`حذف فیلتر ${filter.label}`}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#d2d6dc] bg-[#ffffff] px-3 py-1.5 text-xs font-medium text-[#33373e] transition hover:border-[#a8adb4] hover:bg-[#fff1e7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]"
              >
                <span>{filter.label}</span>
                <X size={13} className="text-[#7d838d]" aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex min-h-9 items-center rounded-full px-3 py-1.5 text-xs font-semibold text-[#ea580c] transition hover:bg-[#fff1e7] hover:text-[#33373e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]"
            >
              پاک‌کردن همه فیلترها
            </button>
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div
            className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-[#5a606a]"
            role="status"
          >
            <LoaderCircle
              size={26}
              className="animate-spin text-[#ea580c]"
              aria-hidden="true"
            />
            در حال جست‌وجوی قطعات…
          </div>
        ) : products.length ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        ) : (
          !error && (
            <section className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-[#d5d9df] bg-[#ffffff] px-5 py-12 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff1e7] text-[#ea580c]">
                <Search size={24} aria-hidden="true" />
              </div>
              <h2 className="text-2xl font-bold">
                قطعه‌ای پیدا نشد
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#6b717b]">
                کد فنی را بدون فاصله امتحان کنید یا فیلتر خودرو را تغییر دهید. اگر قطعه موردنظر را پیدا نکردید، با پشتیبانی میبا تماس بگیرید تا استعلام کنیم.
              </p>
              <Link
                to="/shop"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1c1f24] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#33373e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]"
              >
                نمایش همه قطعات
              </Link>
            </section>
          )
        )}

        {!loading && pagination.totalPages > 1 && (
          <nav
            aria-label="صفحه‌بندی قطعات"
            className="mt-8 flex items-center justify-center gap-3 border-t border-[#e2e5ea] pt-6"
          >
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => changePage(pagination.page - 1)}
              className="min-h-11 rounded-full border border-[#d2d6dc] bg-[#ffffff] px-4 text-sm font-medium transition hover:border-[#a8adb4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              قبلی
            </button>
            <span className="text-sm tabular-nums text-[#5a606a]">
              صفحه {persianNumber(pagination.page)} از{" "}
              {persianNumber(pagination.totalPages)}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => changePage(pagination.page + 1)}
              className="min-h-11 rounded-full border border-[#d2d6dc] bg-[#ffffff] px-4 text-sm font-medium transition hover:border-[#a8adb4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              بعدی
            </button>
          </nav>
        )}
        </div>
        </div>
      </div>
    </main>
  );
};

export default ShopPage;

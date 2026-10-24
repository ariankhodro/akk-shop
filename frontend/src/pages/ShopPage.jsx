import { useEffect, useState } from "react";
import PageMeta from "../components/PageMeta";
import { hasIndexExcludedQuery } from "../lib/seo-utils.js";
import { Search, LoaderCircle, Sparkles, ShoppingBag, SlidersHorizontal, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "../lib/axios";
import ProductCard from "../components/ProductCard";
import { formatPrice } from "../lib/commerce";
import { useCategoryStore } from "../stores/useCategoryStore";

const categoryLabels = {
  jeans: "شلوار جین",
  "t-shirts": "تی‌شرت",
  shoes: "کفش",
  glasses: "عینک",
  jackets: "کت و کاپشن",
  suits: "کت‌وشلوار",
  bags: "کیف",
};

const sortLabels = {
  oldest: "قدیمی‌ترین",
  priceAsc: "ارزان‌ترین",
  priceDesc: "گران‌ترین",
  nameAsc: "نام محصول (الف تا ی)",
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
            "دریافت محصولات ناموفق بود.",
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
    category ? { key: "category", label: "دسته‌بندی: " + (categories.find((item) => item.slug === category)?.name?.fa || categoryLabels[category] || category) } : null,
    minPrice ? { key: "minPrice", label: `از ${formatPrice(minPrice)}` } : null,
    maxPrice ? { key: "maxPrice", label: `تا ${formatPrice(maxPrice)}` } : null,
    sort !== "newest" && sortLabels[sort]
      ? { key: "sort", label: `مرتب‌سازی: ${sortLabels[sort]}` }
      : null,
  ].filter(Boolean);

  const removeFilter = (key) => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
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
      className="min-h-screen bg-[#f7f5f0] px-3 py-7 text-[#252722] sm:px-6 sm:py-10 lg:px-8"
    >
      <PageMeta title="فروشگاه پوشاک و اکسسوری" description="جست‌وجو، فیلتر و خرید محصولات فروشگاه تیک بوتیک." path="/shop" type="collection" itemList={products} robots={hasIndexExcludedQuery(Object.fromEntries(searchParams.entries())) ? "noindex, follow" : "index, follow, max-image-preview:large"} />
      <div className="mx-auto max-w-[1920px]">
        <header className="mb-6 flex flex-col gap-4 border-b border-[#e4e0d8] pb-5 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
          <div className="min-w-0">
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#68745f]">
              <Sparkles size={15} aria-hidden="true" />
              مجموعه فروشگاه
            </p>
            <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
              {query ? "نتایج جست‌وجو" : "محصولات منتخب"}
              <span className="text-[#68745f]">.</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77786f]">
              {query ? (
                <>
                  نتیجه‌های مرتبط با{" "}
                  <span className="font-semibold text-[#41443b]">
                    «{query}»
                  </span>
                </>
              ) : (
                "محصول موردنظرتان را با جست‌وجو و فیلترهای نوار بالای صفحه پیدا کنید."
              )}
            </p>
          </div>

          <div
            aria-live="polite"
            className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-full border border-[#e4e0d8] bg-[#fffefa] px-4 py-2 text-sm text-[#62645c] sm:self-auto"
          >
            {loading ? (
              <>
                <LoaderCircle
                  size={16}
                  className="animate-spin text-[#68745f]"
                  aria-hidden="true"
                />
                در حال جست‌وجو…
              </>
            ) : (
              <>
                <ShoppingBag
                  size={16}
                  className="text-[#68745f]"
                  aria-hidden="true"
                />
                {persianNumber(pagination.total)} محصول
              </>
            )}
          </div>
        </header>

        {activeFilters.length > 0 && (
          <section aria-label="فیلترهای فعال" className="mb-6 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 pl-1 text-xs font-semibold text-[#62645c]">
              <SlidersHorizontal size={15} className="text-[#68745f]" aria-hidden="true" />
              فیلترهای فعال
              <span className="tabular-nums text-[#85867d]">({persianNumber(activeFilters.length)})</span>
            </span>
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => removeFilter(filter.key)}
                aria-label={`حذف فیلتر ${filter.label}`}
                className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#d5d0c5] bg-[#fffefa] px-3 py-1.5 text-xs font-medium text-[#41443b] transition hover:border-[#a8a597] hover:bg-[#e9ede4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]"
              >
                <span>{filter.label}</span>
                <X size={13} className="text-[#85867d]" aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex min-h-9 items-center rounded-full px-3 py-1.5 text-xs font-semibold text-[#68745f] transition hover:bg-[#e9ede4] hover:text-[#41443b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]"
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
            className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-[#62645c]"
            role="status"
          >
            <LoaderCircle
              size={26}
              className="animate-spin text-[#68745f]"
              aria-hidden="true"
            />
            در حال آماده‌سازی محصولات…
          </div>
        ) : products.length ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
        ) : (
          !error && (
            <section className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-[#d8d4c9] bg-[#fffefa] px-5 py-12 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e9ede4] text-[#68745f]">
                <Search size={24} aria-hidden="true" />
              </div>
              <h2 className="font-serif text-2xl font-medium">
                محصولی پیدا نشد
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#77786f]">
                عبارت جست‌وجو یا فیلترها را تغییر دهید تا نتیجه‌های بیشتری ببینید.
              </p>
              <Link
                to="/shop"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#252722] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#41443b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]"
              >
                نمایش همه محصولات
              </Link>
            </section>
          )
        )}

        {!loading && pagination.totalPages > 1 && (
          <nav
            aria-label="صفحه‌بندی محصولات"
            className="mt-8 flex items-center justify-center gap-3 border-t border-[#e4e0d8] pt-6"
          >
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => changePage(pagination.page - 1)}
              className="min-h-11 rounded-full border border-[#d5d0c5] bg-[#fffefa] px-4 text-sm font-medium transition hover:border-[#a8a597] disabled:cursor-not-allowed disabled:opacity-40"
            >
              قبلی
            </button>
            <span className="text-sm tabular-nums text-[#62645c]">
              صفحه {persianNumber(pagination.page)} از{" "}
              {persianNumber(pagination.totalPages)}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => changePage(pagination.page + 1)}
              className="min-h-11 rounded-full border border-[#d5d0c5] bg-[#fffefa] px-4 text-sm font-medium transition hover:border-[#a8a597] disabled:cursor-not-allowed disabled:opacity-40"
            >
              بعدی
            </button>
          </nav>
        )}
      </div>
    </main>
  );
};

export default ShopPage;

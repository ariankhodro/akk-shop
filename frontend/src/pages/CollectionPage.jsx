import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, LoaderCircle, PackageSearch, RefreshCw } from "lucide-react";
import axios from "../lib/axios";
import ProductCard from "../components/ProductCard";
import PageMeta from "../components/PageMeta";

const modes = {
  newest: {
    title: "تازه‌واردها",
    description: "جدیدترین قطعات یدکی اضافه‌شده به میبا برای خودروهای چینی.",
    load: async () => (await axios.get("/products/newest?limit=24")).data.products || [],
  },
  bestsellers: {
    title: "پرفروش‌های فروشگاه",
    description: "قطعاتی که بر اساس سفارش‌های پرداخت‌شده بیشترین فروش را داشته‌اند.",
    load: async () => (await axios.get("/products/bestsellers?limit=24")).data.products || [],
  },
  featured: {
    title: "قطعات منتخب",
    description: "قطعات پرکاربرد و منتخب کارشناسان میبا.",
    load: async () => {
      const { data } = await axios.get("/products/featured");
      return Array.isArray(data) ? data : [];
    },
  },
};

const CollectionPage = ({ type = "newest" }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const config = modes[type];

  const loadCollection = useCallback(async () => {
    if (!config) {
      setLoading(false);
      setError("این مجموعه پیدا نشد.");
      setProducts([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const loaded = await config.load?.();
      const unique = (loaded || []).filter((product, index, all) =>
        product?._id && product.isActive !== false && all.findIndex((item) => item?._id === product._id) === index
      );
      setProducts(unique);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "بارگذاری قطعات این مجموعه ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    loadCollection();
  }, [loadCollection]);

  const collectionPath = type === "newest" ? "/new-arrivals" : type === "bestsellers" ? "/bestsellers" : "/featured-products";
  return (
    <main dir="rtl" className="min-h-[65vh] bg-[#f5f6f8] px-3 py-8 text-[#1c1f24] sm:px-6 sm:py-12 lg:px-8">
      <PageMeta title={config?.title || "مجموعه پیدا نشد"} description={config?.description || "این مجموعه در میبا در دسترس نیست."} path={collectionPath} type="collection" itemList={products} robots={config ? "index, follow, max-image-preview:large" : "noindex, nofollow"} canonical={Boolean(config)} breadcrumbs={config ? [{ name: "صفحه اصلی", path: "/" }, { name: "فروشگاه", path: "/shop" }, { name: config.title, path: collectionPath }] : []} />
      <div className="mx-auto max-w-[1920px]">
        <nav aria-label="مسیر صفحه" className="mb-5 flex items-center gap-2 text-xs text-[#6b717b]">
          <Link to="/" className="hover:text-[#ea580c]">صفحه اصلی</Link><span aria-hidden="true">/</span><Link to="/shop" className="hover:text-[#ea580c]">فروشگاه</Link><span aria-hidden="true">/</span><span className="font-semibold text-[#33373e]">{config?.title || "مجموعه"}</span>
        </nav>
        {(
          <header className="mb-8 border-b border-[#e2e5ea] pb-5">
            <p className="text-xs font-semibold tracking-wide text-[#ea580c]">مجموعه میبا</p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{config?.title || "مجموعه"}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#5a606a]">{config?.description}</p>
          </header>
        )}
        {loading ? (
          <div role="status" className="flex min-h-52 items-center justify-center gap-3 text-sm text-[#5a606a]"><LoaderCircle size={22} className="animate-spin text-[#ea580c]" aria-hidden="true" />در حال بارگذاری قطعات…</div>
        ) : error ? (
          <section role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            {error}<button type="button" onClick={loadCollection} className="mr-3 inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={14} aria-hidden="true" />تلاش دوباره</button>
          </section>
        ) : products.length ? (
          <>
            <p className="mb-4 text-xs text-[#6b717b]">{new Intl.NumberFormat("fa-IR").format(products.length)} قطعه</p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => <ProductCard key={product._id} product={product} />)}
            </div>
          </>
        ) : (
          <section className="rounded-2xl border border-dashed border-[#d2d6dc] bg-[#ffffff] px-5 py-10 text-center">
            <PackageSearch size={29} className="mx-auto text-[#ea580c]" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">قطعه‌ای برای نمایش در این مجموعه وجود ندارد.</h2>
            <p className="mt-2 text-sm leading-6 text-[#6b717b]">بعداً دوباره سر بزنید یا سایر قطعات فروشگاه را ببینید.</p>
            <Link to="/shop" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-[#1c1f24] px-5 py-2 text-sm font-semibold text-white">مشاهده همه قطعات<ArrowLeft size={15} aria-hidden="true" /></Link>
          </section>
        )}
      </div>
    </main>
  );
};

export default CollectionPage;

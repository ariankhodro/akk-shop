import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, LoaderCircle, PackageSearch, RefreshCw } from "lucide-react";
import axios from "../lib/axios";
import ProductCard from "../components/ProductCard";
import PageMeta from "../components/PageMeta";

const looks = {
  "daily-style": {
    title: "استایل روزمره",
    description: "پایه‌های راحت برای ترکیب روزانه؛ از شلوار جین تا تی‌شرت و کفش.",
    image: "/jeans.jpg",
    categories: ["jeans", "t-shirts", "shoes"],
  },
  layers: {
    title: "لایه‌های ماندگار",
    description: "ترکیب کت و شلوار برای روزهای خنک و انتخاب‌های چندفصلی.",
    image: "/jackets.jpg",
    categories: ["jackets", "jeans", "t-shirts"],
  },
  details: {
    title: "جزئیات تکمیل‌کننده",
    description: "اکسسوری‌ها و انتخاب‌های ساده برای کامل‌کردن ظاهر.",
    image: "/bags.jpg",
    categories: ["bags", "glasses", "shoes"],
  },
};

const modes = {
  newest: {
    title: "تازه‌واردها",
    description: "جدیدترین محصولات اضافه‌شده به تیک بوتیک، در یک صفحه مستقل.",
    load: async () => (await axios.get("/products/newest?limit=24")).data.products || [],
  },
  bestsellers: {
    title: "پرفروش‌های فروشگاه",
    description: "محصولاتی که بر اساس سفارش‌های پرداخت‌شده بیشتر خریداری شده‌اند.",
    load: async () => (await axios.get("/products/bestsellers?limit=24")).data.products || [],
  },
  featured: {
    title: "محصولات منتخب",
    description: "مجموعه گزیده‌ای از محصولاتی که برای دیدن بیشتر انتخاب شده‌اند.",
    load: async () => {
      const { data } = await axios.get("/products/featured");
      return Array.isArray(data) ? data : [];
    },
  },
};

const CollectionPage = ({ type = "newest" }) => {
  const { slug } = useParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const look = type === "look" ? looks[slug] : null;
  const config = type === "look" ? look : modes[type];

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
      let loaded = await config.load?.();
      if (type === "look") {
        const groups = await Promise.all(config.categories.map((category) => axios.get("/products/category/" + encodeURIComponent(category))));
        loaded = groups.flatMap((response) => Array.isArray(response.data.products) ? response.data.products : []);
      }
      const unique = (loaded || []).filter((product, index, all) =>
        product?._id && product.isActive !== false && all.findIndex((item) => item?._id === product._id) === index
      );
      setProducts(unique);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "بارگذاری محصولات این مجموعه ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, [config, type]);

  useEffect(() => {
    loadCollection();
  }, [loadCollection]);

  return (
    <main dir="rtl" className="min-h-[65vh] bg-[#f7f5f0] px-3 py-8 text-[#252722] sm:px-6 sm:py-12 lg:px-8">
      <PageMeta title={config?.title || "مجموعه پیدا نشد"} description={config?.description || "این مجموعه در تیک بوتیک در دسترس نیست."} image={config?.image} path={type === "look" ? "/looks/" + encodeURIComponent(slug || "") : type === "newest" ? "/new-arrivals" : type === "bestsellers" ? "/bestsellers" : "/featured-products"} type="collection" itemList={products} robots={config ? "index, follow, max-image-preview:large" : "noindex, nofollow"} canonical={Boolean(config)} breadcrumbs={config ? [{ name: "صفحه اصلی", path: "/" }, { name: "فروشگاه", path: "/shop" }, { name: config.title, path: type === "look" ? "/looks/" + encodeURIComponent(slug || "") : type === "newest" ? "/new-arrivals" : type === "bestsellers" ? "/bestsellers" : "/featured-products" }] : []} />
      <div className="mx-auto max-w-[1920px]">
        <nav aria-label="مسیر صفحه" className="mb-5 flex items-center gap-2 text-xs text-[#77786f]">
          <Link to="/" className="hover:text-[#68745f]">صفحه اصلی</Link><span aria-hidden="true">/</span><Link to="/shop" className="hover:text-[#68745f]">فروشگاه</Link><span aria-hidden="true">/</span><span className="font-semibold text-[#41443b]">{config?.title || "مجموعه"}</span>
        </nav>
        {config?.image && type === "look" && (
          <section className="relative mb-8 flex min-h-56 items-end overflow-hidden rounded-3xl bg-[#e9e5dc] p-6 sm:min-h-80 sm:p-10">
            <img src={config.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
            <div className="relative max-w-2xl text-white">
              <p className="text-xs font-semibold">انتخاب‌های هماهنگ</p>
              <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{config.title}</h1>
              <p className="mt-3 text-sm leading-7 text-white/85">{config.description}</p>
            </div>
          </section>
        )}
        {type !== "look" && (
          <header className="mb-8 border-b border-[#e4e0d8] pb-5">
            <p className="text-xs font-semibold tracking-wide text-[#68745f]">مجموعه تیک بوتیک</p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{config?.title || "مجموعه"}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#62645c]">{config?.description}</p>
          </header>
        )}
        {type === "look" && !config && <h1 className="mb-6 text-2xl font-bold">این مجموعه پیدا نشد.</h1>}
        {loading ? (
          <div role="status" className="flex min-h-52 items-center justify-center gap-3 text-sm text-[#62645c]"><LoaderCircle size={22} className="animate-spin text-[#68745f]" aria-hidden="true" />در حال بارگذاری محصولات…</div>
        ) : error ? (
          <section role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            {error}<button type="button" onClick={loadCollection} className="mr-3 inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={14} aria-hidden="true" />تلاش دوباره</button>
          </section>
        ) : products.length ? (
          <>
            <p className="mb-4 text-xs text-[#77786f]">{new Intl.NumberFormat("fa-IR").format(products.length)} محصول</p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => <ProductCard key={product._id} product={product} />)}
            </div>
          </>
        ) : (
          <section className="rounded-2xl border border-dashed border-[#d5d0c5] bg-[#fffefa] px-5 py-10 text-center">
            <PackageSearch size={29} className="mx-auto text-[#68745f]" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">محصولی برای نمایش در این مجموعه وجود ندارد.</h2>
            <p className="mt-2 text-sm leading-6 text-[#77786f]">بعداً دوباره سر بزنید یا سایر محصولات فروشگاه را ببینید.</p>
            <Link to="/shop" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-[#252722] px-5 py-2 text-sm font-semibold text-white">مشاهده همه محصولات<ArrowLeft size={15} aria-hidden="true" /></Link>
          </section>
        )}
      </div>
    </main>
  );
};

export default CollectionPage;

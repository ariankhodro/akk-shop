import { useEffect, useState } from "react";
import PageMeta from "../components/PageMeta";
import { ArrowLeft, BadgeCheck, Building2, Headphones, PackageCheck, RotateCcw, Search, ShieldCheck, Sparkles, Truck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import axios from "../lib/axios";
import CategoryItem from "../components/CategoryItem";
import ProductCard from "../components/ProductCard";
import { useProductStore } from "../stores/useProductStore";
import FeaturedProducts from "../components/FeaturedProducts";
import { useCategoryStore } from "../stores/useCategoryStore";
import { getCampaignPath } from "../lib/campaign-url";
import { useUserStore } from "../stores/useUserStore";
import FitmentFinder from "../components/home/FitmentFinder";

// Shown until the category API responds (matches scripts/seed-miba.mjs).
const legacyCategoryCards = [
  { href: "/category/engine", name: "قطعات موتوری", imageUrl: "/categories/engine.svg" },
  { href: "/category/brakes", name: "سیستم ترمز", imageUrl: "/categories/brakes.svg" },
  { href: "/category/suspension", name: "جلوبندی و تعلیق", imageUrl: "/categories/suspension.svg" },
  { href: "/category/filters", name: "فیلترها", imageUrl: "/categories/filters.svg" },
  { href: "/category/electrical", name: "برق و الکترونیک", imageUrl: "/categories/electrical.svg" },
  { href: "/category/body", name: "بدنه و تزئینات", imageUrl: "/categories/body.svg" },
  { href: "/category/transmission", name: "گیربکس و کلاچ", imageUrl: "/categories/transmission.svg" },
  { href: "/category/cooling", name: "سیستم خنک‌کاری", imageUrl: "/categories/cooling.svg" },
];

const trustBadges = [
  { icon: BadgeCheck, title: "اصالت کالا", text: "قطعات اصلی، OEM و تجاری با برچسب کیفیت شفاف." },
  { icon: RotateCcw, title: "ضمانت بازگشت", text: "بازگشت قطعه نصب‌نشده طبق شرایط مرجوعی." },
  { icon: Truck, title: "ارسال سریع", text: "ارسال به سراسر ایران با کد رهگیری مرسوله." },
  { icon: ShieldCheck, title: "پرداخت امن زرین‌پال", text: "پرداخت مستقیم در درگاه رسمی زرین‌پال." },
];

const benefits = [
  { icon: Truck, title: "ارسال و تحویل", text: "هزینه ارسال و شرط ارسال رایگان را پیش از پرداخت ببینید.", href: "/shipping-policy" },
  { icon: PackageCheck, title: "مرجوعی و گارانتی", text: "شرایط بازگشت و گارانتی قطعات را پیش از خرید بخوانید.", href: "/returns-policy" },
  { icon: Headphones, title: "مشاوره انتخاب قطعه", text: "با کد فنی یا شماره شاسی (VIN) قطعه درست را پیدا کنید.", href: "/support" },
];

const HomePage = () => {
  const navigate = useNavigate();
  const user = useUserStore((state) => state.user);
  const isWholesale = user?.accountType === "wholesale";
  const [partQuery, setPartQuery] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [bestsellers, setBestsellers] = useState([]);
  const [bestsellersLoaded, setBestsellersLoaded] = useState(false);
  const [bestsellersError, setBestsellersError] = useState(false);
  const [newestLoaded, setNewestLoaded] = useState(false);
  const [newestError, setNewestError] = useState(false);
  const { categories: storeCategories, fetchCategories } = useCategoryStore();
  const categories = storeCategories.length
    ? storeCategories
        .filter((category) => !category.parentId && category.showInNavigation !== false)
        .map((category) => ({
          href: "/category/" + category.slug,
          name: category.name?.fa || category.name?.en || category.slug,
          imageUrl: category.image || "/categories/" + category.slug + ".svg",
        }))
    : legacyCategoryCards;
  const {
    fetchFeaturedProducts,
    featuredProducts,
    fetchNewestProducts,
    newestProducts,
  } = useProductStore();

  useEffect(() => {
    let active = true;
    fetchFeaturedProducts();
    fetchCategories();
    Promise.resolve(fetchNewestProducts())
      .then((succeeded) => { if (active) setNewestError(succeeded === false); })
      .finally(() => { if (active) setNewestLoaded(true); });
    axios.get("/campaigns")
      .then(({ data }) => { if (active) setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []); })
      .catch((error) => console.error("Could not load campaigns:", error.message));
    axios.get("/products/bestsellers?limit=8")
      .then(({ data }) => {
        if (!active) return;
        setBestsellers(Array.isArray(data.products) ? data.products : []);
        setBestsellersError(false);
      })
      .catch((error) => {
        if (!active) return;
        setBestsellersError(true);
        console.error("Could not load bestsellers:", error.message);
      })
      .finally(() => { if (active) setBestsellersLoaded(true); });
    return () => { active = false; };
  }, [fetchFeaturedProducts, fetchNewestProducts, fetchCategories]);

  // Campaigns are already time-filtered by the API. Only promote one in the hero
  // when its image and local destination are both ready to use.
  const heroCampaign = campaigns.find((campaign) => {
    const hasTitle = typeof campaign?.title === "string" && campaign.title.trim();
    const hasImage = typeof campaign?.image === "string" && campaign.image.trim();
    const href = campaign?.href;
    return hasTitle && hasImage && typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
  });
  const secondaryCampaigns = campaigns.filter(
    (campaign) => !heroCampaign || campaign._id !== heroCampaign._id
  );

  const retryBestsellers = async () => {
    setBestsellersLoaded(false);
    setBestsellersError(false);
    try {
      const { data } = await axios.get("/products/bestsellers?limit=8");
      setBestsellers(Array.isArray(data.products) ? data.products : []);
    } catch (error) {
      setBestsellersError(true);
      console.error("Could not retry bestsellers:", error.message);
    } finally {
      setBestsellersLoaded(true);
    }
  };

  const retryNewest = async () => {
    setNewestLoaded(false);
    setNewestError(false);
    try {
      const succeeded = await fetchNewestProducts();
      setNewestError(succeeded === false);
    } catch {
      setNewestError(true);
    } finally {
      setNewestLoaded(true);
    }
  };

  const submitPartSearch = (event) => {
    event.preventDefault();
    const query = partQuery.trim();
    if (query) navigate("/shop?q=" + encodeURIComponent(query.slice(0, 80)));
  };

  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-[#f5f6f8] text-[#1c1f24]">
      <PageMeta title="فروشگاه تخصصی قطعات یدکی خودروهای چینی" description="خرید آنلاین قطعات یدکی اصلی و OEM خودروهای چینی چری، ام‌وی‌ام، جک، هاوال، جیلی و بی‌وای‌دی با جستجوی کد فنی و فروش عمده به همکاران." path="/" />
      <div className="mx-auto max-w-[1920px] px-3 pb-12 pt-4 sm:px-6 sm:pb-16 sm:pt-8 lg:px-8 2xl:px-12">
        <section className="relative isolate overflow-hidden rounded-2xl border border-[#e2e5ea] bg-[#1c1f24] text-white">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_20%,rgba(234,88,12,.45),transparent_45%),radial-gradient(circle_at_85%_80%,rgba(251,146,60,.25),transparent_40%)]" />
          {heroCampaign && <img src={heroCampaign.image} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-30" fetchPriority="high" />}
          <div className="grid grid-cols-1 gap-8 px-5 py-9 sm:px-10 sm:py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-12 lg:py-16 xl:px-14">
            <div className="min-w-0">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-orange-200 sm:text-xs">
                <Sparkles size={15} aria-hidden="true" />
                {heroCampaign ? "پیشنهاد ویژه میبا" : "فروشگاه تخصصی قطعات یدکی خودروهای چینی"}
              </p>
              <h1 className="max-w-2xl text-3xl font-extrabold leading-[1.25] tracking-tight sm:text-5xl sm:leading-[1.2]">
                {heroCampaign ? heroCampaign.title : (
                  <>قطعه درست، <span className="text-[#fb923c]">برای خودروی چینی شما</span></>
                )}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-white/80 sm:mt-5 sm:text-lg sm:leading-8">
                {heroCampaign
                  ? heroCampaign.description || "این پیشنهاد را ببینید و قطعات مرتبط را انتخاب کنید."
                  : "قطعات اصلی، OEM و تجاری چری، ام‌وی‌ام، جک، هاوال، جیلی، بی‌وای‌دی، لیفان و دیگر برندها؛ با جستجوی کد فنی، ارسال سریع به سراسر کشور و قیمت ویژه برای همکاران عمده."}
              </p>
              <form onSubmit={submitPartSearch} role="search" aria-label="جستجوی کد فنی یا نام قطعه" className="mt-6 flex max-w-xl flex-col gap-2 sm:mt-8 sm:flex-row">
                <label htmlFor="home-part-search" className="sr-only">نام قطعه، کد فنی یا خودرو</label>
                <input id="home-part-search" type="search" value={partQuery} onChange={(event) => setPartQuery(event.target.value)} maxLength={80} placeholder="نام قطعه، کد فنی یا خودرو…" className="min-h-12 flex-1 rounded-xl border border-white/20 bg-white px-4 text-sm text-[#1c1f24] outline-none placeholder:text-[#6b717b] focus:ring-2 focus:ring-[#fb923c]" />
                <button type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#ea580c] px-6 text-sm font-bold text-white transition hover:bg-[#c2410c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  <Search size={17} aria-hidden="true" />جستجو
                </button>
              </form>
              <div className="mt-5 flex flex-wrap gap-2 sm:gap-3">
                {heroCampaign ? (
                  <Link to={getCampaignPath(heroCampaign)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#1c1f24] transition hover:bg-orange-50">مشاهده پیشنهاد<ArrowLeft size={16} aria-hidden="true" /></Link>
                ) : (
                  <Link to="/shop" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#1c1f24] transition hover:bg-orange-50">همه قطعات<ArrowLeft size={16} aria-hidden="true" /></Link>
                )}
                <a href="#shop-by-category" className="inline-flex min-h-11 items-center rounded-full border border-white/30 px-5 text-sm font-semibold text-white transition hover:border-white">دسته‌بندی قطعات</a>
                {isWholesale ? (
                  <Link to="/wholesale/quick-order" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/30 px-5 text-sm font-semibold text-white transition hover:border-white"><Building2 size={16} aria-hidden="true" />سفارش سریع عمده</Link>
                ) : (
                  <a href="#wholesale" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/30 px-5 text-sm font-semibold text-white transition hover:border-white"><Building2 size={16} aria-hidden="true" />همکاری عمده</a>
                )}
              </div>
            </div>
            <div className="min-w-0 text-[var(--ui-text)]">
              <FitmentFinder />
            </div>
          </div>
        </section>

        <section aria-label="مزیت‌های خرید از میبا" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {trustBadges.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3 rounded-2xl border border-[#e2e5ea] bg-[#ffffff] p-4">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff1e7] text-[#ea580c]"><Icon size={20} aria-hidden="true" /></span>
              <div className="min-w-0"><h2 className="text-sm font-bold text-[#1c1f24]">{title}</h2><p className="mt-1 hidden text-xs leading-5 text-[#6b717b] sm:block">{text}</p></div>
            </div>
          ))}
        </section>

        <section id="shop-by-category" className="scroll-mt-28 pt-12 sm:pt-16 lg:pt-20">
          <div className="mb-5 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ea580c] sm:mb-2 sm:text-xs sm:tracking-[0.2em]">کاتالوگ قطعات</p>
              <h2 className="font-serif text-2xl font-medium tracking-tight text-[#1c1f24] sm:text-4xl">خرید بر اساس گروه قطعه</h2>
              <p className="mt-2 max-w-md text-xs leading-5 text-[#5a606a] sm:text-sm sm:leading-6">از قطعات موتوری تا برق، بدنه و جلوبندی؛ گروه موردنظر را انتخاب کنید.</p>
            </div>
          </div>
          <div
            aria-label="دسته‌بندی‌های فروشگاه"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5"
          >
            {categories.map((category) => (
              <CategoryItem key={category.name} category={category} />
            ))}
          </div>
        </section>

        {secondaryCampaigns.length > 0 && (
<section id="special-offers" aria-labelledby="campaigns-heading" className="pt-9 sm:pt-12">
            <div className="mb-5 flex items-end justify-between gap-3 sm:mb-6 sm:gap-4">
              <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ea580c] sm:mb-2 sm:text-xs sm:tracking-[0.2em]">ویژه و محدود</p><h2 id="campaigns-heading" className="font-serif text-2xl font-medium sm:text-3xl">پیشنهادهای ویژه</h2></div>
              <Link to="/campaigns" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-[#d2d6dc] px-3 text-xs font-semibold text-[#ea580c] transition hover:border-[#1c1f24] hover:text-[#1c1f24] sm:border-0 sm:px-0 sm:text-sm">همه پیشنهادها<ArrowLeft size={15} aria-hidden="true" /></Link>
            </div>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-3 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4">
              {secondaryCampaigns.map((campaign) => (
                <Link to={getCampaignPath(campaign)} key={campaign._id} className="group relative isolate flex min-h-[210px] min-w-[88%] snap-center overflow-hidden rounded-2xl border border-[#e2e5ea] bg-[#eceef2] p-5 transition hover:border-[#c3c8cf] sm:min-h-[230px] sm:min-w-[48%] sm:p-6 xl:min-w-[32%]">
                  {campaign.image && <img src={campaign.image} alt="" loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />}
                  <div className="absolute inset-0 -z-10 bg-gradient-to-l from-[#1c1f24]/85 via-[#1c1f24]/55 to-transparent" />
                  <div className="my-auto max-w-[80%] text-white">
                    <p className="text-xs font-semibold tracking-[0.16em] text-white/75">پیشنهاد ویژه</p>
                    <h3 className="mt-3 font-serif text-2xl font-medium">{campaign.title}</h3>
                    {campaign.description && <p className="mt-2 text-sm leading-6 text-white/85">{campaign.description}</p>}
                    <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold">مشاهده پیشنهاد<ArrowLeft size={16} aria-hidden="true" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {bestsellersLoaded && (bestsellers.length > 0 || bestsellersError) && (
          <section className="pt-12 sm:pt-16 lg:pt-20" aria-labelledby="bestsellers-heading">
            <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div>
                <p className="mb-1.5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ea580c] sm:mb-2 sm:text-xs sm:tracking-[0.2em]"><Sparkles size={14} aria-hidden="true" />محبوب بر اساس سفارش‌های تکمیل‌شده</p>
                <h2 id="bestsellers-heading" className="font-serif text-2xl font-medium tracking-tight sm:text-4xl">پرفروش‌ترین قطعات</h2>
                <p className="mt-2 text-xs leading-5 text-[#5a606a] sm:text-sm sm:leading-6">بر اساس تعداد کالا در سفارش‌هایی که پرداختشان تأیید شده است.</p>
              </div>
              <Link to="/bestsellers" className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-full border border-[#d2d6dc] px-4 py-2 text-xs font-semibold text-[#1c1f24] transition hover:border-[#1c1f24] sm:self-auto sm:text-sm">
                مشاهده همه پرفروش‌ها<ArrowLeft size={15} aria-hidden="true" />
              </Link>
            </div>
            {bestsellersError ? (
              <div role="alert" className="rounded-2xl border border-[#e2e5ea] bg-[#ffffff] px-5 py-8 text-center sm:py-10">
                <p className="text-sm font-semibold text-[#33373e]">پرفروش‌ها بارگذاری نشدند.</p>
                <p className="mt-1 text-xs leading-5 text-[#6b717b]">اتصال را بررسی کنید و دوباره تلاش کنید.</p>
                <button type="button" onClick={retryBestsellers} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#1c1f24] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#33373e]">تلاش دوباره</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {bestsellers.slice(0, 8).map((product) => <ProductCard key={product._id} product={product} />)}
              </div>
            )}
          </section>
        )}

        <section className="pt-12 sm:pt-16 lg:pt-20" aria-labelledby="newest-products-heading">
          <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="mb-1.5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ea580c] sm:mb-2 sm:text-xs sm:tracking-[0.2em]">
                <Sparkles size={14} aria-hidden="true" />
                تازه به انبار میبا اضافه شده
              </p>
              <h2 id="newest-products-heading" className="font-serif text-2xl font-medium tracking-tight sm:text-4xl">تازه‌ترین قطعات</h2>
              <p className="mt-2 text-xs leading-5 text-[#5a606a] sm:text-sm sm:leading-6">قطعات جدید را با کشیدن به چپ و راست مرور کنید.</p>
            </div>
            <Link to="/new-arrivals" className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-full border border-[#d2d6dc] px-4 py-2 text-xs font-semibold text-[#1c1f24] transition hover:border-[#1c1f24] sm:self-auto sm:text-sm">
              مشاهده همه
              <ArrowLeft size={15} aria-hidden="true" />
            </Link>
          </div>

          {!newestLoaded ? (
            <div aria-label="در حال بارگذاری قطعات تازه" className="flex gap-3 overflow-hidden sm:gap-4">
              {[0, 1, 2].map((item) => (
                <div key={item} className="min-w-[68%] shrink-0 animate-pulse overflow-hidden rounded-2xl border border-[#e2e5ea] bg-white sm:min-w-[36%] lg:min-w-[24%]">
                  <div className="aspect-[4/5] bg-[#eceef2]" />
                  <div className="space-y-3 p-4">
                    <div className="h-4 w-3/4 rounded-full bg-[#eceef2]" />
                    <div className="h-4 w-1/2 rounded-full bg-[#eceef2]" />
                    <div className="h-10 rounded-full bg-[#eceef2]" />
                  </div>
                </div>
              ))}
            </div>
          ) : newestError ? (
            <div role="alert" className="rounded-2xl border border-[#e2e5ea] bg-[#ffffff] px-5 py-8 text-center sm:py-10">
              <PackageCheck size={24} className="mx-auto text-[#ea580c]" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-[#33373e]">قطعات تازه بارگذاری نشدند.</p>
              <p className="mt-1 text-xs leading-5 text-[#6b717b]">برای دریافت تازه‌ترین قطعات دوباره تلاش کنید.</p>
              <button type="button" onClick={retryNewest} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#1c1f24] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#33373e]">تلاش دوباره</button>
            </div>
          ) : newestProducts.length > 0 ? (
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-3 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4">
              {newestProducts.slice(0, 8).map((product) => (
                <div key={product._id} className="w-[min(68%,17rem)] min-w-0 shrink-0 snap-start sm:w-[min(36%,18rem)] lg:w-[min(24%,19rem)]">
                  <ProductCard product={product} />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#e2e5ea] bg-[#ffffff] px-5 py-8 text-center sm:py-10">
              <PackageCheck size={24} className="mx-auto text-[#ea580c]" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-[#33373e]">قطعه تازه‌ای برای نمایش نیست.</p>
              <p className="mt-1 text-xs text-[#6b717b]">بعداً دوباره سر بزنید یا کاتالوگ قطعات را ببینید.</p>
              <Link to="/shop" className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#1c1f24] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#33373e]">رفتن به فروشگاه</Link>
            </div>
          )}
        </section>

        {featuredProducts.length > 0 && <section className="mt-12 border-t border-[#e2e5ea] pt-8 sm:mt-16 sm:pt-12"><FeaturedProducts featuredProducts={featuredProducts} /></section>}

        <section id="wholesale" aria-labelledby="wholesale-heading" className="mt-12 scroll-mt-28 overflow-hidden rounded-2xl border border-[#fcd3b2] bg-gradient-to-l from-[#fff7f0] to-[#fde2cc] sm:mt-16">
          <div className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-bold text-[#c2410c]"><Building2 size={16} aria-hidden="true" />همکاری عمده‌فروشی</p>
              <h2 id="wholesale-heading" className="text-2xl font-extrabold tracking-tight text-[#1c1f24] sm:text-3xl">قیمت ویژه برای فروشگاه‌ها، تعمیرگاه‌ها و همکاران</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#4b5059]">
                حساب‌های عمده فقط توسط کارشناسان میبا و پس از احراز هویت کسب‌وکار ساخته می‌شوند و ثبت‌نام عمومی ندارند. همکاران پس از ورود، قیمت‌های عمده اختصاصی، حداقل تعداد سفارش هر قطعه و فرم سفارش سریع با کد فنی را می‌بینند.
              </p>
              <ul className="mt-4 grid gap-2 text-sm text-[#33373e] sm:grid-cols-2">
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#ea580c]" aria-hidden="true" />قیمت پلکانی از حداقل تعداد</li>
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#ea580c]" aria-hidden="true" />سفارش تا ۱٬۰۰۰ عدد از هر قطعه</li>
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#ea580c]" aria-hidden="true" />سفارش سریع با فهرست کد فنی</li>
                <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-[#ea580c]" aria-hidden="true" />تخفیف اختصاصی هر همکار</li>
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              {isWholesale ? (
                <Link to="/wholesale/quick-order" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#ea580c] px-6 text-sm font-bold text-white transition hover:bg-[#c2410c]">سفارش سریع عمده<ArrowLeft size={16} aria-hidden="true" /></Link>
              ) : (
                <>
                  <Link to="/login?wholesale=1" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#ea580c] px-6 text-sm font-bold text-white transition hover:bg-[#c2410c]">ورود همکاران<ArrowLeft size={16} aria-hidden="true" /></Link>
                  <Link to="/support#wholesale-account" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#c2410c]/40 bg-white/70 px-6 text-sm font-bold text-[#c2410c] transition hover:bg-white">درخواست حساب همکاری</Link>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-3 rounded-2xl border border-[#e2e5ea] bg-[#ffffff] p-4 sm:grid-cols-3 sm:gap-5 sm:p-6" aria-label="اطلاعات پیش از خرید">
          {benefits.map(({ icon: Icon, title, text, href }) => (
            <Link key={title} to={href} className="group flex items-start gap-3 rounded-xl px-2 py-2 transition hover:bg-[#f5f6f8] sm:px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eceef2] text-[#ea580c]"><Icon size={20} aria-hidden="true" /></span>
              <div className="min-w-0"><h2 className="text-sm font-semibold text-[#1c1f24]">{title}</h2><p className="mt-1 text-xs leading-5 text-[#6b717b]">{text}</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#ea580c]">بیشتر بدانید<ArrowLeft size={13} aria-hidden="true" /></span></div>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
};

export default HomePage;

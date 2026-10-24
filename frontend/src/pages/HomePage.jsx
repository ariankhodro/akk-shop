import { useEffect, useState } from "react";
import PageMeta from "../components/PageMeta";
import { ArrowLeft, Leaf, PackageCheck, ShieldCheck, Sparkles, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import axios from "../lib/axios";
import CategoryItem from "../components/CategoryItem";
import ProductCard from "../components/ProductCard";
import { useProductStore } from "../stores/useProductStore";
import FeaturedProducts from "../components/FeaturedProducts";
import { formatPrice } from "../lib/commerce";
import { useCategoryStore } from "../stores/useCategoryStore";
import { getCampaignPath } from "../lib/campaign-url";

const legacyCategoryCards = [
  { href: "/category/jeans", name: "شلوار جین", imageUrl: "/jeans.jpg" },
  { href: "/category/t-shirts", name: "تی‌شرت", imageUrl: "/tshirts.jpg" },
  { href: "/category/shoes", name: "کفش", imageUrl: "/shoes.jpg" },
  { href: "/category/glasses", name: "عینک", imageUrl: "/glasses.png" },
  { href: "/category/jackets", name: "کاپشن و کت", imageUrl: "/jackets.jpg" },
  { href: "/category/suits", name: "کت‌وشلوار", imageUrl: "/suits.jpg" },
  { href: "/category/bags", name: "کیف", imageUrl: "/bags.jpg" },
];

const collections = [
  { title: "استایل روزمره", description: "پایه‌های راحت برای ترکیب روزانه", href: "/looks/daily-style", image: "/jeans.jpg", categories: ["jeans", "t-shirts", "shoes"] },
  { title: "لایه‌های ماندگار", description: "ترکیب کت و شلوار برای روزهای خنک", href: "/looks/layers", image: "/jackets.jpg", categories: ["jackets", "jeans", "t-shirts"] },
  { title: "جزئیات تکمیل‌کننده", description: "اکسسوری‌های ساده برای تکمیل ظاهر", href: "/looks/details", image: "/bags.jpg", categories: ["bags", "glasses", "shoes"] },
];

const benefits = [
  { icon: Truck, title: "ارسال و تحویل", text: "هزینه و شرط ارسال رایگان را پیش از پرداخت بررسی کنید.", href: "/shipping-policy" },
  { icon: PackageCheck, title: "مرجوعی و تعویض", text: "وضعیت سیاست مرجوعی و راه هماهنگی پیش از خرید.", href: "/returns-policy" },
  { icon: ShieldCheck, title: "راهنما و پشتیبانی", text: "پاسخ پرسش‌های خرید و راه ارتباط رسمی فروشگاه.", href: "/support" },
];

const HomePage = () => {
  const [heroImageFailed, setHeroImageFailed] = useState(false);
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
          imageUrl: category.image || "/tshirts.jpg",
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

  const catalogProducts = [...featuredProducts, ...bestsellers, ...newestProducts]
    .filter((product, index, products) => product?._id && products.findIndex((item) => item?._id === product._id) === index);

  // Campaigns are already time-filtered by the API. Only promote one in the hero
  // when its image and local destination are both ready to use.
  const heroCampaign = campaigns.find((campaign) => {
    const hasTitle = typeof campaign?.title === "string" && campaign.title.trim();
    const hasImage = typeof campaign?.image === "string" && campaign.image.trim();
    const href = campaign?.href;
    return hasTitle && hasImage && typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
  });
  const heroProduct = catalogProducts.find((product) =>
    typeof product?.image === "string" &&
    product.image.trim() &&
    !(typeof product.stock === "number" && product.stock <= 0)
  );
  const heroImage = heroCampaign?.image || heroProduct?.image || "/jackets.jpg";
  useEffect(() => setHeroImageFailed(false), [heroImage]);
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

  const sampleProductsForLook = (collection) => {
    const used = new Set();
    return collection.categories
      .map((category) => catalogProducts.find((product) => product.category === category && !used.has(product._id)))
      .filter((product) => {
        if (!product) return false;
        used.add(product._id);
        return true;
      })
      .slice(0, 3);
  };

  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-[#f7f5f0] text-[#252722]">
      <PageMeta title="فروشگاه آنلاین پوشاک و اکسسوری" description="تازه‌ترین پوشاک و اکسسوری را در تیک بوتیک ببینید." path="/" />
      <div className="mx-auto max-w-[1920px] px-3 pb-12 pt-4 sm:px-6 sm:pb-16 sm:pt-8 lg:px-8 2xl:px-12">
        <section className="relative isolate overflow-hidden rounded-2xl border border-[#e4e0d8] bg-[#e9e5dc]">
          <div className="grid grid-cols-1 items-stretch lg:min-h-[540px] lg:grid-cols-2">
            <div className="relative order-1 min-h-[250px] overflow-hidden sm:min-h-[320px] lg:order-2 lg:min-h-[540px]">
              {!heroImageFailed ? (
                <img
                  src={heroImage}
                  alt={heroCampaign ? heroCampaign.title : heroProduct?.name || "پوشاک تیک بوتیک"}
                  className={`absolute inset-0 h-full w-full ${heroCampaign ? "object-cover object-center" : "object-contain object-center p-6 sm:p-8 lg:p-10"}`}
                  fetchPriority="high"
                  onError={() => setHeroImageFailed(true)}
                />
              ) : (
                <div role="img" aria-label="تصویر پیشنهادی در دسترس نیست" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#eeeae2] via-[#e4dfd4] to-[#d9d3c7] p-8 text-center text-[#62645c]">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full border border-[#b8b2a5] bg-white/45 font-serif text-4xl" aria-hidden="true">T</span>
                  <span className="max-w-xs text-sm font-medium leading-6">برای مشاهده محصولات پیشنهادی، مجموعه تیک بوتیک را ببینید.</span>
                </div>
              )}
              <div className={`absolute inset-0 ${heroCampaign ? "bg-gradient-to-l from-[#252722]/30 via-transparent to-transparent" : "bg-gradient-to-t from-[#e9e5dc]/20 via-transparent to-transparent"}`} />
              {heroCampaign ? (
                <div className="absolute bottom-5 right-5 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/80 px-4 py-2 text-xs font-semibold text-[#252722] shadow-sm backdrop-blur-sm">
                  <Sparkles size={14} aria-hidden="true" />
                  پیشنهاد فعال فروشگاه
                </div>
              ) : heroProduct ? (
                <Link
                  to={`/product/${heroProduct._id}`}
                  className="absolute bottom-4 right-4 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-white/70 bg-white/90 p-3 text-[#252722] shadow-lg backdrop-blur-md transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f] sm:bottom-5 sm:right-5 sm:p-4"
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-medium text-[#68745f] sm:text-xs">از محصولات تیک بوتیک</span>
                    <span className="mt-1 block line-clamp-1 text-xs font-semibold sm:text-sm">{heroProduct.name}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-[#252722] sm:text-sm">{formatPrice(heroProduct.price)}</span>
                </Link>
              ) : (
                <div className="absolute bottom-5 right-5 rounded-full border border-white/60 bg-white/75 px-4 py-2 text-xs font-medium text-[#252722] backdrop-blur-sm">
                  سادگی با جلوه‌ای خاص
                </div>
              )}
            </div>
            <div className="relative z-10 order-2 min-w-0 px-5 py-8 sm:px-10 sm:py-12 lg:order-1 lg:px-12 lg:py-16 xl:px-14 xl:py-20">
              <p className="mb-4 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#68745f] sm:mb-5 sm:text-xs sm:tracking-[0.22em]">
                <Sparkles size={15} aria-hidden="true" />
                {heroCampaign ? "پیشنهاد ویژه تیک بوتیک" : "انتخاب‌های هماهنگ برای هر روز"}
              </p>
              <h1 className="max-w-xl font-serif text-3xl font-medium leading-[1.12] tracking-tight text-[#252722] sm:text-5xl sm:leading-[1.08] xl:text-6xl">
                {heroCampaign ? heroCampaign.title : (
                  <>استایلی که برای تو <br className="hidden sm:block" /><span className="italic text-[#68745f]">ساخته شده.</span></>
                )}
              </h1>
              <p className="mt-4 max-w-md text-sm leading-6 text-[#62645c] sm:mt-6 sm:text-lg sm:leading-7">
                {heroCampaign
                  ? heroCampaign.description || "این پیشنهاد را ببینید و محصولات مرتبط را انتخاب کنید."
                  : "از میان پوشاک و اکسسوری‌های فروشگاه، انتخابی هماهنگ با سبک خودت پیدا کن."}
              </p>
              <div className="mt-6 flex flex-col items-stretch gap-2 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                {heroCampaign ? (
                  <Link to={getCampaignPath(heroCampaign)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#252722] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#41443b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f] sm:w-auto">
                    مشاهده پیشنهاد<ArrowLeft size={17} aria-hidden="true" />
                  </Link>
                ) : (
                  <Link to="/shop" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#252722] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#41443b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f] sm:w-auto">
                    مشاهده محصولات<ArrowLeft size={17} aria-hidden="true" />
                  </Link>
                )}
                <a href="#shop-by-category" className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[#c7c3b9] px-6 py-3 text-sm font-semibold text-[#252722] transition hover:border-[#252722] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f] sm:w-auto">
                  {heroCampaign ? "خرید بر اساس دسته‌بندی" : "دسته‌بندی‌ها"}
                </a>
              </div>
              <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 border-t border-[#d5d0c5] pt-4 text-[11px] text-[#62645c] sm:mt-8 sm:gap-x-6 sm:gap-y-3 sm:pt-5 sm:text-sm">
                <span className="inline-flex items-center gap-2"><Leaf size={16} aria-hidden="true" />انتخاب‌های روزمره</span>
                <span className="inline-flex items-center gap-2"><PackageCheck size={16} aria-hidden="true" />اطلاعات روشن محصول</span>
              </div>
            </div>
          </div>
        </section>

        <section id="shop-by-category" className="scroll-mt-28 pt-12 sm:pt-16 lg:pt-20">
          <div className="mb-5 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#68745f] sm:mb-2 sm:text-xs sm:tracking-[0.2em]">انتخاب مناسب شما</p>
              <h2 className="font-serif text-2xl font-medium tracking-tight text-[#252722] sm:text-4xl">خرید بر اساس دسته‌بندی</h2>
              <p className="mt-2 max-w-md text-xs leading-5 text-[#62645c] sm:text-sm sm:leading-6">دسته‌بندی موردنظرتان را انتخاب کنید.</p>
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
              <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#68745f] sm:mb-2 sm:text-xs sm:tracking-[0.2em]">ویژه و محدود</p><h2 id="campaigns-heading" className="font-serif text-2xl font-medium sm:text-3xl">پیشنهادهای ویژه</h2></div>
              <Link to="/campaigns" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-[#d5d0c5] px-3 text-xs font-semibold text-[#68745f] transition hover:border-[#252722] hover:text-[#252722] sm:border-0 sm:px-0 sm:text-sm">همه پیشنهادها<ArrowLeft size={15} aria-hidden="true" /></Link>
            </div>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-3 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4">
              {secondaryCampaigns.map((campaign) => (
                <Link to={getCampaignPath(campaign)} key={campaign._id} className="group relative isolate flex min-h-[210px] min-w-[88%] snap-center overflow-hidden rounded-2xl border border-[#e4e0d8] bg-[#e9e5dc] p-5 transition hover:border-[#c7c3b9] sm:min-h-[230px] sm:min-w-[48%] sm:p-6 xl:min-w-[32%]">
                  {campaign.image && <img src={campaign.image} alt="" loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />}
                  <div className="absolute inset-0 -z-10 bg-gradient-to-l from-[#252722]/85 via-[#252722]/55 to-transparent" />
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
                <p className="mb-1.5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#68745f] sm:mb-2 sm:text-xs sm:tracking-[0.2em]"><Sparkles size={14} aria-hidden="true" />محبوب بر اساس سفارش‌های تکمیل‌شده</p>
                <h2 id="bestsellers-heading" className="font-serif text-2xl font-medium tracking-tight sm:text-4xl">پرفروش‌های فروشگاه</h2>
                <p className="mt-2 text-xs leading-5 text-[#62645c] sm:text-sm sm:leading-6">بر اساس تعداد کالا در سفارش‌هایی که پرداختشان تأیید شده است.</p>
              </div>
              <Link to="/bestsellers" className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-full border border-[#d5d0c5] px-4 py-2 text-xs font-semibold text-[#252722] transition hover:border-[#252722] sm:self-auto sm:text-sm">
                مشاهده همه محصولات<ArrowLeft size={15} aria-hidden="true" />
              </Link>
            </div>
            {bestsellersError ? (
              <div role="alert" className="rounded-2xl border border-[#e4e0d8] bg-[#fffefa] px-5 py-8 text-center sm:py-10">
                <p className="text-sm font-semibold text-[#41443b]">پرفروش‌ها بارگذاری نشدند.</p>
                <p className="mt-1 text-xs leading-5 text-[#77786f]">اتصال را بررسی کنید و دوباره تلاش کنید.</p>
                <button type="button" onClick={retryBestsellers} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#252722] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#41443b]">تلاش دوباره</button>
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
              <p className="mb-1.5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#68745f] sm:mb-2 sm:text-xs sm:tracking-[0.2em]">
                <Sparkles size={14} aria-hidden="true" />
                تازه به فروشگاه اضافه شده
              </p>
              <h2 id="newest-products-heading" className="font-serif text-2xl font-medium tracking-tight sm:text-4xl">تازه‌واردها</h2>
              <p className="mt-2 text-xs leading-5 text-[#62645c] sm:text-sm sm:leading-6">محصولات جدید را با کشیدن به چپ و راست مرور کنید.</p>
            </div>
            <Link to="/new-arrivals" className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-full border border-[#d5d0c5] px-4 py-2 text-xs font-semibold text-[#252722] transition hover:border-[#252722] sm:self-auto sm:text-sm">
              مشاهده همه
              <ArrowLeft size={15} aria-hidden="true" />
            </Link>
          </div>

          {!newestLoaded ? (
            <div aria-label="در حال بارگذاری محصولات تازه" className="flex gap-3 overflow-hidden sm:gap-4">
              {[0, 1, 2].map((item) => (
                <div key={item} className="min-w-[68%] shrink-0 animate-pulse overflow-hidden rounded-2xl border border-[#e4e0d8] bg-white sm:min-w-[36%] lg:min-w-[24%]">
                  <div className="aspect-[4/5] bg-[#e9e5dc]" />
                  <div className="space-y-3 p-4">
                    <div className="h-4 w-3/4 rounded-full bg-[#e9e5dc]" />
                    <div className="h-4 w-1/2 rounded-full bg-[#e9e5dc]" />
                    <div className="h-10 rounded-full bg-[#e9e5dc]" />
                  </div>
                </div>
              ))}
            </div>
          ) : newestError ? (
            <div role="alert" className="rounded-2xl border border-[#e4e0d8] bg-[#fffefa] px-5 py-8 text-center sm:py-10">
              <PackageCheck size={24} className="mx-auto text-[#68745f]" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-[#41443b]">تازه‌واردها بارگذاری نشدند.</p>
              <p className="mt-1 text-xs leading-5 text-[#77786f]">برای دریافت تازه‌ترین محصولات دوباره تلاش کنید.</p>
              <button type="button" onClick={retryNewest} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#252722] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#41443b]">تلاش دوباره</button>
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
            <div className="rounded-2xl border border-[#e4e0d8] bg-[#fffefa] px-5 py-8 text-center sm:py-10">
              <PackageCheck size={24} className="mx-auto text-[#68745f]" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-[#41443b]">محصول تازه‌ای برای نمایش نیست.</p>
              <p className="mt-1 text-xs text-[#77786f]">بعداً دوباره سر بزنید یا محصولات فروشگاه را ببینید.</p>
              <Link to="/shop" className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#252722] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#41443b]">رفتن به فروشگاه</Link>
            </div>
          )}
        </section>

        {featuredProducts.length > 0 && <section className="mt-12 border-t border-[#e4e0d8] pt-8 sm:mt-16 sm:pt-12"><FeaturedProducts featuredProducts={featuredProducts} /></section>}

        <section className="pt-12 sm:pt-16 lg:pt-20" aria-labelledby="collections-heading">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#68745f]">انتخاب‌های هماهنگ</p><h2 id="collections-heading" className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">مجموعه‌های پیشنهادی</h2></div>
            <p className="max-w-md text-sm leading-6 text-[#62645c]">ترکیب‌های ساده برای شروع یک انتخاب تازه.</p>
          </div>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-3 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-3 md:gap-4">
            {collections.map((collection) => {
              const lookProducts = sampleProductsForLook(collection);
              return (
                <Link to={collection.href} key={collection.title} className="group relative isolate flex min-h-[260px] min-w-[84%] snap-center items-end overflow-hidden rounded-2xl bg-[#e9e5dc] p-4 sm:min-h-[290px] sm:p-5 md:min-w-0">
                  <img src={collection.image} alt="" loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#252722]/95 via-[#252722]/65 to-[#252722]/10" />
                  <div className="w-full text-white">
                    <h3 className="font-serif text-2xl font-medium">{collection.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-white/85">{collection.description}</p>
                    {lookProducts.length > 0 && (
                      <div className="mt-4 grid grid-cols-2 gap-2" aria-label="نمونه‌هایی از کالاهای این استایل">
                        {lookProducts.slice(0, 2).map((product) => (
                          <span key={product._id} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/25 bg-[#fffefa]/95 p-2 text-[#252722] shadow-sm backdrop-blur-sm">
                            {product.image ? <img src={product.image} alt="" loading="lazy" className="h-12 w-10 shrink-0 rounded-lg bg-[#e9e5dc] object-cover" /> : <span className="h-12 w-10 shrink-0 rounded-lg bg-[#e9e5dc]" />}
                            <span className="min-w-0"><span className="block line-clamp-2 text-[11px] font-semibold leading-4">{product.name}</span><span className="mt-1 block text-[10px] tabular-nums text-[#68745f]">{formatPrice(product.price)}</span></span>
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold">مشاهده استایل<ArrowLeft size={16} aria-hidden="true" /></span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-8 grid gap-3 rounded-2xl border border-[#e4e0d8] bg-[#fffefa] p-4 sm:grid-cols-3 sm:gap-5 sm:p-6" aria-label="اطلاعات پیش از خرید">
          {benefits.map(({ icon: Icon, title, text, href }) => (
            <Link key={title} to={href} className="group flex items-start gap-3 rounded-xl px-2 py-2 transition hover:bg-[#f7f5f0] sm:px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e9e5dc] text-[#68745f]"><Icon size={20} aria-hidden="true" /></span>
              <div className="min-w-0"><h2 className="text-sm font-semibold text-[#252722]">{title}</h2><p className="mt-1 text-xs leading-5 text-[#77786f]">{text}</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#68745f]">بیشتر بدانید<ArrowLeft size={13} aria-hidden="true" /></span></div>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
};

export default HomePage;

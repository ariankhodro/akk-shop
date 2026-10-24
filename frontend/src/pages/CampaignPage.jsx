import { useCallback, useEffect, useState } from "react";
import PageMeta from "../components/PageMeta";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, LoaderCircle, Megaphone, PackageCheck, RefreshCw } from "lucide-react";
import axios from "../lib/axios";
import ProductCard from "../components/ProductCard";
import { formatIranianDateTime } from "../lib/iranian-date";

const CampaignPage = () => {
  const { campaignId } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCampaign = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get("/campaigns/" + encodeURIComponent(campaignId));
      setCampaign(data.campaign || null);
    } catch (requestError) {
      setError(requestError.response?.status === 404
        ? "این کمپین در دسترس نیست یا زمان نمایش آن به پایان رسیده است."
        : requestError.response?.data?.message || "بارگذاری صفحه کمپین ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  const trackCampaignClick = () => { axios.post("/campaigns/" + encodeURIComponent(campaignId) + "/click").catch(() => {}); };
  const products = (campaign?.productIds || []).filter((product) => product && product.isActive !== false);

  return (
    <main dir="rtl" className="min-h-[65vh] bg-[#f5f6f8] px-3 py-7 text-[#1c1f24] sm:px-6 sm:py-10 lg:px-8">
      <PageMeta title={campaign?.title || "کمپین فروشگاهی"} description={campaign?.description || "پیشنهادهای ویژه و قطعات منتخب میبا."} image={campaign?.image} path={window.location.pathname} type="campaign" itemList={products} breadcrumbs={[{ name: "صفحه اصلی", path: "/" }, { name: "پیشنهادهای ویژه", path: "/campaigns" }, { name: campaign?.title || "کمپین", path: window.location.pathname }]} robots={error ? "noindex, nofollow" : "index, follow, max-image-preview:large"} canonical={!error} />
      <div className="mx-auto max-w-6xl">
        <nav aria-label="مسیر صفحه" className="mb-5 flex flex-wrap items-center gap-2 text-xs text-[#6b717b]">
          <Link to="/" className="hover:text-[#ea580c]">صفحه اصلی</Link>
          <span aria-hidden="true">/</span>
          <Link to="/campaigns" className="hover:text-[#ea580c]">پیشنهادهای ویژه</Link>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-[#33373e]">{campaign?.title || "کمپین"}</span>
        </nav>

        {loading ? (
          <div role="status" className="flex min-h-64 items-center justify-center gap-3 text-sm text-[#5a606a]">
            <LoaderCircle size={22} className="animate-spin text-[#ea580c]" aria-hidden="true" />در حال بارگذاری کمپین…
          </div>
        ) : error ? (
          <section className="rounded-2xl border border-[#e2e5ea] bg-[#ffffff] p-8 text-center">
            <Megaphone size={30} className="mx-auto text-[#ea580c]" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-bold">{error}</h1>
            <button type="button" onClick={loadCampaign} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d2d6dc] px-4 py-2 text-sm font-semibold">
              <RefreshCw size={15} aria-hidden="true" />تلاش دوباره
            </button>
            <Link to="/campaigns" className="mr-2 inline-flex min-h-10 items-center rounded-full bg-[#1c1f24] px-4 py-2 text-sm font-semibold text-white">مشاهده پیشنهادها</Link>
          </section>
        ) : campaign && (
          <>
            <article className="overflow-hidden rounded-3xl border border-[#e2e5ea] bg-[#ffffff] shadow-sm">
              <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
                <div className="relative min-h-64 bg-[#eceef2] sm:min-h-80 lg:min-h-[28rem]">
                  {campaign.image ? (
                    <img src={campaign.image} alt={campaign.title} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[#ea580c]"><Megaphone size={52} aria-hidden="true" /></div>
                  )}
                </div>
                <div className="flex flex-col justify-center p-6 sm:p-9 lg:p-12">
                  <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#ea580c]"><Megaphone size={15} aria-hidden="true" />پیشنهاد ویژه میبا</p>
                  <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{campaign.title}</h1>
                  {campaign.description && <p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#5a606a] sm:text-base">{campaign.description}</p>}
                  <div className="mt-6 space-y-2 border-t border-[#e2e5ea] pt-5 text-xs leading-6 text-[#6b717b]">
                    <p className="flex items-start gap-2"><CalendarClock size={16} className="mt-0.5 shrink-0 text-[#ea580c]" aria-hidden="true" /><span>شروع: {formatIranianDateTime(campaign.startsAt)}</span></p>
                    <p className="flex items-start gap-2"><CalendarClock size={16} className="mt-0.5 shrink-0 text-[#ea580c]" aria-hidden="true" /><span>پایان: {formatIranianDateTime(campaign.endsAt)}</span></p>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <a href="#campaign-products-heading" onClick={trackCampaignClick} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#1c1f24] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#33373e]">
                      مشاهده قطعات کمپین<ArrowLeft size={16} aria-hidden="true" />
                    </a>
                    <Link to="/campaigns" className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#d2d6dc] px-5 py-3 text-sm font-semibold text-[#33373e]">همه پیشنهادها</Link>
                  </div>
                </div>
              </div>
            </article>

            <section id="campaign-products-heading" className="pt-10 sm:pt-14" aria-labelledby="campaign-products-title">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-[#ea580c]">مجموعه اختصاصی</p>
                  <h2 id="campaign-products-title" className="text-2xl font-bold">قطعات این کمپین</h2>
                  <p className="mt-2 text-sm text-[#6b717b]">{new Intl.NumberFormat("fa-IR").format(products.length)} قطعه مرتبط با این پیشنهاد</p>
                </div>
              </div>
              {products.length ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                  {products.map((product) => <ProductCard key={product._id} product={product} />)}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#d2d6dc] bg-[#ffffff] px-5 py-8 text-center">
                  <PackageCheck size={25} className="mx-auto text-[#ea580c]" aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold text-[#33373e]">هنوز قطعه مشخصی به این کمپین اختصاص داده نشده است.</p>
                  <p className="mt-1 text-xs leading-6 text-[#6b717b]">مدیر فروشگاه می‌تواند قطعات مرتبط را از بخش مدیریت کمپین‌ها انتخاب کند.</p>
                  <Link to={campaign.href || "/shop"} onClick={trackCampaignClick} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#1c1f24] px-4 py-2 text-sm font-semibold text-white">رفتن به مقصد کمپین</Link>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
};

export default CampaignPage;

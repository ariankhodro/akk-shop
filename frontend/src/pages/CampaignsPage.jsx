import { useCallback, useEffect, useState } from "react";
import PageMeta from "../components/PageMeta";
import { Link } from "react-router-dom";
import { ArrowLeft, LoaderCircle, Megaphone, RefreshCw } from "lucide-react";
import axios from "../lib/axios";
import { formatIranianDateTime } from "../lib/iranian-date";
import { getCampaignPath } from "../lib/campaign-url";

const CampaignsPage = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get("/campaigns?limit=100");
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "بارگذاری پیشنهادهای ویژه ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  return (
    <main dir="rtl" className="min-h-[65vh] bg-[#f7f5f0] px-3 py-8 text-[#252722] sm:px-6 sm:py-12 lg:px-8">
      <PageMeta title="پیشنهادهای ویژه" description="کمپین‌ها و پیشنهادهای فعال فروشگاه تیک بوتیک." path="/campaigns" breadcrumbs={[{ name: "صفحه اصلی", path: "/" }, { name: "پیشنهادهای ویژه", path: "/campaigns" }]} />
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold tracking-wide text-[#68745f]">مجموعه تیک بوتیک</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">پیشنهادهای ویژه</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[#62645c]">هر کمپین صفحه اختصاصی و نشانی جداگانه دارد؛ آن را باز کنید، جزئیات و کالاهای انتخاب‌شده را ببینید و لینک صفحه را به اشتراک بگذارید.</p>

        {loading ? (
          <div role="status" className="flex min-h-56 items-center justify-center gap-3 text-sm text-[#62645c]"><LoaderCircle size={22} className="animate-spin text-[#68745f]" aria-hidden="true" />در حال دریافت پیشنهادها…</div>
        ) : error ? (
          <div role="alert" className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            {error}<button type="button" onClick={loadCampaigns} className="mr-3 inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={14} aria-hidden="true" />تلاش دوباره</button>
          </div>
        ) : campaigns.length ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <Link key={campaign._id} to={getCampaignPath(campaign)} className="group overflow-hidden rounded-2xl border border-[#e4e0d8] bg-[#fffefa] transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]">
                <div className="relative aspect-[16/9] bg-[#e9e5dc]">
                  {campaign.image ? <img src={campaign.image} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" /> : <div className="flex h-full items-center justify-center text-[#68745f]"><Megaphone size={35} aria-hidden="true" /></div>}
                </div>
                <div className="p-4 sm:p-5">
                  <p className="text-[11px] font-semibold text-[#68745f]">کمپین ویژه</p>
                  <h2 className="mt-2 text-xl font-bold">{campaign.title}</h2>
                  {campaign.description && <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#62645c]">{campaign.description}</p>}
                  <p className="mt-3 text-xs text-[#77786f]">تا {formatIranianDateTime(campaign.endsAt)}</p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#41443b]">مشاهده صفحه کمپین<ArrowLeft size={16} aria-hidden="true" /></span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <section className="mt-8 rounded-2xl border border-dashed border-[#d5d0c5] bg-[#fffefa] p-8 text-center">
            <Megaphone size={28} className="mx-auto text-[#68745f]" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">در حال حاضر کمپین فعالی وجود ندارد.</h2>
            <Link to="/shop" className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#252722] px-5 py-2 text-sm font-semibold text-white">مشاهده فروشگاه</Link>
          </section>
        )}
      </div>
    </main>
  );
};

export default CampaignsPage;

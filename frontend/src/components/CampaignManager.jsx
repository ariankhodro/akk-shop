import { useEffect, useState } from "react";
import { Copy, ExternalLink, Megaphone, Pause, Pencil, Play, Save, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import IranianDateTimeInput from "./IranianDateTimeInput";
import { formatIranianDateTimeInput, formatIranianDateTime, parseIranianDateTime } from "../lib/iranian-date";
import { getCampaignPath } from "../lib/campaign-url";

const initialForm = () => ({
  title: "",
  description: "",
  image: "",
  href: "/shop",
  startsAt: formatIranianDateTimeInput(new Date()),
  endsAt: formatIranianDateTimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  productIds: [],
  sortOrder: "0",
});

const CampaignManager = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(false);

  const loadCampaigns = async () => {
    try {
      const response = await axios.get("/campaigns/admin");
      setCampaigns(response.data.campaigns || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "بارگذاری کمپین‌ها ناموفق بود");
    }
  };

  const loadProducts = async () => {
    try {
      const response = await axios.get("/products", { params: { page: 1, limit: 50, status: "active" } });
      setProducts(Array.isArray(response.data.products) ? response.data.products.filter((product) => product.isActive !== false) : []);
    } catch (error) {
      toast.error(error.response?.data?.message || "بارگذاری محصولات برای کمپین ناموفق بود");
    }
  };

  useEffect(() => { loadCampaigns(); loadProducts(); }, []);

  const handleCampaignImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("لطفاً یک فایل تصویری انتخاب کنید.");
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("حجم تصویر کمپین باید حداکثر ۵ مگابایت باشد.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, image: String(reader.result || "") }));
    reader.onerror = () => toast.error("خواندن تصویر ناموفق بود؛ دوباره تلاش کنید.");
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const copyCampaignLink = async (campaign) => {
    const url = new URL(getCampaignPath(campaign), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      toast.success("لینک اختصاصی کمپین کپی شد.");
    } catch {
      toast.error("کپی لینک ممکن نشد؛ نشانی صفحه: " + url);
    }
  };

  const resetForm = () => { setForm(initialForm()); setEditingId(""); };
  const startEdit = (campaign) => {
    setEditingId(campaign._id);
    setForm({
      title: campaign.title || "", description: campaign.description || "", image: campaign.image || "",
      href: campaign.href || "/shop",
      startsAt: formatIranianDateTimeInput(new Date(campaign.startsAt)),
      endsAt: formatIranianDateTimeInput(new Date(campaign.endsAt)),
      productIds: (campaign.productIds || []).map((product) => String(product?._id || product)),
      sortOrder: String(campaign.sortOrder ?? 0),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleSubmit = async (event) => {
    event.preventDefault();
    const startsAt = parseIranianDateTime(form.startsAt);
    const endsAt = parseIranianDateTime(form.endsAt);
    if (!startsAt || !endsAt) {
      toast.error("تاریخ و ساعت را با تقویم شمسی و قالب سال/ماه/روز ساعت:دقیقه وارد کنید.");
      return;
    }
    if (endsAt <= startsAt) {
      toast.error("زمان پایان کمپین باید بعد از زمان شروع باشد.");
      return;
    }
    setLoading(true);
    try {
      const payload = { ...form, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), sortOrder: Number(form.sortOrder) };
      if (editingId) { await axios.patch("/campaigns/" + editingId, payload); toast.success("کمپین به‌روزرسانی شد"); }
      else { await axios.post("/campaigns", payload); toast.success("کمپین ایجاد شد"); }
      resetForm();
      await loadCampaigns();
    } catch (error) {
      toast.error(error.response?.data?.message || "ایجاد کمپین ناموفق بود");
    } finally {
      setLoading(false);
    }
  };

  const toggleCampaign = async (campaign) => {
    try {
      // Keep toggles narrow: do not resend media data or overwrite an image
      // reference while changing only the active flag.
      await axios.patch(`/campaigns/${campaign._id}`, {
        isActive: !campaign.isActive,
      });
      await loadCampaigns();
    } catch (error) {
      toast.error(error.response?.data?.message || "به‌روزرسانی کمپین ناموفق بود");
    }
  };

  const removeCampaign = async (campaign) => {
    if (!window.confirm(`کمپین «${campaign.title}» حذف شود؟`)) return;
    try {
      await axios.delete(`/campaigns/${campaign._id}`);
      setCampaigns((items) => items.filter((item) => item._id !== campaign._id));
      toast.success("کمپین حذف شد");
    } catch (error) {
      toast.error(error.response?.data?.message || "حذف کمپین ناموفق بود");
    }
  };

  const fieldClass = "mt-1 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-3 py-2 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-accent)] focus:ring-2 focus:ring-[#ea580c]/30";

  return (
    <section dir="rtl" className="mx-auto max-w-5xl space-y-8">
      <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-lg sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <Megaphone className="h-6 w-6 text-[var(--brand-primary)]" aria-hidden="true" />
          <div>
            <h2 className="text-xl font-semibold text-[var(--ui-text)]">{editingId ? "ویرایش کمپین فروشگاهی" : "ایجاد کمپین فروشگاهی"}</h2>
            <p className="mt-1 text-sm text-[var(--ui-muted)]">زمان‌ها براساس ساعت ایران (Asia/Tehran) ذخیره می‌شوند. مراجعه و کلیک دکمه اصلی در فهرست کمپین‌ها ثبت می‌شود.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-[var(--ui-muted)]">عنوان کمپین<input required maxLength={100} className={fieldClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="text-sm text-[var(--ui-muted)]">مقصد دکمه داخل صفحه کمپین (مثل /shop)<input required pattern="/(?!/).*" className={fieldClass} value={form.href} onChange={(event) => setForm({ ...form, href: event.target.value })} /></label>
          <label className="text-sm text-[var(--ui-muted)] sm:col-span-2">توضیح کوتاه<input maxLength={300} className={fieldClass} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label className="text-sm text-[var(--ui-muted)] sm:col-span-2">محصولات مرتبط با این کمپین (اختیاری)
            <select multiple size={Math.min(6, Math.max(3, products.length))} className={fieldClass + " min-h-32"} value={form.productIds}
              onChange={(event) => setForm({ ...form, productIds: [...event.target.selectedOptions].map((option) => option.value) })}>
              {products.map((product) => <option key={product._id} value={product._id}>{product.name} · {new Intl.NumberFormat("fa-IR").format(product.price)} تومان</option>)}
            </select>
            <span className="mt-1 block text-[11px] leading-5 text-[var(--ui-muted)]">برای انتخاب چند کالا، در دسکتاپ کلید Ctrl یا Command را نگه دارید. این محصولات در صفحه اختصاصی کمپین نمایش داده می‌شوند.</span>
          </label>
          <div className="text-sm text-[var(--ui-muted)] sm:col-span-2">
            <label>بارگذاری تصویر کمپین (اختیاری، حداکثر ۵ مگابایت)
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className={fieldClass} onChange={handleCampaignImageChange} />
            </label>
            <p className="mt-1 text-xs leading-5">یک تصویر برای بنر کمپین انتخاب کنید. فرمت‌های تصویری پذیرفته می‌شوند و محدودیت حجم ۵ مگابایت است.</p>
            {form.image && <div className="mt-3 flex flex-wrap items-center gap-3">
              <img src={form.image} alt="پیش‌نمایش تصویر کمپین" className="h-24 max-w-full rounded-xl border border-[var(--ui-border)] object-cover" />
              <button type="button" onClick={() => setForm((current) => ({ ...current, image: "" }))} className="rounded-lg border border-[var(--ui-border)] px-3 py-2 text-xs hover:bg-[var(--ui-hover)]">حذف تصویر</button>
            </div>}
          </div>
          <IranianDateTimeInput id="campaign-starts-at" label="شروع نمایش" required value={form.startsAt} onChange={(value) => setForm({ ...form, startsAt: value })} />
          <IranianDateTimeInput id="campaign-ends-at" label="پایان نمایش" required value={form.endsAt} onChange={(value) => setForm({ ...form, endsAt: value })} />
          <label className="text-sm text-[var(--ui-muted)]">ترتیب نمایش<input type="number" min="0" step="1" className={fieldClass} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} /></label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2"><button type="submit" disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-primary)] px-6 py-2 text-sm font-semibold text-[var(--ui-text)] transition hover:bg-[var(--brand-hover)] disabled:opacity-50">{loading ? "در حال ذخیره…" : editingId ? <><Save size={15} aria-hidden="true" />ذخیره تغییرات</> : "ایجاد کمپین"}</button>{editingId && <button type="button" onClick={resetForm} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ui-border)] px-5 py-2 text-sm text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"><X size={15} aria-hidden="true" />لغو ویرایش</button>}</div>
      </form>

      <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-lg sm:p-7">
        <h2 className="mb-4 text-xl font-semibold text-[var(--ui-text)]">کمپین‌های ثبت‌شده</h2>
        {campaigns.length === 0 ? <p className="text-sm text-[var(--ui-muted)]">هنوز کمپینی ثبت نشده است.</p> : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <article key={campaign._id} className="flex flex-col gap-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  {campaign.image ? <img src={campaign.image} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--ui-surface-raised)]"><Megaphone className="text-[var(--brand-primary)]" size={20} /></div>}
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ui-text)]">{campaign.title}</p>
                    <p className="mt-1 truncate text-xs text-[var(--ui-muted)]">{campaign.description || campaign.href}</p>
                    <p className="mt-1 text-xs text-[var(--ui-muted)]">{formatIranianDateTime(campaign.startsAt)} تا {formatIranianDateTime(campaign.endsAt)}</p>
                    <p className="mt-1 text-xs text-[var(--ui-muted)]">{new Intl.NumberFormat("fa-IR").format((campaign.productIds || []).length)} محصول مرتبط</p>
                    <p className="mt-1 text-xs text-[var(--ui-muted)]">مراجعه: {new Intl.NumberFormat("fa-IR").format(campaign.views || 0)} · کلیک دکمه اصلی: {new Intl.NumberFormat("fa-IR").format(campaign.clicks || 0)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Link to={getCampaignPath(campaign)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#fb923c] hover:text-[var(--ui-text)]">
                        بازکردن صفحه اختصاصی<ExternalLink size={13} aria-hidden="true" />
                      </Link>
                      <button type="button" onClick={() => copyCampaignLink(campaign)} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--ui-border)] px-2.5 text-xs text-[var(--ui-muted)] transition hover:border-[#fb923c] hover:text-[var(--ui-text)]">
                        <Copy size={13} aria-hidden="true" />کپی لینک عمومی
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={() => startEdit(campaign)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--ui-border)] px-3 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"><Pencil size={14} aria-hidden="true" />ویرایش</button>
                  <button type="button" onClick={() => toggleCampaign(campaign)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--ui-border)] px-3 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-hover)]">{campaign.isActive ? <Pause size={14} /> : <Play size={14} />}{campaign.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}</button>
                  <button type="button" onClick={() => removeCampaign(campaign)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-red-900 px-3 text-xs text-[var(--ui-danger)] hover:bg-red-950/40"><Trash2 size={14} />حذف</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default CampaignManager;

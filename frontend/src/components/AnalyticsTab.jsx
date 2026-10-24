import { useCallback, useEffect, useState } from "react";
import { Banknote, CalendarRange, LoaderCircle, Package, RefreshCw, ShoppingCart, Users, Download } from "lucide-react";
import { motion } from "framer-motion";
import axios from "../lib/axios";
import { formatPrice, getCurrencyLabel, STORE_CURRENCY } from "../lib/commerce";
import { formatIranianChartDate } from "../lib/iranian-date";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const ranges = [
  { value: 7, label: "۷ روز اخیر" },
  { value: 30, label: "۳۰ روز اخیر" },
  { value: 90, label: "۹۰ روز اخیر" },
  { value: 365, label: "۱۲ ماه اخیر" },
];
const numberFa = (value) => new Intl.NumberFormat("fa-IR").format(Number(value) || 0);

const AnalyticsTab = () => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [dailySalesData, setDailySalesData] = useState([]);
  const [days, setDays] = useState(7);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const loadAnalyticsData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await axios.get("/analytics", { params: { days } });
      setAnalyticsData(response.data.analyticsData || null);
      setDailySalesData(Array.isArray(response.data.dailySalesData) ? response.data.dailySalesData : []);
    } catch (requestError) {
      setAnalyticsData(null);
      setDailySalesData([]);
      setError(requestError.response?.data?.message || "بارگذاری گزارش آمار ناموفق بود. اتصال را بررسی و دوباره تلاش کنید.");
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => { loadAnalyticsData(); }, [loadAnalyticsData]);
  const hasSales = dailySalesData.some((point) => Number(point.sales) > 0 || Number(point.revenue) > 0);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await axios.get("/analytics/export", { params: { days }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "miba-sales-" + days + "d.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("دریافت فایل گزارش فروش ناموفق بود. بازه کوتاه‌تری انتخاب کنید یا دوباره تلاش کنید.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section dir="rtl" className="mx-auto max-w-7xl space-y-5 px-3 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-xs font-semibold text-[var(--ui-accent)]"><CalendarRange size={15} aria-hidden="true" /> گزارش فروش</p>
          <h2 className="text-2xl font-bold text-[var(--ui-text)]">آمار و تحلیل</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-muted)]">تعداد کاربران و محصولات مربوط به وضعیت فعلی فروشگاه است؛ فروش و درآمد مطابق بازه انتخابی محاسبه می‌شود.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--ui-muted)]">بازه فروش
            <span className="relative mt-1 block">
              <CalendarRange size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" aria-hidden="true" />
              <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="min-h-11 min-w-40 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] py-2 pl-3 pr-9 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)]">
                {ranges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
              </select>
            </span>
          </label>
          <button type="button" onClick={exportCsv} disabled={exporting} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ui-border)] px-4 text-sm font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-hover)] disabled:opacity-50">
            <Download size={15} aria-hidden="true" /> {exporting ? "در حال ساخت فایل…" : "خروجی CSV"}
          </button>
          <button type="button" onClick={loadAnalyticsData} disabled={isLoading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ui-border)] px-4 text-sm font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-hover)] disabled:opacity-50">
            <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} aria-hidden="true" /> تازه‌سازی
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-[var(--ui-danger)]">{error}</p>
          <button type="button" onClick={loadAnalyticsData} disabled={isLoading} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--ui-danger-border)] px-4 text-sm font-semibold text-[var(--ui-danger)] hover:bg-[var(--ui-danger-bg)] disabled:opacity-50">
            <RefreshCw size={14} aria-hidden="true" /> تلاش دوباره
          </button>
        </div>
      )}

      {isLoading && !analyticsData ? (
        <div role="status" className="flex min-h-64 items-center justify-center gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] text-sm text-[var(--ui-muted)]">
          <LoaderCircle size={22} className="animate-spin text-[var(--ui-accent)]" aria-hidden="true" /> در حال بارگذاری گزارش…
        </div>
      ) : analyticsData ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AnalyticsCard title="تعداد کاربران فعلی" value={numberFa(analyticsData.users)} icon={Users} />
            <AnalyticsCard title="تعداد محصولات فعلی" value={numberFa(analyticsData.products)} icon={Package} />
            <AnalyticsCard title={"سفارش‌های پرداخت‌شده · " + (ranges.find((range) => range.value === days)?.label || "")} value={numberFa(analyticsData.totalSales)} icon={ShoppingCart} />
            <AnalyticsCard title="مجموع مبلغ پرداخت‌شده" value={formatPrice(analyticsData.totalRevenue, STORE_CURRENCY)} icon={Banknote} />
          </div>
          <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-lg sm:p-6">
            <div className="mb-5">
              <h3 className="text-lg font-semibold text-[var(--ui-text)]">روند فروش و درآمد</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--ui-muted)]">این گزارش جمع فیلد مبلغ نهایی سفارش برای پرداخت‌های تأییدشده زرین‌پال را نشان می‌دهد؛ مبلغ پس از تخفیف و با هزینه ارسال است و بازپرداخت یا مرجوعی از آن کسر نشده است.</p>
            </div>
            {isLoading ? (
              <div role="status" className="flex min-h-64 items-center justify-center gap-3 text-sm text-[var(--ui-muted)]"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" /> در حال به‌روزرسانی بازه…</div>
            ) : !hasSales ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--ui-border)] px-5 text-center">
                <ShoppingCart size={28} className="text-[var(--ui-muted)]" aria-hidden="true" />
                <h4 className="mt-3 font-semibold text-[var(--ui-text)]">در این بازه فروش تأییدشده‌ای ثبت نشده است</h4>
                <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--ui-muted)]">این نتیجه پس از دریافت موفق گزارش نمایش داده می‌شود؛ در صورت انتظار فروش، بازه زمانی دیگری انتخاب کنید.</p>
              </div>
            ) : (
              <div className="h-[360px] w-full sm:h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailySalesData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-chart-grid)" />
                    <XAxis dataKey="date" stroke="var(--ui-chart-axis)" tickFormatter={formatIranianChartDate} minTickGap={24} />
                    <YAxis yAxisId="left" stroke="var(--ui-chart-axis)" allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" stroke="var(--ui-chart-axis)" />
                    <Tooltip labelFormatter={(label) => formatIranianChartDate(label)} formatter={(value, name) => [String(name).startsWith("درآمد") ? formatPrice(value, STORE_CURRENCY) : numberFa(value), name]} contentStyle={{ backgroundColor: "var(--ui-surface)", borderColor: "var(--ui-border)", borderRadius: 12, color: "var(--ui-text)" }} />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="sales" stroke="var(--ui-accent)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} name="سفارش‌های پرداخت‌شده" />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="var(--ui-chart-secondary)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} name={"مبلغ پرداخت‌شده (" + getCurrencyLabel(STORE_CURRENCY) + ")"} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      ) : !error ? (
        <div role="status" className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-8 text-center text-sm text-[var(--ui-muted)]">گزارشی برای نمایش وجود ندارد.</div>
      ) : null}
    </section>
  );
};

export default AnalyticsTab;

const AnalyticsCard = ({ title, value, icon: Icon }) => (
  <motion.article className="relative isolate min-w-0 overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-lg sm:p-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
    <div className="relative z-10 flex min-w-0 flex-col gap-2 pr-1 sm:pr-0">
      <p className="max-w-full break-words text-sm font-semibold leading-6 text-[var(--ui-accent)]">{title}</p>
      <p className="max-w-full break-words text-xl font-bold leading-tight tabular-nums text-[var(--ui-text)] [overflow-wrap:anywhere] sm:text-3xl">{value}</p>
    </div>
    <Icon className="pointer-events-none absolute bottom-3 left-3 h-8 w-8 text-[var(--ui-text)]/10 sm:bottom-4 sm:left-4 sm:h-10 sm:w-10" aria-hidden="true" />
  </motion.article>
);

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Database, LoaderCircle, RefreshCw, Server, Truck, Wallet } from "lucide-react";
import axios from "../lib/axios";
import { formatIranianDateTime } from "../lib/iranian-date";

const fmt = (value) => new Intl.NumberFormat("fa-IR").format(Number(value) || 0);
const labels = {
  database: { connected: "متصل", connecting: "در حال اتصال", disconnected: "قطع", disconnecting: "در حال قطع" },
  redis: { connected: "متصل", unavailable: "در دسترس نیست", unsupported: "تنظیم نشده", unexpected_response: "پاسخ نامعتبر" },
};

const OperationsDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get("/admin/operations");
      setData(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "دریافت وضعیت سامانه ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const Stat = ({ icon: Icon, title, value, detail }) => (
    <article className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--ui-muted)]">{title}</p>
        <Icon size={20} className="text-[var(--ui-accent)]" aria-hidden="true" />
      </div>
      <p className="mt-3 text-3xl font-bold text-[var(--ui-text)]">{fmt(value)}</p>
      {detail && <p className="mt-1 text-xs text-[var(--ui-muted)]">{detail}</p>}
    </article>
  );

  if (loading && !data) return <div role="status" className="flex min-h-40 items-center justify-center gap-3 text-sm text-[var(--ui-muted)]"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />در حال بررسی وضعیت سامانه…</div>;

  return (
    <section dir="rtl" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--ui-text)]"><Activity size={22} aria-hidden="true" />وضعیت سامانه و عملیات</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--ui-muted)]">شاخص‌های عملیاتی از دیتابیس و سفارش‌ها محاسبه می‌شوند؛ این صفحه جایگزین مانیتورینگ زیرساخت و اعلان هشدار نیست.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ui-border)] px-4 py-2 text-sm text-[var(--ui-text)] disabled:opacity-50"><RefreshCw size={16} aria-hidden="true" />به‌روزرسانی</button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-4 text-sm text-[var(--ui-danger)]">{error}</p>}
      {data && (
        <>
          <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${data.health?.status === "healthy" ? "border-[var(--ui-success-border)] bg-[var(--ui-success-bg)]" : "border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)]"}`}>
            {data.health?.status === "healthy" ? <CheckCircle2 className="text-[var(--ui-success)]" size={22} aria-hidden="true" /> : <AlertTriangle className="text-[var(--ui-warning)]" size={22} aria-hidden="true" />}
            <div>
              <p className="font-semibold text-[var(--ui-text)]">{data.health?.status === "healthy" ? "سرویس‌های پایه در دسترس هستند" : "وضعیت نیاز به بررسی دارد"}</p>
              <p className="mt-1 text-xs text-[var(--ui-muted)]">دیتابیس: {labels.database[data.health?.database] || data.health?.database} · Redis: {labels.redis[data.health?.redis] || data.health?.redis}</p>
              <p className="mt-1 text-xs text-[var(--ui-muted)]">آخرین بررسی: {data.generatedAt ? formatIranianDateTime(data.generatedAt) : "—"}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat icon={Wallet} title="پرداخت‌های در انتظار" value={data.payments?.pending} detail="نیازمند callback یا reconciliation" />
            <Stat icon={AlertTriangle} title="پرداخت‌شده‌های نهایی‌نشده" value={data.payments?.paidAwaitingFinalization} detail="نیازمند تکمیل پاک‌سازی سبد یا کوپن" />
            <Stat icon={Truck} title="سفارش‌های در صف ارسال" value={data.fulfillment?.paidAwaitingShipment} detail="در انتظار آماده‌سازی یا بسته‌بندی" />
            <Stat icon={AlertTriangle} title="ارسال بدون کد رهگیری" value={data.fulfillment?.shippedWithoutTracking} detail="سفارش‌های ارسال‌شده بدون کد رهگیری" />
            <Stat icon={Wallet} title="پرداخت ناموفق در ۲۴ ساعت" value={data.payments?.failedLast24Hours} />
            <Stat icon={Database} title="رویدادهای مدیریتی در ۲۴ ساعت" value={data.audit?.eventsLast24Hours} />
          </div>
        </>
      )}
      <div className="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4 text-xs leading-6 text-[var(--ui-muted)]">
        <Server size={18} className="shrink-0 text-[#9aa58e]" aria-hidden="true" />
        برای پایش کامل تولید، نمودار تأخیر و خطا، هشدار خودکار، فضای دیسک، مصرف CPU/RAM و وضعیت دامنه/SSL را نیز از طریق میزبان یا سرویس مانیتورینگ جداگانه تنظیم کنید.
      </div>
    </section>
  );
};

export default OperationsDashboard;

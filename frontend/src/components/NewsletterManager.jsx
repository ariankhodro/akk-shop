import { useEffect, useState } from "react";
import { Mail, RefreshCw, Users } from "lucide-react";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import { formatIranianDate } from "../lib/iranian-date";

const NewsletterManager = () => {
  const [subscribers, setSubscribers] = useState([]);
  const [summary, setSummary] = useState({ total: 0, subscribed: 0 });
  const [loading, setLoading] = useState(true);

  const loadSubscribers = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get("/newsletter/admin");
      setSubscribers(Array.isArray(data.subscribers) ? data.subscribers : []);
      setSummary(data.summary || { total: 0, subscribed: 0 });
    } catch (error) {
      toast.error(error.response?.data?.message || "دریافت اعضای خبرنامه ناموفق بود");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSubscribers(); }, []);

  return (
    <section dir="rtl" className="mx-auto max-w-6xl space-y-5">
      <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-lg sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#9aa58e]"><Mail size={21} aria-hidden="true" /><h2 className="text-xl font-semibold text-[var(--ui-text)]">اعضای خبرنامه</h2></div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-muted)]">ایمیل‌هایی که با رضایت ثبت شده‌اند. سرویس ارسال خبرنامه هنوز متصل نیست؛ این صفحه فقط فهرست و وضعیت عضویت را نمایش می‌دهد.</p>
          </div>
          <button type="button" disabled={loading} onClick={loadSubscribers} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ui-border)] px-4 py-2 text-sm font-semibold text-[var(--ui-text)] transition hover:bg-[var(--ui-hover)] disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" />به‌روزرسانی</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4"><p className="text-xs text-[var(--ui-muted)]">کل نشانی‌های ثبت‌شده</p><p className="mt-2 text-2xl font-semibold text-[var(--ui-text)] tabular-nums">{new Intl.NumberFormat("fa-IR").format(summary.total || 0)}</p></div>
          <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4"><p className="text-xs text-[var(--ui-muted)]">عضویت فعال</p><p className="mt-2 text-2xl font-semibold text-[#9aa58e] tabular-nums">{new Intl.NumberFormat("fa-IR").format(summary.subscribed || 0)}</p></div>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-lg">
        <div className="flex items-center justify-between border-b border-[var(--ui-border)] px-4 py-3 sm:px-6">
          <h3 className="flex items-center gap-2 font-semibold text-[var(--ui-text)]"><Users size={17} className="text-[#9aa58e]" aria-hidden="true" />فهرست اعضا</h3>
          <span className="text-xs text-[var(--ui-muted)]">حداکثر ۵۰۰ مورد اخیر</span>
        </div>
        {loading ? <p role="status" className="p-6 text-center text-sm text-[var(--ui-muted)]">در حال دریافت فهرست…</p> : subscribers.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full divide-y divide-[var(--ui-border)]">
              <thead className="bg-[var(--ui-surface-raised)]/60"><tr>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ui-muted)]">ایمیل</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ui-muted)]">تاریخ ثبت</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ui-muted)]">رضایت ثبت‌شده</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ui-muted)]">وضعیت عضویت</th>
              </tr></thead>
              <tbody className="divide-y divide-[var(--ui-border)]">
                {subscribers.map((subscriber) => (
                  <tr key={subscriber._id} className="hover:bg-[var(--ui-hover)]">
                    <td className="px-4 py-3 text-sm text-[var(--ui-text)]" dir="ltr">{subscriber.email}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ui-muted)]">{formatIranianDate(subscriber.createdAt)}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ui-muted)]">{formatIranianDate(subscriber.consentedAt)}</td>
                    <td className="px-4 py-3"><span className={"inline-flex rounded-full px-2.5 py-1 text-xs font-semibold " + (subscriber.isSubscribed ? "bg-[#dce2d4] text-[#41443b]" : "bg-[var(--ui-surface-raised)] text-[var(--ui-muted)]")}>{subscriber.isSubscribed ? "فعال" : "لغوشده"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="p-6 text-center text-sm text-[var(--ui-muted)]">هنوز درخواستی برای عضویت ثبت نشده است.</p>}
      </div>
    </section>
  );
};

export default NewsletterManager;

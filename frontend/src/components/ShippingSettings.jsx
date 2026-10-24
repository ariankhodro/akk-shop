import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import { formatPrice, getCurrencyLabel } from "../lib/commerce";

const ShippingSettings = () => {
  const [form, setForm] = useState({ flatRate: "0", freeShippingThreshold: "0" });
  const [currency, setCurrency] = useState("IRT");
  const [loading, setLoading] = useState(false);
  const currencyLabel = getCurrencyLabel(currency);

  useEffect(() => {
    axios.get("/shipping?subtotal=0").then(({ data }) => {
      setForm({
        flatRate: String(data.flatRate ?? 0),
        freeShippingThreshold: String(data.freeShippingThreshold ?? 0),
      });
      setCurrency(data.currency || "IRT");
    }).catch((error) => toast.error(error.response?.data?.message || "بارگذاری تنظیمات ارسال ناموفق بود"));
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const flatRate = Number(form.flatRate);
    const freeShippingThreshold = Number(form.freeShippingThreshold);
    if (!Number.isFinite(flatRate) || flatRate < 0 || !Number.isFinite(freeShippingThreshold) || freeShippingThreshold < 0) {
      toast.error("مقادیر ارسال باید عددی مثبت یا صفر باشند");
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.put("/shipping", { flatRate, freeShippingThreshold });
      setForm({ flatRate: String(data.flatRate), freeShippingThreshold: String(data.freeShippingThreshold) });
      toast.success("قوانین ارسال ذخیره شد");
    } catch (error) {
      toast.error(error.response?.data?.message || "ذخیره قوانین ارسال ناموفق بود");
    } finally {
      setLoading(false);
    }
  };

  const fieldClass = "mt-1 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-3 py-2 text-[var(--ui-text)] outline-none focus:border-[var(--ui-accent)] focus:ring-2 focus:ring-[var(--ui-focus)]/25";
  return (
    <section dir="rtl" className="mx-auto max-w-3xl rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-lg sm:p-7">
      <div className="mb-6 flex items-center gap-3">
        <Truck className="h-6 w-6 text-[var(--ui-accent)]" aria-hidden="true" />
        <div>
          <h2 className="text-xl font-semibold text-[var(--ui-text)]">قوانین ارسال سفارش</h2>
          <p className="mt-1 text-sm text-[var(--ui-muted)]">مقادیر بر اساس واحد پول فروشگاه محاسبه می‌شوند.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="block text-sm text-[var(--ui-muted)]">هزینه ثابت ارسال ({currencyLabel})
          <input type="number" min="0" step="1" required className={fieldClass} value={form.flatRate} onChange={(event) => setForm({ ...form, flatRate: event.target.value })} />
        </label>
        <label className="block text-sm text-[var(--ui-muted)]">حداقل مبلغ برای ارسال رایگان ({currencyLabel})
          <input type="number" min="0" step="1" required className={fieldClass} value={form.freeShippingThreshold} onChange={(event) => setForm({ ...form, freeShippingThreshold: event.target.value })} />
        </label>
        <p className="text-sm leading-6 text-[var(--ui-muted)]">نمونه: هزینه ارسال {formatPrice(Number(form.flatRate), currency)} و ارسال رایگان برای سفارش‌های حداقل {formatPrice(Number(form.freeShippingThreshold), currency)}. مقدار صفر برای حداقل خرید، قانون ارسال رایگان را غیرفعال می‌کند.</p>
        <button type="submit" disabled={loading} className="min-h-11 rounded-full bg-[var(--ui-accent)] px-6 py-2 text-sm font-semibold text-[var(--ui-button-text)] transition hover:bg-[var(--ui-accent-hover)] disabled:opacity-50">{loading ? "در حال ذخیره…" : "ذخیره قوانین ارسال"}</button>
      </form>
    </section>
  );
};
export default ShippingSettings;

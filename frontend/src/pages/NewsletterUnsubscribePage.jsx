import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import axios from "../lib/axios";

const NewsletterUnsubscribePage = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const response = await axios.post("/newsletter/unsubscribe", { email });
      setMessage(response.data?.message || "درخواست لغو عضویت ثبت شد.");
      setEmail("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "لغو عضویت انجام نشد. بعداً دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main dir="rtl" className="min-h-[60vh] bg-[#f7f5f0] px-4 py-12 text-[#252722] sm:py-16">
      <section className="mx-auto max-w-xl rounded-3xl border border-[#e4e0d8] bg-[#fffefa] p-6 shadow-sm sm:p-9">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e9ede4] text-[#68745f]"><Mail size={22} aria-hidden="true" /></span>
        <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">لغو عضویت خبرنامه</h1>
        <p className="mt-3 text-sm leading-7 text-[#62645c]">ایمیلی را وارد کنید که قبلاً برای خبرنامه ثبت کرده‌اید. اگر با آن نشانی عضویتی وجود داشته باشد، درخواست توقف عضویت اعمال می‌شود.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <label htmlFor="unsubscribe-email" className="block text-sm font-semibold">نشانی ایمیل</label>
          <input id="unsubscribe-email" type="email" required maxLength={254} autoComplete="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-12 w-full rounded-xl border border-[#d5d0c5] bg-white px-3 py-2 text-left text-sm outline-none transition focus:border-[#68745f] focus:ring-4 focus:ring-[#68745f]/10" placeholder="name@example.com" />
          <button type="submit" disabled={loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#252722] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#41443b] disabled:opacity-50">{loading ? "در حال ثبت…" : "لغو عضویت"}<ArrowLeft size={16} aria-hidden="true" /></button>
        </form>
        {message && <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-[#d5dcca] bg-[#f6f8f2] p-3 text-sm leading-6 text-[#41443b]"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[#68745f]" aria-hidden="true" />{message}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}
        <Link to="/" className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#68745f] hover:text-[#252722]"><ArrowLeft size={15} aria-hidden="true" />بازگشت به فروشگاه</Link>
      </section>
    </main>
  );
};

export default NewsletterUnsubscribePage;

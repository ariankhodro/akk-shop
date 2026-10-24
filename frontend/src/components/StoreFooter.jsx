import { useState } from "react";
import { ArrowLeft, CheckCircle2, Heart, Instagram, Mail, Send, ShieldCheck, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import { formatIranianYear } from "../lib/iranian-date";

const supportEmail = import.meta.env.VITE_STORE_SUPPORT_EMAIL || "";
const enamadImage = import.meta.env.VITE_ENAMAD_SEAL_IMAGE_URL || "https://trustseal.enamad.ir/Content/Images/Star2/81.png";
const enamadVerificationUrl = import.meta.env.VITE_ENAMAD_SEAL_LINK_URL || "";
const socialProfiles = [
  { id: "instagram", label: "اینستاگرام", href: import.meta.env.VITE_STORE_INSTAGRAM_URL || "", Icon: Instagram },
  { id: "telegram", label: "تلگرام", href: import.meta.env.VITE_STORE_TELEGRAM_URL || "", Icon: Send },
  { id: "x", label: "ایکس (X)", href: import.meta.env.VITE_STORE_X_URL || "", Icon: null },
];

const StoreFooter = () => {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const subscribe = async (event) => {
    event.preventDefault();
    setResult("");
    if (!consent) {
      toast.error("برای ثبت درخواست، رضایت خود را تأیید کنید.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.post("/newsletter/subscribe", { email, consent: true });
      setResult(response.data?.message || "درخواست شما ثبت شد.");
      setEmail("");
      setConsent(false);
    } catch (error) {
      toast.error(error.response?.data?.message || "ثبت درخواست خبرنامه انجام نشد.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <footer dir="rtl" className="mt-12 border-t border-[#dcd8ce] bg-[#ebe8df] text-[#252722] sm:mt-16">
      <div className="mx-auto grid max-w-[1920px] gap-9 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-[1.2fr_0.8fr_0.8fr_1.3fr] lg:gap-8 lg:px-8 2xl:px-12">
        <section>
          <Link to="/" className="inline-flex rounded-sm font-serif text-2xl font-semibold tracking-tight transition hover:text-[#68745f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#68745f]">تیک بوتیک</Link>
          <p className="mt-3 max-w-xs text-sm leading-7 text-[#62645c]">انتخاب‌های سنجیده برای استایل روزمره؛ با اطلاعات روشن درباره محصول، موجودی و هزینه ارسال.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/shop" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#252722] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#41443b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]">شروع خرید <ArrowLeft size={14} aria-hidden="true" /></Link>
            <Link to="/wishlist" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d5d0c5] bg-[#fffefa] px-4 py-2 text-xs font-semibold text-[#41443b] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]"><Heart size={14} aria-hidden="true" />علاقه‌مندی‌ها</Link>
          </div>
          <div className="mt-5 border-t border-[#d5d0c5] pt-4">
            <p className="text-xs font-semibold text-[#41443b]">ما را دنبال کنید</p>
            <div className="mt-2 flex items-center gap-2" aria-label="شبکه‌های اجتماعی تیک بوتیک">
              {socialProfiles.map(({ id, label, href, Icon }) => {
                const icon = Icon ? <Icon size={18} aria-hidden="true" /> : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M18.9 2H22l-6.78 7.75L23.2 22h-6.25l-4.9-7.39L5.58 22H2.45l7.25-8.29L1.8 2h6.4l4.43 6.77L18.9 2Zm-1.1 18h1.73L7.28 3.89H5.42L17.8 20Z" />
                  </svg>
                );
                return href ? (
                  <a key={id} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d5d0c5] bg-[#fffefa] text-[#41443b] transition hover:border-[#68745f] hover:text-[#68745f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]">
                    {icon}
                  </a>
                ) : (
                  <span key={id} title={"برای فعال‌سازی، نشانی " + label + " را در تنظیمات سایت وارد کنید."} aria-label={label + " (نشانی تنظیم نشده)"}
                    className="inline-flex h-10 w-10 cursor-not-allowed items-center justify-center rounded-full border border-[#d5d0c5] bg-white/50 text-[#85867d]">
                    {icon}
                  </span>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[#85867d]">پیوندهای شبکه‌های اجتماعی از تنظیمات سایت خوانده می‌شوند.</p>
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#d5d0c5] bg-[#fffefa] p-3">
              {enamadVerificationUrl ? (
                <a href={enamadVerificationUrl} target="_blank" rel="noopener noreferrer" aria-label="استعلام نماد اعتماد الکترونیکی تیک بوتیک"
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#68745f]">
                  <img src={enamadImage} alt="نماد اعتماد الکترونیکی" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 object-contain" />
                </a>
              ) : (
                <span aria-label="تصویر عمومی نماد اعتماد الکترونیکی؛ لینک اختصاصی اعتبارسنجی هنوز تنظیم نشده است"
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-1">
                  <img src={enamadImage} alt="تصویر نماد اعتماد الکترونیکی" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 object-contain" />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#41443b]">نماد اعتماد الکترونیکی</p>
                <p className="mt-1 text-[11px] leading-5 text-[#77786f]">
                  {enamadVerificationUrl
                    ? "برای مشاهده وضعیت و اطلاعات نماد، روی تصویر کلیک کنید."
                    : "برای اعتبارسنجی رسمی فروشگاه، لینک اختصاصی اینماد را در VITE_ENAMAD_SEAL_LINK_URL تنظیم کنید."}
                </p>
              </div>
            </div>
          </div>
        </section>

        <nav aria-label="راهنمای خرید">
          <h2 className="text-sm font-bold">راهنمای خرید</h2>
          <ul className="mt-4 space-y-3 text-sm text-[#62645c]">
            <li><Link className="transition hover:text-[#252722]" to="/shipping-policy">ارسال و تحویل</Link></li>
            <li><Link className="transition hover:text-[#252722]" to="/returns-policy">مرجوعی و تعویض</Link></li>
            <li><Link className="transition hover:text-[#252722]" to="/faq">سؤالات متداول</Link></li>
            <li><Link className="transition hover:text-[#252722]" to="/support">پشتیبانی و تماس</Link></li>
          </ul>
        </nav>

        <nav aria-label="قوانین فروشگاه">
          <h2 className="text-sm font-bold">قوانین و اطلاعات</h2>
          <ul className="mt-4 space-y-3 text-sm text-[#62645c]">
            <li><Link className="transition hover:text-[#252722]" to="/privacy-policy">حریم خصوصی</Link></li>
            <li><Link className="transition hover:text-[#252722]" to="/terms-of-use">شرایط استفاده</Link></li>
            <li><Link className="transition hover:text-[#252722]" to="/newsletter-unsubscribe">لغو عضویت خبرنامه</Link></li>
          </ul>
          <div className="mt-5 rounded-xl border border-[#d5d0c5] bg-white/60 p-3">
            <div className="flex items-start gap-2 text-xs leading-5 text-[#62645c]"><Truck size={15} className="mt-0.5 shrink-0 text-[#68745f]" aria-hidden="true" /><span>هزینه ارسال و شرط ارسال رایگان در زمان خرید نمایش داده می‌شود.</span></div>
            <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-[#62645c]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#68745f]" aria-hidden="true" /><span>نتیجه پرداخت در سمت سرور بررسی می‌شود.</span></div>
          </div>
        </nav>

        <section>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#dce2d4] text-[#68745f]"><Mail size={18} aria-hidden="true" /></span>
            <div><h2 className="text-base font-semibold">خبرنامه تیک بوتیک</h2><p className="mt-1 text-xs text-[#77786f]">خبرهای مجموعه و اطلاعیه‌های تازه</p></div>
          </div>
          <form onSubmit={subscribe} className="mt-4 space-y-3">
            <label htmlFor="newsletter-email" className="sr-only">نشانی ایمیل</label>
            <div className="flex min-h-12 overflow-hidden rounded-xl border border-[#d5d0c5] bg-[#fffefa] p-1 transition focus-within:border-[#68745f] focus-within:ring-4 focus-within:ring-[#68745f]/10">
              <input id="newsletter-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ایمیل شما" dir="ltr" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-left text-sm outline-none placeholder:text-[#9a9a90]" />
              <button type="submit" disabled={submitting} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#252722] px-3 text-xs font-semibold text-white transition hover:bg-[#41443b] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4">{submitting ? "در حال ثبت…" : "ثبت درخواست"}<ArrowLeft size={14} aria-hidden="true" /></button>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-5 text-[#62645c]">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required className="mt-1 h-3.5 w-3.5 shrink-0 accent-[#68745f]" />
              <span>با ثبت ایمیل، با ذخیره نشانی برای خبرنامه موافقم. می‌توانم از صفحه <Link to="/newsletter-unsubscribe" className="font-semibold text-[#526149] underline underline-offset-2">لغو عضویت</Link> درخواست توقف عضویت بدهم.</span>
            </label>
          </form>
          {result && <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-[#d5dcca] bg-[#f6f8f2] p-3 text-xs leading-5 text-[#41443b]"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#68745f]" aria-hidden="true" />{result}</p>}
          <p className="mt-3 text-[11px] leading-5 text-[#85867d]">در حال حاضر درخواست عضویت ذخیره می‌شود؛ ارسال ایمیل‌های خبرنامه تا اتصال سرویس ایمیل فعال نیست.</p>
          <p className="mt-4 text-xs leading-5 text-[#62645c]">{supportEmail ? <>پشتیبانی: <a href={`mailto:${supportEmail}`} className="font-semibold underline underline-offset-2 hover:text-[#252722]" dir="ltr">{supportEmail}</a></> : <>نشانی ایمیل رسمی پشتیبانی هنوز در تنظیمات فروشگاه ثبت نشده است. <Link to="/support" className="font-semibold text-[#526149] underline underline-offset-2">اطلاعات پشتیبانی</Link></>}</p>

        </section>
      </div>
      <div className="border-t border-[#d5d0c5]">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-2 px-4 py-4 text-[11px] leading-5 text-[#77786f] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 2xl:px-12">
          <p>© {formatIranianYear()} تیک بوتیک. تمامی حقوق مادی و معنوی وب‌سایت، محتوای آن و نشان تجاری «تیک بوتیک» محفوظ است.</p>
          <p>هرگونه نسخه‌برداری، بازنشر یا استفاده تجاری از محتوا بدون مجوز کتبی ممنوع است.</p>
        </div>
      </div>
    </footer>
  );
};

export default StoreFooter;

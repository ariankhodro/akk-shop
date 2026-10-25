import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BadgeCheck, Building2, CarFront, CheckCircle2, Clock3, CreditCard, Mail, PackageCheck, Search, ShieldCheck, Truck, Wrench } from "lucide-react";
import axios from "../lib/axios";
import { formatPrice } from "../lib/commerce";
import PageMeta from "../components/PageMeta";

const supportEmail = import.meta.env.VITE_STORE_SUPPORT_EMAIL || "";

const categoryLinks = [
  ["/shipping-policy", "ارسال و تحویل"],
  ["/returns-policy", "مرجوعی و گارانتی"],
  ["/faq", "سؤالات متداول"],
  ["/support", "پشتیبانی"],
  ["/privacy-policy", "حریم خصوصی"],
  ["/terms-of-use", "شرایط استفاده"],
];

const PageLayout = ({ eyebrow, title, intro, children }) => {
  const { pathname } = useLocation();
  return (
    <main dir="rtl" className="min-h-[60vh] bg-[#f5f6f8] px-3 py-8 text-[#1c1f24] sm:px-6 sm:py-12 lg:px-8">
      <PageMeta title={title} description={intro || (title + " | راهنمای فروشگاه میبا.")} path={pathname} breadcrumbs={[{ name: "صفحه اصلی", path: "/" }, { name: title, path: pathname }]} />
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 text-xs font-semibold tracking-wide text-[#ea580c]">{eyebrow}</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {intro && <p className="mt-3 max-w-3xl text-sm leading-7 text-[#5a606a] sm:text-base">{intro}</p>}
        <div className="mt-7 space-y-4">{children}</div>
        <nav aria-label="صفحات راهنما" className="mt-9 flex flex-wrap gap-2 border-t border-[#e2e5ea] pt-5">
          {categoryLinks.filter(([href]) => href !== pathname).map(([href, label]) => (
            <Link key={href} to={href} className="inline-flex min-h-9 items-center rounded-full border border-[#d2d6dc] bg-[#ffffff] px-3 py-2 text-xs font-semibold text-[#5a606a] transition hover:border-[#a8adb4] hover:text-[#1c1f24]">{label}</Link>
          ))}
        </nav>
        {supportEmail && <p className="mt-5 text-sm text-[#5a606a]">راه ارتباط با پشتیبانی: <a href={`mailto:${supportEmail}`} className="font-semibold underline underline-offset-2" dir="ltr">{supportEmail}</a></p>}
      </div>
    </main>
  );
};

const InfoCard = ({ id, title, children, icon: Icon = CheckCircle2 }) => (
  <section id={id} className="scroll-mt-32 rounded-2xl border border-[#e2e5ea] bg-[#ffffff] p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff1e7] text-[#ea580c]"><Icon size={19} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 space-y-2 text-sm leading-7 text-[#5a606a]">{children}</div>
      </div>
    </div>
  </section>
);

const StoreInfoPage = () => {
  const { pathname } = useLocation();
  const [shipping, setShipping] = useState({ loading: true, error: false, flatRate: 0, freeShippingThreshold: 0, currency: "IRT" });

  useEffect(() => {
    if (pathname !== "/shipping-policy") return undefined;
    let active = true;
    axios.get("/shipping?subtotal=0")
      .then(({ data }) => {
        if (!active) return;
        setShipping({ loading: false, error: false, flatRate: Number(data.flatRate || 0), freeShippingThreshold: Number(data.freeShippingThreshold || 0), currency: String(data.currency || "IRT").toUpperCase() });
      })
      .catch(() => { if (active) setShipping((current) => ({ ...current, loading: false, error: true })); });
    return () => { active = false; };
  }, [pathname]);

  if (pathname === "/shipping-policy") {
    return (
      <PageLayout eyebrow="راهنمای خرید" title="ارسال و تحویل" intro="هزینه ارسال طبق تنظیمات فعلی فروشگاه محاسبه می‌شود و مبلغ نهایی پیش از پرداخت در سبد خرید نمایش داده می‌شود.">
        <InfoCard title="هزینه ارسال" icon={Truck}>
          {shipping.loading ? <p>در حال دریافت قوانین ارسال…</p> : shipping.error ? <p>دریافت تنظیمات ارسال موقتاً امکان‌پذیر نیست. مبلغ نهایی را پیش از پرداخت در سبد خرید بررسی کنید.</p> : <>
            <p>هزینه ثابت فعلی: <strong className="font-semibold text-[#1c1f24]">{formatPrice(shipping.flatRate, shipping.currency)}</strong></p>
            {shipping.freeShippingThreshold > 0
              ? <p>ارسال رایگان برای سفارش‌هایی با مبلغ کالا پس از تخفیف، حداقل <strong className="font-semibold text-[#1c1f24]">{formatPrice(shipping.freeShippingThreshold, shipping.currency)}</strong> است.</p>
              : <p>حداقل مبلغ برای فعال‌شدن ارسال رایگان تعریف نشده است.</p>}
            {shipping.flatRate === 0 && <p>طبق تنظیمات فعلی، هزینه ثابت ارسال صفر است؛ مبلغ نهایی همچنان در سبد خرید تأیید می‌شود.</p>}
          </>}
        </InfoCard>
        <InfoCard title="زمان و محدوده تحویل" icon={Clock3}>
          <p>سفارش‌ها به سراسر ایران از طریق پست یا باربری ارسال می‌شوند. قطعات حجیم (مانند سپر، رادیاتور یا چراغ) ممکن است با باربری و با هماهنگی تلفنی ارسال شوند.</p>
          <p>زمان آماده‌سازی به موجودی انبار بستگی دارد؛ پس از ارسال، شرکت حمل و کد رهگیری در صفحه «سفارش‌های من» نمایش داده می‌شود. برای سفارش‌های فوری یا عمده، پیش از پرداخت با پشتیبانی هماهنگ کنید.</p>
        </InfoCard>
        <InfoCard title="پیگیری سفارش" icon={PackageCheck}>
          <p>بعد از پرداخت، نتیجه تراکنش در سمت سرور بررسی می‌شود و مراحل آماده‌سازی، بسته‌بندی و ارسال در <Link to="/orders" className="font-semibold text-[#c2410c] underline underline-offset-2">سفارش‌های من</Link> قابل پیگیری است. در صورت بروز مشکل، شناسه سفارش را نگه دارید و با پشتیبانی تماس بگیرید.</p>
        </InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/returns-policy") {
    return (
      <PageLayout eyebrow="راهنمای خرید" title="مرجوعی و گارانتی" intro="شرایط بازگشت قطعه و گارانتی را پیش از خرید بخوانید؛ مدت گارانتی هر قطعه در صفحه همان قطعه درج شده است.">
        <InfoCard title="بازگشت قطعه نصب‌نشده" icon={PackageCheck}>
          <p>قطعه‌ای که نصب یا استفاده نشده، بسته‌بندی و برچسب اصلی آن سالم است و با خودروی شما سازگار نبوده، تا ۷ روز پس از تحویل با هماهنگی پشتیبانی قابل بازگشت است.</p>
          <p>اگر به‌خاطر خطای میبا (ارسال قطعه اشتباه یا معیوب) نیاز به بازگشت باشد، هزینه ارسال برگشت بر عهده فروشگاه است.</p>
        </InfoCard>
        <InfoCard title="قطعات برقی و قطعات نصب‌شده" icon={Wrench}>
          <p>قطعات برقی و الکترونیکی (مانند سنسور، کوئل، ECU و رله) و هر قطعه‌ای که نصب شده باشد، فقط در قالب گارانتی و پس از بررسی کارشناس فنی پذیرفته می‌شوند.</p>
          <p>آسیب ناشی از نصب نادرست، تصادف یا استفاده خارج از کاربرد قطعه مشمول گارانتی نیست؛ نصب در تعمیرگاه معتبر توصیه می‌شود.</p>
        </InfoCard>
        <InfoCard title="گارانتی" icon={BadgeCheck}>
          <p>مدت گارانتی (در صورت وجود) روی صفحه هر قطعه نمایش داده می‌شود. برای استفاده از گارانتی، شناسه سفارش، تصویر قطعه و توضیح ایراد را برای پشتیبانی بفرستید.</p>
        </InfoCard>
        <InfoCard title="در صورت مغایرت یا آسیب" icon={ShieldCheck}>
          <p>اگر قطعه دریافتی با کد فنی سفارش مغایرت دارد یا بسته آسیب‌دیده است، پیش از نصب از کالا و بسته‌بندی عکس بگیرید و در اولین فرصت با پشتیبانی تماس بگیرید.</p>
        </InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/support") {
    return (
      <PageLayout eyebrow="در کنار شما" title="پشتیبانی و تماس" intro="برای انتخاب قطعه درست، پیگیری سفارش یا درخواست حساب همکاری، با کارشناسان میبا در تماس باشید.">
        <InfoCard title="راه ارتباطی فروشگاه" icon={Mail}>
          {supportEmail
            ? <p>ایمیل پشتیبانی: <a href={`mailto:${supportEmail}`} className="font-semibold text-[#1c1f24] underline underline-offset-2" dir="ltr">{supportEmail}</a></p>
            : <p>نشانی ایمیل یا شماره تماس رسمی هنوز در تنظیمات فروشگاه ثبت نشده است؛ برای فعال‌شدن این بخش، مقدار VITE_STORE_SUPPORT_EMAIL باید در تنظیمات فرانت‌اند ثبت شود.</p>}
          <p>در پیام خود شناسه سفارش (در صورت وجود)، ایمیل حساب و توضیح کوتاه مشکل را ذکر کنید؛ هرگز رمز عبور یا اطلاعات کامل کارت بانکی را ارسال نکنید.</p>
        </InfoCard>
        <InfoCard title="مشاوره انتخاب قطعه" icon={CarFront}>
          <p>اگر از سازگاری قطعه مطمئن نیستید، کد فنی قطعه قدیمی (روی خود قطعه یا بسته‌بندی) یا شماره شاسی (VIN) خودرو، مدل و سال ساخت را برای پشتیبانی بفرستید تا قطعه مناسب معرفی شود.</p>
        </InfoCard>
        <InfoCard id="wholesale-account" title="درخواست حساب همکاری (عمده)" icon={Building2}>
          <p>فروشگاه‌های لوازم یدکی، تعمیرگاه‌ها و ناوگان‌ها می‌توانند با قیمت عمده خرید کنند. حساب عمده ثبت‌نام عمومی ندارد و فقط توسط کارشناسان میبا ساخته می‌شود.</p>
          <p>برای درخواست، نام فروشگاه یا شرکت، شهر، شماره تماس، شناسه ملی یا کد اقتصادی و ایمیلی که می‌خواهید با آن وارد شوید را برای پشتیبانی بفرستید. پس از بررسی، اطلاعات ورود و رمز موقت برایتان ارسال می‌شود که در اولین ورود باید آن را تغییر دهید.</p>
          <p>اگر حساب همکاری دارید، از <Link to="/login?wholesale=1" className="font-semibold text-[#c2410c] underline underline-offset-2">ورود همکاران</Link> وارد شوید.</p>
        </InfoCard>
        <InfoCard title="پاسخ‌های سریع" icon={CheckCircle2}>
          <p>هزینه و شرط ارسال رایگان در <Link to="/shipping-policy" className="font-semibold text-[#c2410c] underline underline-offset-2">صفحه ارسال</Link> و سؤالات رایج در <Link to="/faq" className="font-semibold text-[#c2410c] underline underline-offset-2">سؤالات متداول</Link> آمده‌اند.</p>
        </InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/faq") {
    return (
      <PageLayout eyebrow="راهنما" title="سؤالات متداول" intro="پاسخ پرسش‌های رایج درباره انتخاب قطعه، خرید عمده، ارسال و پرداخت.">
        <InfoCard title="چطور مطمئن شوم قطعه با خودروی من سازگار است؟" icon={CarFront}><p>در صفحه هر قطعه، فهرست خودروهای سازگار (برند، مدل، سال و موتور) و کد فنی OEM آمده است. از جستجوی «قطعه مناسب خودروی شما» در صفحه اصلی استفاده کنید یا کد فنی قطعه قدیمی را جستجو کنید.</p></InfoCard>
        <InfoCard title="جستجو با کد فنی چگونه است؟" icon={Search}><p>کد فنی یا شماره OEM را با خط تیره یا بدون آن وارد کنید (مثلاً T11-3501080 یا T113501080)؛ هر دو شکل پیدا می‌شوند. اگر نتیجه‌ای نیافتید، کد را همراه شماره شاسی (VIN) برای پشتیبانی بفرستید.</p></InfoCard>
        <InfoCard title="تفاوت قطعه اصلی، OEM و تجاری چیست؟" icon={BadgeCheck}><p>«اصلی (جنیون)» با برند سازنده خودرو عرضه می‌شود؛ «OEM» ساخت همان تأمین‌کننده خط تولید است؛ «تجاری» ساخت برندهای معتبر دیگر با قیمت مناسب‌تر است. کیفیت هر قطعه روی کارت و صفحه آن مشخص شده است.</p></InfoCard>
        <InfoCard title="چطور حساب عمده بگیرم؟" icon={Building2}><p>حساب همکاری فقط توسط کارشناسان میبا ساخته می‌شود. مراحل درخواست در <Link to="/support#wholesale-account" className="font-semibold text-[#c2410c] underline underline-offset-2">صفحه پشتیبانی</Link> آمده است. پس از ورود، قیمت عمده و حداقل تعداد هر قطعه را می‌بینید.</p></InfoCard>
        <InfoCard title="هزینه ارسال را کجا می‌بینم؟" icon={Truck}><p>هزینه فعلی و شرط ارسال رایگان در <Link to="/shipping-policy" className="font-semibold text-[#c2410c] underline underline-offset-2">صفحه ارسال</Link> قابل مشاهده است و هزینه نهایی پیش از پرداخت در سبد خرید نمایش داده می‌شود.</p></InfoCard>
        <InfoCard title="می‌توانم بدون ورود قطعه به سبد اضافه کنم؟" icon={PackageCheck}><p>بله، می‌توانید به‌عنوان مهمان سبد خرید را بسازید و بعداً وارد حساب شوید. برای ثبت سفارش و پرداخت، ورود به حساب لازم است.</p></InfoCard>
        <InfoCard title="پرداخت من چطور تأیید می‌شود؟" icon={CreditCard}><p>پرداخت در درگاه رسمی زرین‌پال انجام می‌شود و نتیجه تراکنش در سمت سرور تأیید می‌شود؛ تا پیش از تأیید، سفارش نهایی نیست.</p></InfoCard>
        <InfoCard title="شرایط مرجوعی چیست؟" icon={ShieldCheck}><p>قطعه نصب‌نشده با بسته‌بندی سالم تا ۷ روز قابل بازگشت است؛ جزئیات در <Link to="/returns-policy" className="font-semibold text-[#c2410c] underline underline-offset-2">مرجوعی و گارانتی</Link> آمده است.</p></InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/privacy-policy") {
    return (
      <PageLayout eyebrow="اطلاعات فروشگاه" title="حریم خصوصی" intro="این توضیحات نشان می‌دهد قابلیت‌های فعلی فروشگاه چه اطلاعاتی را برای کارکرد خود نگه می‌دارند.">
        <InfoCard title="اطلاعات حساب و سفارش" icon={ShieldCheck}><p>برای حساب کاربری، نشانی ایمیل و نام حساب ذخیره می‌شود. سبد خرید، نشانی‌های ارسال و اطلاعات سفارش برای اجرای خرید و نمایش وضعیت آن در پایگاه داده نگهداری می‌شود. برای حساب‌های همکاری، اطلاعات کسب‌وکار (نام فروشگاه، شهر، شماره تماس و شناسه ملی/کد اقتصادی) نیز نگهداری می‌شود و فقط کارشناسان مجاز به آن دسترسی دارند.</p></InfoCard>
        <InfoCard title="ذخیره‌سازی در مرورگر" icon={CheckCircle2}><p>سبد مهمان و فهرست علاقه‌مندی‌ها در حافظه محلی مرورگر ذخیره می‌شوند. با پاک‌کردن داده‌های سایت یا استفاده از دستگاه/مرورگر دیگر، این اطلاعات محلی ممکن است در دسترس نباشند.</p></InfoCard>
        <InfoCard title="خبرنامه" icon={Mail}><p>اگر فرم خبرنامه را ارسال کنید، ایمیل و وضعیت رضایت/لغو عضویت در پایگاه داده ذخیره می‌شوند. تا زمان اتصال سرویس ارسال ایمیل، پیام تبلیغاتی از این فرم ارسال نمی‌شود.</p></InfoCard>
        <InfoCard title="پرداخت و امنیت" icon={CreditCard}><p>پرداخت از طریق درگاه تنظیم‌شده انجام می‌شود. اطلاعات کامل کارت بانکی را در فرم‌های فروشگاه یا پیام پشتیبانی ارسال نکنید؛ بررسی پرداخت در سمت سرور صورت می‌گیرد.</p></InfoCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout eyebrow="اطلاعات فروشگاه" title="شرایط استفاده" intro="با استفاده از میبا، هنگام خرید باید کد فنی، سازگاری با خودرو، قیمت، شرایط ارسال و وضعیت نهایی سفارش را بررسی کنید.">
      <InfoCard title="قیمت و موجودی" icon={PackageCheck}><p>اطلاعات قیمت، تصاویر و مشخصات از کاتالوگ فروشگاه می‌آیند و ممکن است به‌روزرسانی شوند. تصاویر ممکن است نمایشی باشند؛ ملاک، کد فنی و مشخصات درج‌شده است. موجودی نهایی و مبلغ سفارش پیش از پرداخت در سمت سرور دوباره بررسی می‌شوند.</p></InfoCard>
      <InfoCard title="حساب‌های همکاری (عمده)" icon={Building2}><p>قیمت‌های عمده محرمانه و مخصوص صاحب همان حساب است و نباید در اختیار دیگران قرار گیرد. حساب همکاری فقط توسط میبا ساخته می‌شود و میبا می‌تواند شرایط یا تخفیف اختصاصی آن را تغییر دهد یا حساب را غیرفعال کند. کدهای تخفیف روی قیمت عمده اعمال نمی‌شوند.</p></InfoCard>
      <InfoCard title="ثبت سفارش و پرداخت" icon={CreditCard}><p>افزودن محصول به سبد خرید، به‌تنهایی به معنی تکمیل سفارش نیست. سفارش پس از طی مراحل پرداخت و تأیید سمت سرور نهایی می‌شود.</p></InfoCard>
      <InfoCard title="ارسال و مرجوعی" icon={Truck}><p>هزینه ارسال بر اساس تنظیمات فعلی در سبد خرید نمایش داده می‌شود. شرایط بازگشت و گارانتی در <Link to="/returns-policy" className="font-semibold text-[#c2410c] underline underline-offset-2">مرجوعی و گارانتی</Link> آمده است.</p></InfoCard>
      <InfoCard title="اطلاعات بیشتر" icon={ShieldCheck}><p>برای جزئیات داده‌های نگهداری‌شده، <Link to="/privacy-policy" className="font-semibold text-[#c2410c] underline underline-offset-2">سیاست حریم خصوصی</Link> را بخوانید.</p></InfoCard>
    </PageLayout>
  );
};

export default StoreInfoPage;

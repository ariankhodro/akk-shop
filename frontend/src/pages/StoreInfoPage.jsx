import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CheckCircle2, Clock3, CreditCard, Mail, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import axios from "../lib/axios";
import { formatPrice } from "../lib/commerce";
import PageMeta from "../components/PageMeta";

const supportEmail = import.meta.env.VITE_STORE_SUPPORT_EMAIL || "";

const categoryLinks = [
  ["/shipping-policy", "ارسال و تحویل"],
  ["/returns-policy", "مرجوعی و تعویض"],
  ["/faq", "سؤالات متداول"],
  ["/support", "پشتیبانی"],
  ["/privacy-policy", "حریم خصوصی"],
  ["/terms-of-use", "شرایط استفاده"],
];

const PageLayout = ({ eyebrow, title, intro, children }) => {
  const { pathname } = useLocation();
  return (
    <main dir="rtl" className="min-h-[60vh] bg-[#f7f5f0] px-3 py-8 text-[#252722] sm:px-6 sm:py-12 lg:px-8">
      <PageMeta title={title} description={intro || (title + " | راهنمای فروشگاه تیک بوتیک.")} path={pathname} breadcrumbs={[{ name: "صفحه اصلی", path: "/" }, { name: title, path: pathname }]} />
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 text-xs font-semibold tracking-wide text-[#68745f]">{eyebrow}</p>
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
        {intro && <p className="mt-3 max-w-3xl text-sm leading-7 text-[#62645c] sm:text-base">{intro}</p>}
        <div className="mt-7 space-y-4">{children}</div>
        <nav aria-label="صفحات راهنما" className="mt-9 flex flex-wrap gap-2 border-t border-[#e4e0d8] pt-5">
          {categoryLinks.filter(([href]) => href !== pathname).map(([href, label]) => (
            <Link key={href} to={href} className="inline-flex min-h-9 items-center rounded-full border border-[#d5d0c5] bg-[#fffefa] px-3 py-2 text-xs font-semibold text-[#62645c] transition hover:border-[#a8a597] hover:text-[#252722]">{label}</Link>
          ))}
        </nav>
        {supportEmail && <p className="mt-5 text-sm text-[#62645c]">راه ارتباط با پشتیبانی: <a href={`mailto:${supportEmail}`} className="font-semibold underline underline-offset-2" dir="ltr">{supportEmail}</a></p>}
      </div>
    </main>
  );
};

const InfoCard = ({ title, children, icon: Icon = CheckCircle2 }) => (
  <section className="rounded-2xl border border-[#e4e0d8] bg-[#fffefa] p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9ede4] text-[#68745f]"><Icon size={19} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 space-y-2 text-sm leading-7 text-[#62645c]">{children}</div>
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
            <p>هزینه ثابت فعلی: <strong className="font-semibold text-[#252722]">{formatPrice(shipping.flatRate, shipping.currency)}</strong></p>
            {shipping.freeShippingThreshold > 0
              ? <p>ارسال رایگان برای سفارش‌هایی با مبلغ کالا پس از تخفیف، حداقل <strong className="font-semibold text-[#252722]">{formatPrice(shipping.freeShippingThreshold, shipping.currency)}</strong> است.</p>
              : <p>حداقل مبلغ برای فعال‌شدن ارسال رایگان تعریف نشده است.</p>}
            {shipping.flatRate === 0 && <p>طبق تنظیمات فعلی، هزینه ثابت ارسال صفر است؛ مبلغ نهایی همچنان در سبد خرید تأیید می‌شود.</p>}
          </>}
        </InfoCard>
        <InfoCard title="زمان و محدوده تحویل" icon={Clock3}>
          <p>فروشگاه در حال حاضر زمان تحویل یا محدوده پوشش را در تنظیمات عمومی ثبت نکرده است؛ بنابراین زمان مشخصی را تضمین نمی‌کنیم. زمان و امکان ارسال را پیش از پرداخت و در ارتباط با پشتیبانی بررسی کنید.</p>
        </InfoCard>
        <InfoCard title="پیگیری سفارش" icon={PackageCheck}>
          <p>بعد از پرداخت، نتیجه تراکنش در سمت سرور بررسی می‌شود. در صورت بروز مشکل، شناسه سفارش و جزئیات پرداخت را نگه دارید و با پشتیبانی تماس بگیرید.</p>
        </InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/returns-policy") {
    return (
      <PageLayout eyebrow="راهنمای خرید" title="مرجوعی و تعویض" intro="این صفحه برای روشن‌بودن شرایط خرید تهیه شده است؛ سیاست نهایی مرجوعی باید از طرف فروشگاه تأیید شود.">
        <InfoCard title="وضعیت سیاست مرجوعی" icon={PackageCheck}>
          <p>در حال حاضر بازه زمانی رسمی مرجوعی، شرایط بسته‌بندی، هزینه برگشت و استثناهای مربوط به کالاها در تنظیمات فروشگاه ثبت نشده‌اند. برای جلوگیری از ارائه قول نادرست، این صفحه بازه یا تضمین مرجوعی مشخصی اعلام نمی‌کند.</p>
          <p>پیش از ثبت سفارش، درباره امکان مرجوعی یا تعویض کالای موردنظر با پشتیبانی هماهنگ کنید و پاسخ را نگه دارید.</p>
        </InfoCard>
        <InfoCard title="در صورت مغایرت یا آسیب" icon={ShieldCheck}>
          <p>اگر سفارش دریافتی با اطلاعات ثبت‌شده مغایرت دارد یا بسته آسیب‌دیده است، تصاویر کالا و بسته‌بندی و شناسه سفارش را نگه دارید و در اولین فرصت موضوع را با پشتیبانی مطرح کنید.</p>
        </InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/support") {
    return (
      <PageLayout eyebrow="در کنار شما" title="پشتیبانی و تماس" intro="برای پرسش درباره سفارش، هزینه ارسال، موجودی یا شرایط کالا، جزئیات سفارش را آماده داشته باشید.">
        <InfoCard title="راه ارتباطی فروشگاه" icon={Mail}>
          {supportEmail
            ? <p>ایمیل پشتیبانی: <a href={`mailto:${supportEmail}`} className="font-semibold text-[#252722] underline underline-offset-2" dir="ltr">{supportEmail}</a></p>
            : <p>نشانی ایمیل یا شماره تماس رسمی هنوز در تنظیمات فروشگاه ثبت نشده است؛ برای فعال‌شدن این بخش، مقدار VITE_STORE_SUPPORT_EMAIL باید در تنظیمات فرانت‌اند ثبت شود.</p>}
          <p>در پیام خود شناسه سفارش (در صورت وجود)، ایمیل حساب و توضیح کوتاه مشکل را ذکر کنید؛ هرگز رمز عبور یا اطلاعات کامل کارت بانکی را ارسال نکنید.</p>
        </InfoCard>
        <InfoCard title="پاسخ‌های سریع" icon={CheckCircle2}>
          <p>هزینه و شرط ارسال رایگان در <Link to="/shipping-policy" className="font-semibold text-[#526149] underline underline-offset-2">صفحه ارسال</Link> و سؤالات رایج در <Link to="/faq" className="font-semibold text-[#526149] underline underline-offset-2">سؤالات متداول</Link> آمده‌اند.</p>
        </InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/faq") {
    return (
      <PageLayout eyebrow="راهنما" title="سؤالات متداول" intro="پاسخ‌ها بر اساس قابلیت‌های فعلی فروشگاه نوشته شده‌اند.">
        <InfoCard title="چطور از موجودی و سایز مطمئن شوم؟" icon={PackageCheck}><p>در صفحه جزئیات هر محصول، سایزها و رنگ‌های ثبت‌شده و وضعیت موجودی گزینه‌ها را بررسی کنید. موجودی در زمان سفارش نیز سمت سرور کنترل می‌شود.</p></InfoCard>
        <InfoCard title="هزینه ارسال را کجا می‌بینم؟" icon={Truck}><p>هزینه فعلی و شرط ارسال رایگان در <Link to="/shipping-policy" className="font-semibold text-[#526149] underline underline-offset-2">صفحه ارسال</Link> قابل مشاهده است و هزینه نهایی پیش از پرداخت در سبد خرید نمایش داده می‌شود.</p></InfoCard>
        <InfoCard title="می‌توانم بدون ورود محصول اضافه کنم؟" icon={PackageCheck}><p>بله، می‌توانید به‌عنوان مهمان سبد خرید را بسازید و بعداً وارد حساب شوید. برای ثبت سفارش و پرداخت، ورود به حساب لازم است.</p></InfoCard>
        <InfoCard title="پرداخت من چطور تأیید می‌شود؟" icon={CreditCard}><p>وضعیت تراکنش در سمت سرور بررسی می‌شود. از صفحه موفقیت پرداخت فقط زمانی استفاده کنید که درگاه، پرداخت را تأیید کرده باشد.</p></InfoCard>
        <InfoCard title="شرایط مرجوعی چیست؟" icon={ShieldCheck}><p>بازه و ضوابط رسمی مرجوعی هنوز در فروشگاه ثبت نشده است؛ پیش از خرید، شرایط کالای موردنظر را از <Link to="/support" className="font-semibold text-[#526149] underline underline-offset-2">پشتیبانی</Link> بپرسید.</p></InfoCard>
        <InfoCard title="آیا خبرنامه ایمیل ارسال می‌کند؟" icon={Mail}><p>در حال حاضر درخواست عضویت ذخیره می‌شود، اما سرویس ارسال ایمیل هنوز متصل نشده است. می‌توانید هر زمان از صفحه <Link to="/newsletter-unsubscribe" className="font-semibold text-[#526149] underline underline-offset-2">لغو عضویت</Link> درخواست توقف عضویت بدهید.</p></InfoCard>
      </PageLayout>
    );
  }

  if (pathname === "/privacy-policy") {
    return (
      <PageLayout eyebrow="اطلاعات فروشگاه" title="حریم خصوصی" intro="این توضیحات نشان می‌دهد قابلیت‌های فعلی فروشگاه چه اطلاعاتی را برای کارکرد خود نگه می‌دارند.">
        <InfoCard title="اطلاعات حساب و سفارش" icon={ShieldCheck}><p>برای حساب کاربری، نشانی ایمیل و نام حساب ذخیره می‌شود. سبد خرید حساب، گزینه‌های کالا و اطلاعات سفارش برای اجرای خرید و نمایش وضعیت آن در پایگاه داده نگهداری می‌شود.</p></InfoCard>
        <InfoCard title="ذخیره‌سازی در مرورگر" icon={CheckCircle2}><p>سبد مهمان و فهرست علاقه‌مندی‌ها در حافظه محلی مرورگر ذخیره می‌شوند. با پاک‌کردن داده‌های سایت یا استفاده از دستگاه/مرورگر دیگر، این اطلاعات محلی ممکن است در دسترس نباشند.</p></InfoCard>
        <InfoCard title="خبرنامه" icon={Mail}><p>اگر فرم خبرنامه را ارسال کنید، ایمیل و وضعیت رضایت/لغو عضویت در پایگاه داده ذخیره می‌شوند. تا زمان اتصال سرویس ارسال ایمیل، پیام تبلیغاتی از این فرم ارسال نمی‌شود.</p></InfoCard>
        <InfoCard title="پرداخت و امنیت" icon={CreditCard}><p>پرداخت از طریق درگاه تنظیم‌شده انجام می‌شود. اطلاعات کامل کارت بانکی را در فرم‌های فروشگاه یا پیام پشتیبانی ارسال نکنید؛ بررسی پرداخت در سمت سرور صورت می‌گیرد.</p></InfoCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout eyebrow="اطلاعات فروشگاه" title="شرایط استفاده" intro="با استفاده از فروشگاه، هنگام خرید باید جزئیات محصول، قیمت، گزینه‌ها، شرایط ارسال و وضعیت نهایی سفارش را بررسی کنید.">
      <InfoCard title="قیمت و موجودی" icon={PackageCheck}><p>اطلاعات قیمت، تصاویر و مشخصات از کاتالوگ فروشگاه می‌آیند و ممکن است به‌روزرسانی شوند. موجودی نهایی و مبلغ سفارش پیش از پرداخت در سمت سرور دوباره بررسی می‌شوند.</p></InfoCard>
      <InfoCard title="ثبت سفارش و پرداخت" icon={CreditCard}><p>افزودن محصول به سبد خرید، به‌تنهایی به معنی تکمیل سفارش نیست. سفارش پس از طی مراحل پرداخت و تأیید سمت سرور نهایی می‌شود.</p></InfoCard>
      <InfoCard title="ارسال و مرجوعی" icon={Truck}><p>هزینه ارسال بر اساس تنظیمات فعلی در سبد خرید نمایش داده می‌شود. چون بازه و شرایط رسمی مرجوعی هنوز در فروشگاه ثبت نشده، قبل از خرید برای روشن‌شدن شرایط از پشتیبانی سؤال کنید.</p></InfoCard>
      <InfoCard title="اطلاعات بیشتر" icon={ShieldCheck}><p>برای جزئیات داده‌های نگهداری‌شده، <Link to="/privacy-policy" className="font-semibold text-[#526149] underline underline-offset-2">سیاست حریم خصوصی</Link> را بخوانید.</p></InfoCard>
    </PageLayout>
  );
};

export default StoreInfoPage;

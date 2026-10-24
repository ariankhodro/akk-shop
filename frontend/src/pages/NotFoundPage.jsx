import { useState } from "react";
import { ArrowLeft, Home, Search, ShoppingBag } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import PageMeta from "../components/PageMeta";

const popularCategories = [
  { label: "شلوار جین", to: "/category/jeans" },
  { label: "تی‌شرت", to: "/category/t-shirts" },
  { label: "کفش", to: "/category/shoes" },
  { label: "کت و کاپشن", to: "/category/jackets" },
  { label: "کیف و اکسسوری", to: "/category/bags" },
];

const NotFoundPage = () => {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  const handleSearch = (event) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    navigate("/shop?q=" + encodeURIComponent(value));
  };

  return (
    <main dir="rtl" className="min-h-[65vh] bg-[#f7f5f0] px-4 py-12 text-[#252722] sm:px-6 sm:py-16">
      <PageMeta title="صفحه پیدا نشد" description="نشانی واردشده معتبر نیست یا این صفحه دیگر در تیک بوتیک در دسترس نیست." path={location.pathname} robots="noindex, nofollow" canonical={false} />
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#e4e0d8] bg-[#fffefa] text-[#68745f] shadow-sm">
          <ShoppingBag size={28} aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold tracking-wide text-[#68745f]">تیک بوتیک · صفحه پیدا نشد</p>
        <p aria-label="خطای ۴۰۴" className="mt-3 font-serif text-7xl font-semibold tracking-tight text-[#252722] sm:text-8xl">۴۰۴</p>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">این صفحه در فروشگاه نیست</h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-[#62645c] sm:text-base">
          ممکن است نشانی تغییر کرده باشد یا صفحه دیگر در دسترس نباشد. می‌توانید محصولی را جست‌وجو کنید یا از دسته‌بندی‌های فروشگاه ادامه دهید.
        </p>
        <form onSubmit={handleSearch} className="mt-7 flex w-full max-w-xl flex-col gap-2 rounded-2xl border border-[#e4e0d8] bg-[#fffefa] p-2 shadow-sm sm:flex-row">
          <label htmlFor="not-found-search" className="sr-only">جست‌وجو در محصولات</label>
          <div className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-2">
            <Search size={18} className="shrink-0 text-[#68745f]" aria-hidden="true" />
            <input id="not-found-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام محصول، رنگ یا دسته‌بندی را بنویسید…" className="min-w-0 flex-1 bg-transparent py-2 text-sm text-[#252722] outline-none placeholder:text-[#9a9a90]" />
          </div>
          <button type="submit" disabled={!query.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#252722] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#41443b] disabled:cursor-not-allowed disabled:opacity-50">
            جست‌وجو <ArrowLeft size={15} aria-hidden="true" />
          </button>
        </form>
        <section className="mt-8 w-full max-w-xl" aria-labelledby="popular-categories-title">
          <h2 id="popular-categories-title" className="text-sm font-semibold text-[#41443b]">دسته‌بندی‌های پرطرفدار</h2>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {popularCategories.map((category) => (
              <Link key={category.to} to={category.to} className="inline-flex min-h-10 items-center rounded-full border border-[#d5d0c5] bg-[#fffefa] px-4 py-2 text-sm text-[#41443b] transition hover:border-[#68745f] hover:bg-[#e9ede4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]">
                {category.label}
              </Link>
            ))}
          </div>
        </section>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Link to="/shop" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#68745f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#41443b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]">
            <ShoppingBag size={16} aria-hidden="true" /> مشاهده همه محصولات
          </Link>
          <Link to="/" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#d5d0c5] bg-[#fffefa] px-5 py-2.5 text-sm font-semibold text-[#41443b] transition hover:bg-[#e9ede4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]">
            <Home size={16} aria-hidden="true" /> صفحه اصلی
          </Link>
        </div>
      </div>
    </main>
  );
};

export default NotFoundPage;

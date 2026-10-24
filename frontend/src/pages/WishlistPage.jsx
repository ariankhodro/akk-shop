import { Heart, ShoppingBag, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import { useWishlistStore } from "../stores/useWishlistStore";

const WishlistPage = () => {
  const { items, clearSaved } = useWishlistStore();

  return (
    <main dir="rtl" className="min-h-screen bg-[#f7f5f0] px-3 py-8 text-[#252722] sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-[1920px]">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-[#e4e0d8] pb-5 sm:mb-9 sm:pb-6">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#68745f]">
              <Heart size={15} aria-hidden="true" />
              مجموعه شخصی شما
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">علاقه‌مندی‌های من</h1>
            <p className="mt-2 text-sm leading-6 text-[#77786f]">محصولاتی که برای خرید بعدی ذخیره کرده‌اید.</p>
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={clearSaved}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d5d0c5] bg-[#fffefa] px-4 py-2 text-sm font-semibold text-[#62645c] transition hover:border-[#c7c3b9] hover:bg-[#f2f0e9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#68745f]"
            >
              <Trash2 size={15} aria-hidden="true" />
              پاک‌کردن فهرست
            </button>
          )}
        </header>

        {items.length > 0 ? (
          <>
            <p className="mb-4 text-sm text-[#77786f]" aria-live="polite">
              {new Intl.NumberFormat("fa-IR").format(items.length)} محصول ذخیره‌شده
            </p>
            <div className="grid grid-cols-2 justify-items-stretch gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((product) => <ProductCard key={product._id} product={product} />)}
            </div>
          </>
        ) : (
          <section className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-[#d8d4c9] bg-[#fffefa] px-5 py-12 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e9ede4] text-[#68745f]">
              <Heart size={24} aria-hidden="true" />
            </span>
            <h2 className="text-xl font-semibold">هنوز محصولی ذخیره نکرده‌اید</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[#77786f]">
              با انتخاب آیکون قلب روی کارت هر محصول، آن را به این فهرست اضافه کنید.
            </p>
            <Link
              to="/shop"
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#252722] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#41443b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f]"
            >
              <ShoppingBag size={16} aria-hidden="true" />
              دیدن محصولات
            </Link>
          </section>
        )}
      </div>
    </main>
  );
};

export default WishlistPage;

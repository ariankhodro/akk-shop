import { Heart, ShoppingBag, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import { useWishlistStore } from "../stores/useWishlistStore";

const WishlistPage = () => {
  const { items, clearSaved } = useWishlistStore();

  return (
    <main dir="rtl" className="min-h-screen bg-[#f5f6f8] px-3 py-8 text-[#1c1f24] sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-[1920px]">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-[#e2e5ea] pb-5 sm:mb-9 sm:pb-6">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#ea580c]">
              <Heart size={15} aria-hidden="true" />
              مجموعه شخصی شما
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">علاقه‌مندی‌های من</h1>
            <p className="mt-2 text-sm leading-6 text-[#6b717b]">قطعاتی که برای خرید بعدی ذخیره کرده‌اید.</p>
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={clearSaved}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d2d6dc] bg-[#ffffff] px-4 py-2 text-sm font-semibold text-[#5a606a] transition hover:border-[#c3c8cf] hover:bg-[#f0f2f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ea580c]"
            >
              <Trash2 size={15} aria-hidden="true" />
              پاک‌کردن فهرست
            </button>
          )}
        </header>

        {items.length > 0 ? (
          <>
            <p className="mb-4 text-sm text-[#6b717b]" aria-live="polite">
              {new Intl.NumberFormat("fa-IR").format(items.length)} قطعه ذخیره‌شده
            </p>
            <div className="grid grid-cols-2 justify-items-stretch gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((product) => <ProductCard key={product._id} product={product} />)}
            </div>
          </>
        ) : (
          <section className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-[#d5d9df] bg-[#ffffff] px-5 py-12 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff1e7] text-[#ea580c]">
              <Heart size={24} aria-hidden="true" />
            </span>
            <h2 className="text-xl font-semibold">هنوز قطعه‌ای ذخیره نکرده‌اید</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[#6b717b]">
              با انتخاب آیکون قلب روی کارت هر قطعه، آن را به این فهرست اضافه کنید.
            </p>
            <Link
              to="/shop"
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1c1f24] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#33373e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]"
            >
              <ShoppingBag size={16} aria-hidden="true" />
              دیدن قطعات
            </Link>
          </section>
        )}
      </div>
    </main>
  );
};

export default WishlistPage;

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import ProductCard from "./ProductCard";
import { Link } from "react-router-dom";

const FeaturedProducts = ({ featuredProducts = [] }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(4);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) setItemsPerPage(1);
      else if (window.innerWidth < 1024) setItemsPerPage(2);
      else if (window.innerWidth < 1280) setItemsPerPage(3);
      else setItemsPerPage(4);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => setCurrentIndex(0), [itemsPerPage, featuredProducts.length]);
  const maxIndex = Math.max(0, featuredProducts.length - itemsPerPage);
  const nextSlide = () => setCurrentIndex((index) => Math.min(index + itemsPerPage, maxIndex));
  const prevSlide = () => setCurrentIndex((index) => Math.max(0, index - itemsPerPage));

  return (
    <section dir="rtl" className="py-8 sm:py-10" aria-labelledby="featured-products-heading">
      <div className="mb-7 flex flex-col gap-3 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#68745f]">منتخب برای شما</p><h2 id="featured-products-heading" className="font-serif text-3xl font-medium tracking-tight text-[#252722] sm:text-4xl">محصولات منتخب</h2></div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="max-w-sm text-sm leading-6 text-[#62645c] sm:text-right">مجموعه‌ای گزیده از محصولاتی که ارزش دیدن دارند.</p>
          <Link to="/featured-products" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d5d0c5] px-4 py-2 text-xs font-semibold text-[#41443b] transition hover:border-[#252722]">
            مشاهده همه<ArrowLeft size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className="relative">
        <div id="featured-products-track" className="overflow-hidden">
          <div className="flex items-stretch transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${(currentIndex / Math.max(featuredProducts.length, 1)) * 100}%)` }}>
            {featuredProducts.map((product) => <div key={product._id} className="min-w-0 shrink-0 px-1.5 pb-2 sm:px-2" style={{ flexBasis: `${100 / itemsPerPage}%`, boxSizing: "border-box" }}><ProductCard product={product} /></div>)}
          </div>
        </div>
        {featuredProducts.length > itemsPerPage && <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-xs tabular-nums text-[#77786f]" aria-live="polite">{new Intl.NumberFormat("fa-IR").format(Math.min(currentIndex + itemsPerPage, featuredProducts.length))} از {new Intl.NumberFormat("fa-IR").format(featuredProducts.length)} محصول</p>
          <div className="flex gap-2">
            <button type="button" aria-controls="featured-products-track" onClick={prevSlide} disabled={currentIndex === 0} aria-label="محصولات قبلی" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d5d0c5] text-[#252722] transition hover:border-[#252722] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f] disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight size={19} aria-hidden="true" /></button>
            <button type="button" aria-controls="featured-products-track" onClick={nextSlide} disabled={currentIndex >= maxIndex} aria-label="محصولات بعدی" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d5d0c5] text-[#252722] transition hover:border-[#252722] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68745f] disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft size={19} aria-hidden="true" /></button>
          </div>
        </div>}
      </div>
    </section>
  );
};
export default FeaturedProducts;

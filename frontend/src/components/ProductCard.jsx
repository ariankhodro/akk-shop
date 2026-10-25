import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Car, Heart, ShoppingCart, Wrench } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useCartStore } from "../stores/useCartStore";
import { useWishlistStore } from "../stores/useWishlistStore";
import { fitmentSummary, isOutOfStock, isStockTracked, partQualityLabel, wholesaleOffer } from "../lib/commerce";
import PartPrice from "./PartPrice";

const qualityTone = {
  genuine: "border-[var(--ui-success-border)] bg-[var(--ui-success-bg)] text-[var(--ui-success)]",
  oem: "border-[var(--ui-accent)]/30 bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]",
  aftermarket: "border-[var(--ui-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-text-strong)]",
  used: "border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] text-[var(--ui-warning)]",
};

const ProductCard = ({ product }) => {
  const { addToCart } = useCartStore();
  const { isSaved, toggleSaved } = useWishlistStore();
  const navigate = useNavigate();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [product.image]);
  const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
  const outOfStock = hasVariants
    ? product.variants.every((variant) => Number(variant.stock) <= 0)
    : isOutOfStock(product);
  const saved = isSaved(product._id);
  const variantStock = hasVariants
    ? product.variants.reduce((total, variant) => total + Math.max(0, Number(variant.stock) || 0), 0)
    : null;
  const lowStock = hasVariants
    ? variantStock > 0 && variantStock <= 3
    : isStockTracked(product) && product.stock > 0 && product.stock <= 3;
  const quality = partQualityLabel(product.quality);
  const fits = fitmentSummary(product.fitments);
  const offer = wholesaleOffer(product);

  const handleAddToCart = () => {
    if (hasVariants) {
      navigate("/product/" + product._id);
      return;
    }
    if (outOfStock) return toast.error("این قطعه در حال حاضر موجود نیست");
    // Wholesale customers start at the wholesale threshold so the first add gets their price.
    const quantity = offer && offer.minQuantity > 1 ? offer.minQuantity : 1;
    if (isStockTracked(product) && quantity > product.stock) return addToCart(product);
    addToCart(product, { quantity });
  };

  return (
    <article dir="rtl" className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] transition duration-300 hover:-translate-y-1 hover:border-[var(--ui-accent)]/40 hover:shadow-[0_18px_45px_-24px_var(--ui-shadow-color)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="relative">
        <Link to={`/product/${product._id}`} aria-label={`مشاهده جزئیات ${product.name}`} className="relative block overflow-hidden bg-[var(--ui-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--ui-focus)]">
          <div className="aspect-square overflow-hidden">
            {product.image && !imageFailed ? (
              <img
                src={product.image}
                alt={product.name}
                loading="lazy"
                decoding="async"
                onError={() => setImageFailed(true)}
                className={`h-full w-full object-contain p-3 transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none ${outOfStock ? "grayscale" : ""}`}
              />
            ) : (
              <div role="img" aria-label={"تصویر " + product.name + " در دسترس نیست"} className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[var(--ui-muted)]">
                <Wrench size={32} aria-hidden="true" className="text-[var(--ui-accent)]" />
                <span>تصویر قطعه به‌زودی اضافه می‌شود</span>
              </div>
            )}
          </div>
        </Link>

        {quality && (
          <span className={`pointer-events-none absolute left-3 top-3 max-w-[60%] truncate whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold ${qualityTone[product.quality] || qualityTone.aftermarket}`}>{quality}</span>
        )}

        <button
          type="button"
          onClick={() => toggleSaved(product)}
          aria-label={saved ? `حذف ${product.name} از علاقه‌مندی‌ها` : `ذخیره ${product.name} در علاقه‌مندی‌ها`}
          aria-pressed={saved}
          className={`absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] ${saved ? "border-[var(--ui-accent)] bg-[var(--ui-hover)] text-[var(--ui-accent)]" : "border-[var(--ui-border)] bg-[var(--ui-surface)]/95 text-[var(--ui-text-strong)] hover:border-[var(--ui-border-strong)]"}`}
        >
          <Heart size={18} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
        </button>

        {outOfStock && <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-[var(--ui-strong-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ui-inverse-text)] shadow-sm">ناموجود</span>}
        {lowStock && (
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] px-3 py-1.5 text-[10px] font-semibold text-[var(--ui-warning)] shadow-sm">موجودی محدود</span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex-1">
          <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ui-muted)]">
            {product.brand && <span className="font-semibold text-[var(--ui-text-strong)]">{product.brand}</span>}
            {product.sku && <span dir="ltr" className="rounded bg-[var(--ui-surface-raised)] px-1.5 py-0.5 font-mono text-[10px] tracking-wide">{product.sku}</span>}
          </div>
          <Link to={`/product/${product._id}`} className="mt-1.5 block min-h-12 rounded-sm text-sm font-semibold leading-6 text-[var(--ui-text)] transition hover:text-[var(--ui-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] sm:text-base">
            <span className="line-clamp-2">{product.name}</span>
          </Link>
          <p className="mt-2 flex min-h-5 items-start gap-1.5 text-[11px] leading-5 text-[var(--ui-muted)]">
            {fits ? (
              <><Car size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--ui-accent)]" /><span className="line-clamp-2"><span className="sr-only">سازگار با: </span>{fits}</span></>
            ) : <span aria-hidden="true" className="block h-4" />}
          </p>
          <PartPrice product={product} className="mt-3" />
        </div>

        <button type="button" onClick={handleAddToCart} disabled={outOfStock} className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--ui-accent)] px-3 py-2.5 text-xs font-bold text-white transition hover:bg-[var(--ui-accent-hover)] sm:px-4 sm:text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] disabled:cursor-not-allowed disabled:bg-[var(--ui-disabled-bg)] disabled:text-[var(--ui-disabled-text)]">
          <ShoppingCart size={16} aria-hidden="true" />{outOfStock ? "ناموجود" : hasVariants ? "انتخاب نوع قطعه" : offer && offer.minQuantity > 1 ? `افزودن ${new Intl.NumberFormat("fa-IR").format(offer.minQuantity)} عدد` : "افزودن به سبد خرید"}
        </button>
      </div>
    </article>
  );
};

export default ProductCard;

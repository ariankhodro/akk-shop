import { formatPrice, wholesaleOffer } from "../lib/commerce";

const fa = new Intl.NumberFormat("fa-IR");

// Retail price, or — for a signed-in wholesale customer — their wholesale unit
// price with the retail price struck through and the quantity threshold.
const PartPrice = ({ product, size = "md", className = "" }) => {
  const offer = wholesaleOffer(product);
  const main = size === "lg" ? "text-2xl sm:text-3xl" : size === "sm" ? "text-base" : "text-lg";
  if (!offer) {
    return <p className={`${main} font-bold tabular-nums tracking-tight text-[var(--ui-text)] ${className}`}>{formatPrice(product?.price)}</p>;
  }
  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-full bg-[var(--ui-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ui-accent)]">قیمت همکار</span>
        <span className={`${main} font-bold tabular-nums tracking-tight text-[var(--ui-accent)]`}>{formatPrice(offer.unitPrice)}</span>
      </p>
      <p className="mt-1 text-xs text-[var(--ui-muted)]">
        <span className="sr-only">قیمت خرده‌فروشی: </span>
        <s className="tabular-nums">{formatPrice(offer.retailPrice)}</s>
        {offer.minQuantity > 1 && <span className="mr-2">از {fa.format(offer.minQuantity)} عدد</span>}
      </p>
    </div>
  );
};

export default PartPrice;

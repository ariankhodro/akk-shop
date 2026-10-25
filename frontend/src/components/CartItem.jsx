import { useEffect, useState } from "react";
import { Minus, Plus, Trash } from "lucide-react";
import { normalizeDigits } from "../lib/normalize-digits";
import { useCartStore } from "../stores/useCartStore";
import { effectiveUnitPrice, formatPrice, lineTotal, maxLineQuantity, wholesaleOffer } from "../lib/commerce";

// Typed quantity (wholesale lines can be hundreds of units); committed on blur or Enter.
const QuantityField = ({ item, onCommit }) => {
  const [draft, setDraft] = useState(String(item.quantity));
  useEffect(() => setDraft(String(item.quantity)), [item.quantity]);
  const commit = () => {
    const next = Number.parseInt(normalizeDigits(draft), 10);
    if (!Number.isInteger(next) || next === item.quantity) return setDraft(String(item.quantity));
    onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      dir="ltr"
      aria-label={"تعداد " + item.name}
      value={draft}
      onChange={(event) => setDraft(event.target.value.slice(0, 5))}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}
      className="h-8 w-14 rounded-md border border-[var(--ui-border)] bg-[var(--ui-input-bg)] text-center text-sm tabular-nums text-[var(--ui-text)] focus:border-[var(--ui-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus)]/30"
    />
  );
};

const CartItem = ({ item }) => {
  const { removeFromCart, updateQuantity } = useCartStore();
  const selectedVariant = (item.variants || []).find((variant) =>
    (variant.size || "") === (item.selectedSize || "") && (variant.color || "") === (item.selectedColor || "")
  );
  const trackedStock = selectedVariant ? selectedVariant.stock : item.stock;
  const hasTrackedStock = typeof trackedStock === "number" && Number.isFinite(trackedStock);
  const maxReached = (hasTrackedStock && item.quantity >= trackedStock) || item.quantity >= maxLineQuantity(item);
  const unitPrice = effectiveUnitPrice(item);
  const offer = wholesaleOffer(item);
  const fa = new Intl.NumberFormat("fa-IR");

  return (
    <div dir="rtl" className="rounded-lg border p-4 shadow-sm border-[var(--ui-border)] bg-[var(--ui-surface)] md:p-6">
      <div className="space-y-4 md:flex md:items-center md:justify-between md:gap-6 md:space-y-0">
        <div className="shrink-0 md:order-1">
          {item.image
            ? <img className="h-20 w-20 rounded bg-[var(--ui-surface-raised)] object-contain p-1 md:h-28 md:w-28" src={item.image} alt={item.name} />
            : <div aria-hidden="true" className="h-20 w-20 rounded bg-[var(--ui-surface-raised)] md:h-28 md:w-28" />}
        </div>
        <div className="flex items-center justify-between md:order-3 md:justify-end">
          <div className="flex items-center gap-2">
            <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] hover:bg-[var(--ui-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus)]" aria-label="کاهش تعداد" onClick={() => updateQuantity(item, item.quantity - 1)}>
              <Minus className="text-[var(--ui-muted)]" aria-hidden="true" />
            </button>
            <QuantityField item={item} onCommit={(quantity) => updateQuantity(item, quantity)} />
            <button type="button" disabled={maxReached} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] hover:bg-[var(--ui-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus)] disabled:cursor-not-allowed disabled:opacity-40" aria-label="افزایش تعداد" onClick={() => updateQuantity(item, item.quantity + 1)}>
              <Plus className="text-[var(--ui-muted)]" aria-hidden="true" />
            </button>
          </div>
          <div className="text-end md:order-4 md:w-36">
            <p className="text-base font-bold tabular-nums text-[var(--ui-accent)]">{formatPrice(lineTotal(item))}</p>
            <p className="mt-1 text-xs tabular-nums text-[var(--ui-muted)]">هر عدد {formatPrice(unitPrice)}</p>
            {offer && unitPrice !== offer.unitPrice && (
              <p className="mt-1 text-xs text-[var(--ui-accent)]">قیمت همکار از {fa.format(offer.minQuantity)} عدد</p>
            )}
            {hasTrackedStock && <p className="mt-1 text-xs text-[var(--ui-muted)]">موجودی این گزینه: {new Intl.NumberFormat("fa-IR").format(trackedStock)}</p>}
          </div>
        </div>
        <div className="w-full min-w-0 flex-1 space-y-4 md:order-2 md:max-w-md">
          <p className="text-base font-medium text-[var(--ui-text)]">{item.name}</p>
          {(item.brand || item.sku) && (
            <p className="flex flex-wrap gap-2 text-xs text-[var(--ui-muted)]">
              {item.brand && <span>برند: {item.brand}</span>}
              {item.sku && <span>کد کالا: <span dir="ltr" className="font-mono">{item.sku}</span></span>}
            </p>
          )}
          {item.guestOnly && (
            <p role="status" className="rounded-lg border border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--ui-warning)]">
              این گزینه هنوز به حساب شما منتقل نشده؛ موجودی آن را بررسی یا از سبد حذف کنید.
            </p>
          )}
          <p className="line-clamp-2 text-sm text-[var(--ui-muted)]">{item.description}</p>
          {(item.selectedSize || item.selectedColor) && (
            <p className="text-sm text-[var(--ui-muted)]">
              {item.selectedSize && <span>نوع: {item.selectedSize}</span>}
              {item.selectedSize && item.selectedColor && <span className="mx-2 text-[var(--ui-muted)]">•</span>}
              {item.selectedColor && <span>رنگ: {item.selectedColor}</span>}
            </p>
          )}
          <div className="flex items-center gap-4">
            <button type="button" className="inline-flex items-center text-sm font-medium text-red-400 hover:text-[var(--ui-danger)] hover:underline" aria-label="حذف از سبد خرید" onClick={() => removeFromCart(item)}>
              <Trash aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default CartItem;

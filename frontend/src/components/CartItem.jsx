import { Minus, Plus, Trash } from "lucide-react";
import { useCartStore } from "../stores/useCartStore";
import { formatPrice } from "../lib/commerce";

const CartItem = ({ item }) => {
  const { removeFromCart, updateQuantity } = useCartStore();
  const selectedVariant = (item.variants || []).find((variant) =>
    (variant.size || "") === (item.selectedSize || "") && (variant.color || "") === (item.selectedColor || "")
  );
  const trackedStock = selectedVariant ? selectedVariant.stock : item.stock;
  const hasTrackedStock = typeof trackedStock === "number" && Number.isFinite(trackedStock);
  const maxReached = hasTrackedStock && item.quantity >= trackedStock;

  return (
    <div dir="rtl" className="rounded-lg border p-4 shadow-sm border-[var(--ui-border)] bg-[var(--ui-surface)] md:p-6">
      <div className="space-y-4 md:flex md:items-center md:justify-between md:gap-6 md:space-y-0">
        <div className="shrink-0 md:order-1">
          <img className="h-20 rounded object-cover md:h-32" src={item.image} alt={item.name} />
        </div>
        <div className="flex items-center justify-between md:order-3 md:justify-end">
          <div className="flex items-center gap-2">
            <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] hover:bg-[var(--ui-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus)]" aria-label="کاهش تعداد" onClick={() => updateQuantity(item, item.quantity - 1)}>
              <Minus className="text-[var(--ui-muted)]" aria-hidden="true" />
            </button>
            <p className="min-w-5 text-center tabular-nums">{new Intl.NumberFormat("fa-IR").format(item.quantity)}</p>
            <button type="button" disabled={maxReached} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] hover:bg-[var(--ui-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus)] disabled:cursor-not-allowed disabled:opacity-40" aria-label="افزایش تعداد" onClick={() => updateQuantity(item, item.quantity + 1)}>
              <Plus className="text-[var(--ui-muted)]" aria-hidden="true" />
            </button>
          </div>
          <div className="text-end md:order-4 md:w-36">
            <p dir="ltr" className="text-base font-bold text-[var(--ui-accent)]">{formatPrice(item.price)}</p>
            {hasTrackedStock && <p className="mt-1 text-xs text-[var(--ui-muted)]">موجودی این گزینه: {new Intl.NumberFormat("fa-IR").format(trackedStock)}</p>}
          </div>
        </div>
        <div className="w-full min-w-0 flex-1 space-y-4 md:order-2 md:max-w-md">
          <p className="text-base font-medium text-[var(--ui-text)]">{item.name}</p>
          {item.guestOnly && (
            <p role="status" className="rounded-lg border border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--ui-warning)]">
              این گزینه هنوز به حساب شما منتقل نشده؛ موجودی آن را بررسی یا از سبد حذف کنید.
            </p>
          )}
          <p className="text-sm text-[var(--ui-muted)]">{item.description}</p>
          {(item.selectedSize || item.selectedColor) && (
            <p className="text-sm text-[var(--ui-muted)]">
              {item.selectedSize && <span>سایز: {item.selectedSize}</span>}
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

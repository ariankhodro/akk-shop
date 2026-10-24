import { useState } from "react";
import { Check, LoaderCircle, TicketPercent, X } from "lucide-react";
import toast from "react-hot-toast";
import { useCartStore } from "../stores/useCartStore";
import { formatPrice } from "../lib/commerce";

const GiftCouponCard = () => {
  const [userInputCode, setUserInputCode] = useState("");
  const [applying, setApplying] = useState(false);
  const { coupon, isCouponApplied, applyCoupon, removeCoupon, subtotal } = useCartStore();

  const handleApplyCoupon = async (event) => {
    event.preventDefault();
    const code = userInputCode.trim().toUpperCase();
    if (!code || applying) return;
    setApplying(true);
    try {
      const applied = await applyCoupon(code);
      if (applied) setUserInputCode(code);
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveCoupon = () => {
    removeCoupon();
    setUserInputCode("");
  };

  return (
    <section className="space-y-3 border-t border-[var(--ui-border)] pt-4" aria-labelledby="checkout-coupon-title">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ui-accent)]/15 text-[var(--ui-accent)]">
          <TicketPercent size={18} aria-hidden="true" />
        </span>
        <div>
          <h4 id="checkout-coupon-title" className="text-sm font-semibold text-[var(--ui-text)]">کد تخفیف (اختیاری)</h4>
          <p className="mt-1 text-xs leading-5 text-[var(--ui-muted)]">کد را وارد کنید؛ مبلغ نهایی و اعتبار آن پیش از پرداخت در سرور دوباره بررسی می‌شود.</p>
        </div>
      </div>

      <form onSubmit={handleApplyCoupon} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="checkout-coupon-code" className="sr-only">کد تخفیف</label>
        <input
          type="text"
          id="checkout-coupon-code"
          autoComplete="off"
          maxLength={40}
          spellCheck={false}
          dir="ltr"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2.5 text-sm uppercase tracking-wide text-[var(--ui-text)] outline-none transition placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--ui-muted)] focus:border-[#9aa58e] focus:ring-2 focus:ring-[var(--ui-focus)]/30"
          placeholder="مثلاً TIK20"
          value={userInputCode}
          onChange={(event) => setUserInputCode(event.target.value.toUpperCase())}
          disabled={applying || isCouponApplied}
        />
        {isCouponApplied && coupon ? (
          <button type="button" onClick={handleRemoveCoupon} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--ui-danger-border)] px-4 py-2 text-sm font-semibold text-[var(--ui-danger)] transition hover:bg-[var(--ui-danger-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9aa58e]">
            <X size={15} aria-hidden="true" />حذف کد
          </button>
        ) : (
          <button type="submit" disabled={applying || !userInputCode.trim()} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--ui-accent)] px-5 py-2 text-sm font-semibold text-[var(--ui-button-text)] transition hover:bg-[var(--ui-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9aa58e] disabled:cursor-not-allowed disabled:opacity-50">
            {applying ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : null}
            {applying ? "در حال بررسی…" : "اعمال کد"}
          </button>
        )}
      </form>

      {isCouponApplied && coupon && (
        <div role="status" className="rounded-lg border border-[#68745f]/50 bg-[var(--ui-accent)]/10 p-3">
          <div className="flex items-start gap-2 text-sm text-[var(--ui-text)]">
            <Check className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
            <div>
              <p className="font-semibold">{coupon.code} — {new Intl.NumberFormat("fa-IR").format(coupon.discountPercentage)}٪ تخفیف فعال شد</p>
              {Number(coupon.minOrderAmount || 0) > subtotal && <p className="mt-1 text-xs leading-5 text-[var(--ui-warning)]">حداقل مبلغ برای این کد {formatPrice(coupon.minOrderAmount)} است؛ مبلغ سبد را افزایش دهید.</p>}
              {coupon.maxDiscountAmount != null && <p className="mt-1 text-xs text-[var(--ui-muted)]">سقف تخفیف: {formatPrice(coupon.maxDiscountAmount)}</p>}
              {coupon.expiresAt && <p className="mt-1 text-xs text-[var(--ui-muted)]">اعتبار تا {new Date(coupon.expiresAt).toLocaleDateString("fa-IR")}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default GiftCouponCard;

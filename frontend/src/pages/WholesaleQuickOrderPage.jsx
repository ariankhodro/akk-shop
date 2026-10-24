import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2, ClipboardList, LoaderCircle, PackageX, ShoppingCart, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import { effectiveUnitPrice, formatPrice, isStockTracked, wholesaleOffer } from "../lib/commerce";
import { normalizeDigits } from "../lib/normalize-digits";
import { parseQuickOrder, QUICK_ORDER_MAX_LINES as MAX_LINES } from "../lib/quick-order";
import { getUserErrorMessage } from "../lib/user-error-message";
import { useCartStore } from "../stores/useCartStore";
import { useUserStore } from "../stores/useUserStore";

const fa = new Intl.NumberFormat("fa-IR");
const WholesaleQuickOrderPage = () => {
  const { user } = useUserStore();
  const { addToCart } = useCartStore();
  const [text, setText] = useState("");
  const [rows, setRows] = useState([]);
  const [looking, setLooking] = useState(false);
  const [adding, setAdding] = useState(false);
  const company = user?.wholesaleProfile?.companyName;

  const lookup = async (event) => {
    event.preventDefault();
    const lines = parseQuickOrder(text);
    if (!lines.length) return toast.error("حداقل یک کد فنی وارد کنید");
    setLooking(true);
    try {
      const { data } = await axios.get("/products/lookup", { params: { codes: lines.map((line) => line.code).join(",") } });
      const results = new Map((Array.isArray(data?.results) ? data.results : []).map((result) => [result.code, result.product]));
      setRows(lines.map((line) => ({ ...line, product: results.get(line.key) || null })));
    } catch (error) {
      toast.error(getUserErrorMessage(error, "جست‌وجوی کدها ناموفق بود."));
    } finally {
      setLooking(false);
    }
  };

  const setQuantity = (code, value) => {
    const quantity = Number.parseInt(normalizeDigits(value), 10);
    setRows((current) => current.map((row) => row.key === code ? { ...row, quantity: Number.isInteger(quantity) && quantity > 0 ? Math.min(quantity, 1000) : 1 } : row));
  };
  const removeRow = (code) => setRows((current) => current.filter((row) => row.key !== code));

  const matched = rows.filter((row) => row.product);
  const total = useMemo(() => matched.reduce((sum, row) => sum + effectiveUnitPrice(row.product, row.quantity) * row.quantity, 0), [matched]);

  const addAll = async () => {
    setAdding(true);
    let added = 0;
    const failed = [];
    // Sequential: each line is validated by the server against stock and limits.
    for (const row of matched) {
      const hasVariants = Array.isArray(row.product.variants) && row.product.variants.length > 0;
      const ok = !hasVariants && await addToCart(row.product, { quantity: row.quantity, silent: true });
      if (ok) added += 1; else failed.push(row.code);
    }
    setAdding(false);
    if (added) toast.success(fa.format(added) + " ردیف به سبد خرید اضافه شد");
    if (failed.length) toast.error("این کدها اضافه نشدند (موجودی، سقف تعداد یا نیاز به انتخاب نوع): " + failed.join("، "), { duration: 7000 });
    if (added) setRows((current) => current.filter((row) => !row.product || failed.includes(row.code)));
  };

  return (
    <main dir="rtl" className="min-h-[70vh] bg-[var(--ui-canvas)] px-3 py-8 text-[var(--ui-text)] sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-3 border-b border-[var(--ui-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ui-accent)]"><Building2 size={15} aria-hidden="true" />پنل همکاران عمده{company ? " · " + company : ""}</p>
            <h1 className="mt-2 text-3xl font-bold">سفارش سریع با کد فنی</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--ui-muted)]">در هر خط یک کد کالا یا شماره فنی (OEM) و سپس تعداد را بنویسید. قیمت‌ها بر اساس قرارداد همکاری شما محاسبه می‌شوند.</p>
          </div>
          <Link to="/cart" className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 text-sm font-semibold hover:border-[var(--ui-accent)]"><ShoppingCart size={16} aria-hidden="true" />مشاهده سبد خرید</Link>
        </header>

        <form onSubmit={lookup} className="rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 sm:p-6">
          <label htmlFor="quick-order-input" className="flex items-center gap-2 text-sm font-bold"><ClipboardList size={17} className="text-[var(--ui-accent)]" aria-hidden="true" />فهرست کدها</label>
          <textarea id="quick-order-input" dir="ltr" rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder={"T11-3501080  10\nA11-1109111, 24\n481H-1012010 50"} className="mt-3 w-full rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] p-4 font-mono text-sm leading-7 text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/25" />
          <p className="mt-2 text-xs text-[var(--ui-muted)]">حداکثر {fa.format(MAX_LINES)} ردیف؛ کدهای تکراری با هم جمع می‌شوند. خط تیره و فاصله در کد اهمیتی ندارد.</p>
          <button type="submit" disabled={looking} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--ui-accent)] px-6 text-sm font-bold text-white transition hover:bg-[var(--ui-accent-hover)] disabled:opacity-60">
            {looking && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}بررسی کدها و قیمت
          </button>
        </form>

        {rows.length > 0 && (
          <section aria-labelledby="quick-order-results" className="mt-6 rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 sm:p-6">
            <h2 id="quick-order-results" className="text-lg font-bold">نتیجه بررسی</h2>
            <ul className="mt-4 divide-y divide-[var(--ui-border)]">
              {rows.map((row) => {
                const product = row.product;
                const offer = product ? wholesaleOffer(product) : null;
                const unit = product ? effectiveUnitPrice(product, row.quantity) : 0;
                const stockShort = product && isStockTracked(product) && row.quantity > product.stock;
                return (
                  <li key={row.key} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p dir="ltr" className="text-right font-mono text-xs text-[var(--ui-muted)]">{row.code}</p>
                      {product ? (
                        <>
                          <Link to={"/product/" + product._id} className="mt-1 block font-semibold hover:text-[var(--ui-accent)]">{product.name}</Link>
                          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--ui-success)]"><CheckCircle2 size={13} aria-hidden="true" />{product.brand || "قطعه پیدا شد"}{product.sku && product.sku !== row.code ? " · کد کالا " + product.sku : ""}</p>
                          {offer && row.quantity < offer.minQuantity && <p className="mt-1 text-xs text-[var(--ui-warning)]">قیمت همکار از {fa.format(offer.minQuantity)} عدد</p>}
                          {stockShort && <p className="mt-1 text-xs text-[var(--ui-danger)]">موجودی انبار: {fa.format(product.stock)} عدد</p>}
                        </>
                      ) : (
                        <p className="mt-1 flex items-center gap-1 text-sm text-[var(--ui-danger)]"><PackageX size={15} aria-hidden="true" />قطعه‌ای با این کد پیدا نشد</p>
                      )}
                    </div>
                    {product && (
                      <div className="flex items-center gap-3">
                        <label className="sr-only" htmlFor={"qty-" + row.code}>{"تعداد " + row.code}</label>
                        <input id={"qty-" + row.code} type="text" inputMode="numeric" dir="ltr" value={row.quantity} onChange={(event) => setQuantity(row.key, event.target.value)} className="h-10 w-20 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-input-bg)] text-center text-sm tabular-nums" />
                        <div className="w-36 text-left">
                          <p className="text-sm font-bold tabular-nums">{formatPrice(unit * row.quantity)}</p>
                          <p className="text-xs tabular-nums text-[var(--ui-muted)]">هر عدد {formatPrice(unit)}</p>
                        </div>
                      </div>
                    )}
                    <button type="button" onClick={() => removeRow(row.key)} aria-label={"حذف ردیف " + row.code} className="self-start rounded-full p-2 text-[var(--ui-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-danger)] sm:self-center"><Trash2 size={16} aria-hidden="true" /></button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-5 flex flex-col gap-3 border-t border-[var(--ui-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--ui-muted)]">{fa.format(matched.length)} قطعه پیدا شد · جمع تقریبی: <span className="font-bold tabular-nums text-[var(--ui-text)]">{formatPrice(total)}</span></p>
              <button type="button" disabled={!matched.length || adding} onClick={addAll} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--ui-accent)] px-6 text-sm font-bold text-white transition hover:bg-[var(--ui-accent-hover)] disabled:opacity-50">
                {adding ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ShoppingCart size={16} aria-hidden="true" />}افزودن همه به سبد خرید
              </button>
            </div>
            <p className="mt-3 text-xs leading-6 text-[var(--ui-muted)]">مبلغ نهایی، موجودی و قیمت همکار هنگام پرداخت روی سرور دوباره بررسی می‌شود.</p>
          </section>
        )}
      </div>
    </main>
  );
};

export default WholesaleQuickOrderPage;

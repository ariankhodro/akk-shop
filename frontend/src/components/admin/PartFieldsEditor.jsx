import { Car, Plus, Tag, Trash2, Wrench } from "lucide-react";
import { formatPrice, STORE_CURRENCY } from "../../lib/commerce";
import { CHINESE_CAR_MAKES, PART_QUALITY_OPTIONS, emptyFitment } from "../../lib/admin-part-fields";

// Automotive-part fields shared by the create and edit product forms.
const SectionTitle = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-2 border-b border-[var(--ui-border)] pb-2">
    <Icon size={17} className="text-[var(--ui-accent)]" aria-hidden="true" />
    <h3 className="text-sm font-bold text-[var(--ui-text)]">{children}</h3>
  </div>
);

const PartFieldsEditor = ({ value, onChange, retailPrice, fieldClass, labelClass, idPrefix = "part" }) => {
  const set = (field, next) => onChange({ ...value, [field]: next });
  const setFitment = (index, field, next) => set("fitments", value.fitments.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: next } : row));
  const retail = Number(retailPrice);
  const wholesale = Number(value.wholesalePrice);
  const showDiscount = value.wholesalePrice !== "" && Number.isSafeInteger(wholesale) && Number.isSafeInteger(retail) && retail > 0 && wholesale <= retail;
  const discount = showDiscount ? Math.round(((retail - wholesale) / retail) * 1000) / 10 : 0;
  const makesListId = idPrefix + "-makes";

  return (
    <>
      <section className="space-y-4">
        <SectionTitle icon={Tag}>مشخصات فنی قطعه</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>کد کالا (SKU)
            <input dir="ltr" value={value.sku} onChange={(event) => set("sku", event.target.value)} maxLength={64} className={fieldClass} placeholder="T11-3501080" />
          </label>
          <label className={labelClass}>برند / سازنده قطعه
            <input value={value.brand} onChange={(event) => set("brand", event.target.value)} maxLength={80} className={fieldClass} placeholder="مثلاً Chery، Bosch، Valeo" />
          </label>
        </div>
        <label className={labelClass}>شماره‌های فنی (OEM) · با ویرگول جدا کنید
          <input dir="ltr" value={value.oemNumbersText} onChange={(event) => set("oemNumbersText", event.target.value)} className={fieldClass} placeholder="T11-3501080, T113501080BA" />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={labelClass}>کیفیت قطعه
            <select value={value.quality} onChange={(event) => set("quality", event.target.value)} className={fieldClass}>
              {PART_QUALITY_OPTIONS.map(([key, label]) => <option key={key || "none"} value={key}>{label}</option>)}
            </select>
          </label>
          <label className={labelClass}>کشور سازنده
            <input value={value.countryOfOrigin} onChange={(event) => set("countryOfOrigin", event.target.value)} maxLength={60} className={fieldClass} placeholder="چین" />
          </label>
          <label className={labelClass}>گارانتی (ماه)
            <input type="number" min="0" max="120" step="1" value={value.warrantyMonths} onChange={(event) => set("warrantyMonths", event.target.value)} className={fieldClass} />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4">
        <SectionTitle icon={Wrench}>قیمت فروش عمده (محرمانه)</SectionTitle>
        <p className="text-xs leading-5 text-[var(--ui-muted)]">این قیمت فقط به همکاران عمده واردشده نمایش داده می‌شود و از حداقل تعداد تعیین‌شده در هر سفارش اعمال می‌شود. تخفیف اختصاصی هر همکار روی همین قیمت اعمال می‌شود. خالی بگذارید تا همکاران با قیمت خرده‌فروشی (به‌علاوه تخفیف اختصاصی) خرید کنند.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>قیمت عمده (تومان)
            <input type="number" min="0" step="1" value={value.wholesalePrice} onChange={(event) => set("wholesalePrice", event.target.value)} className={fieldClass} placeholder="اختیاری" />
          </label>
          <label className={labelClass}>حداقل تعداد برای قیمت عمده
            <input type="number" min="1" max="1000" step="1" value={value.wholesaleMinQuantity} onChange={(event) => set("wholesaleMinQuantity", event.target.value)} className={fieldClass} />
          </label>
        </div>
        {showDiscount && (
          <p role="status" className="text-xs font-semibold text-[var(--ui-accent)]">
            {formatPrice(wholesale, STORE_CURRENCY)} · {new Intl.NumberFormat("fa-IR").format(discount)}٪ کمتر از قیمت خرده‌فروشی
          </p>
        )}
        {value.wholesalePrice !== "" && Number.isSafeInteger(retail) && wholesale > retail && (
          <p role="alert" className="text-xs text-[var(--ui-danger)]">قیمت عمده بیشتر از قیمت خرده‌فروشی است.</p>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle icon={Car}>خودروهای سازگار</SectionTitle>
        <p className="text-xs leading-5 text-[var(--ui-muted)]">برای هر خودرو یک ردیف اضافه کنید. سال‌ها اختیاری هستند (میلادی)؛ خالی یعنی همه سال‌ها. این اطلاعات در جستجوی «قطعه خودروی من» استفاده می‌شود.</p>
        <datalist id={makesListId}>{CHINESE_CAR_MAKES.map((make) => <option key={make} value={make} />)}</datalist>
        {value.fitments.length > 0 && (
          <div className="space-y-2">
            {value.fitments.map((row, index) => (
              <div key={index} className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--ui-border)] p-3 sm:grid-cols-[1.2fr_1.2fr_0.8fr_0.8fr_1fr_auto] sm:items-end">
                <label className="text-xs text-[var(--ui-muted)]">برند خودرو
                  <input list={makesListId} value={row.make} onChange={(event) => setFitment(index, "make", event.target.value)} maxLength={60} className={fieldClass} required />
                </label>
                <label className="text-xs text-[var(--ui-muted)]">مدل
                  <input value={row.model} onChange={(event) => setFitment(index, "model", event.target.value)} maxLength={80} className={fieldClass} placeholder="تیگو ۵" />
                </label>
                <label className="text-xs text-[var(--ui-muted)]">از سال
                  <input type="number" min="1950" max="2100" value={row.yearFrom} onChange={(event) => setFitment(index, "yearFrom", event.target.value)} className={fieldClass} />
                </label>
                <label className="text-xs text-[var(--ui-muted)]">تا سال
                  <input type="number" min="1950" max="2100" value={row.yearTo} onChange={(event) => setFitment(index, "yearTo", event.target.value)} className={fieldClass} />
                </label>
                <label className="col-span-2 text-xs text-[var(--ui-muted)] sm:col-span-1">موتور
                  <input value={row.engine} onChange={(event) => setFitment(index, "engine", event.target.value)} maxLength={80} className={fieldClass} placeholder="1.5T" />
                </label>
                <button type="button" onClick={() => set("fitments", value.fitments.filter((_, rowIndex) => rowIndex !== index))} aria-label={"حذف ردیف سازگاری " + (index + 1)} className="col-span-2 inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-[var(--ui-border)] px-3 text-xs text-[var(--ui-danger)] hover:bg-[var(--ui-danger-bg)] sm:col-span-1">
                  <Trash2 size={15} aria-hidden="true" /><span className="sm:sr-only">حذف</span>
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" disabled={value.fitments.length >= 60} onClick={() => set("fitments", [...value.fitments, emptyFitment()])} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-dashed border-[var(--ui-border-strong)] px-4 py-2 text-sm text-[var(--ui-text)] hover:bg-[var(--ui-hover)] disabled:opacity-50">
          <Plus size={16} aria-hidden="true" />افزودن خودروی سازگار
        </button>
      </section>
    </>
  );
};

export default PartFieldsEditor;

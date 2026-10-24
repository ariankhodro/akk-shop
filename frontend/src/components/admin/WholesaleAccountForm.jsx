import { useState } from "react";
import { KeyRound, LoaderCircle, UserPlus } from "lucide-react";
import toast from "react-hot-toast";
import axios from "../../lib/axios";
import { getPasswordPolicyError } from "../../lib/password-policy";
import { emptyWholesaleProfile, generateTemporaryPassword, wholesaleProfilePayload } from "../../lib/wholesale-accounts";

export const WholesaleProfileFields = ({ value, onChange, fieldClass, idPrefix }) => {
  const set = (field, next) => onChange({ ...value, [field]: next });
  const labelClass = "block text-xs font-semibold text-[var(--ui-muted)]";
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className={labelClass} htmlFor={idPrefix + "-company"}>نام فروشگاه / شرکت *
      <input id={idPrefix + "-company"} className={fieldClass + " mt-1"} value={value.companyName} maxLength={120} onChange={(event) => set("companyName", event.target.value)} required />
    </label>
    <label className={labelClass} htmlFor={idPrefix + "-city"}>شهر
      <input id={idPrefix + "-city"} className={fieldClass + " mt-1"} value={value.city} maxLength={80} onChange={(event) => set("city", event.target.value)} />
    </label>
    <label className={labelClass} htmlFor={idPrefix + "-phone"}>تلفن تماس
      <input id={idPrefix + "-phone"} dir="ltr" inputMode="tel" className={fieldClass + " mt-1"} value={value.contactPhone} maxLength={20} onChange={(event) => set("contactPhone", event.target.value)} placeholder="09121234567" />
    </label>
    <label className={labelClass} htmlFor={idPrefix + "-tax"}>شناسه ملی / کد اقتصادی
      <input id={idPrefix + "-tax"} dir="ltr" inputMode="numeric" className={fieldClass + " mt-1"} value={value.taxId} maxLength={16} onChange={(event) => set("taxId", event.target.value)} />
    </label>
    <label className={labelClass} htmlFor={idPrefix + "-discount"}>تخفیف اختصاصی روی قیمت عمده (٪)
      <input id={idPrefix + "-discount"} type="number" min="0" max="50" step="0.5" className={fieldClass + " mt-1"} value={value.discountPercent} onChange={(event) => set("discountPercent", event.target.value)} />
    </label>
    <label className={labelClass + " sm:col-span-2"} htmlFor={idPrefix + "-notes"}>یادداشت داخلی
      <textarea id={idPrefix + "-notes"} rows={2} className={fieldClass + " mt-1"} value={value.notes} maxLength={500} onChange={(event) => set("notes", event.target.value)} />
    </label>
  </div>;
};

const initialForm = () => ({ name: "", email: "", password: "", accountType: "wholesale", profile: emptyWholesaleProfile() });

export default function WholesaleAccountForm({ onCreated, fieldClass }) {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const passwordError = getPasswordPolicyError(form.password);
    if (passwordError) { setError(passwordError); return; }
    if (form.accountType === "wholesale" && !form.profile.companyName.trim()) { setError("نام فروشگاه یا شرکت همکار الزامی است."); return; }
    const discount = Number(form.profile.discountPercent || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 50) { setError("درصد تخفیف اختصاصی باید بین ۰ تا ۵۰ باشد."); return; }
    setSaving(true);
    try {
      const { data } = await axios.post("/admin/customers", {
        name: form.name.trim(), email: form.email.trim(), password: form.password, accountType: form.accountType, mustChangePassword: true,
        ...(form.accountType === "wholesale" ? { wholesaleProfile: wholesaleProfilePayload(form.profile) } : {}),
      });
      toast.success("حساب ایجاد شد");
      setCreated({ email: data.customer?.email || form.email.trim(), password: form.password });
      setForm(initialForm());
      onCreated?.(data.customer);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "ایجاد حساب ناموفق بود.");
    } finally { setSaving(false); }
  };

  const labelClass = "block text-xs font-semibold text-[var(--ui-muted)]";
  return <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 sm:p-5" aria-labelledby="wholesale-create-title">
    <div>
      <h3 id="wholesale-create-title" className="flex items-center gap-2 text-base font-bold text-[var(--ui-text)]"><UserPlus size={18} className="text-[var(--ui-accent)]" aria-hidden="true" />ایجاد حساب همکار عمده</h3>
      <p className="mt-1 text-xs leading-5 text-[var(--ui-muted)]">ثبت‌نام عمومی همیشه حساب خرده‌فروشی می‌سازد؛ حساب همکاران عمده فقط از اینجا ساخته می‌شود. رمز اولیه را از راه امن به همکار بدهید؛ او هنگام اولین ورود باید رمز جدید انتخاب کند.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={labelClass}>نام و نام خانوادگی مسئول *
        <input className={fieldClass + " mt-1"} value={form.name} minLength={2} maxLength={100} onChange={(event) => set("name", event.target.value)} required />
      </label>
      <label className={labelClass}>ایمیل ورود *
        <input type="email" dir="ltr" className={fieldClass + " mt-1"} value={form.email} maxLength={254} onChange={(event) => set("email", event.target.value)} required />
      </label>
      <label className={labelClass}>نوع حساب
        <select className={fieldClass + " mt-1"} value={form.accountType} onChange={(event) => set("accountType", event.target.value)}>
          <option value="wholesale">همکار عمده</option>
          <option value="retail">مشتری خرده‌فروشی</option>
        </select>
      </label>
      <label className={labelClass}>رمز عبور اولیه *
        <span className="mt-1 flex gap-2">
          <input type="text" dir="ltr" autoComplete="off" spellCheck={false} className={fieldClass + " font-mono"} value={form.password} maxLength={72} onChange={(event) => set("password", event.target.value)} required />
          <button type="button" onClick={() => set("password", generateTemporaryPassword())} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-[var(--ui-border)] px-3 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"><KeyRound size={14} aria-hidden="true" />رمز تصادفی</button>
        </span>
      </label>
    </div>
    {form.accountType === "wholesale" && <WholesaleProfileFields value={form.profile} onChange={(profile) => set("profile", profile)} fieldClass={fieldClass} idPrefix="wholesale-create" />}
    {error && <p role="alert" className="rounded-lg border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-3 text-sm text-[var(--ui-danger)]">{error}</p>}
    {created && <p role="status" className="rounded-lg border border-[var(--ui-success-border)] bg-[var(--ui-success-bg)] p-3 text-sm leading-6 text-[var(--ui-success)]">حساب <span dir="ltr">{created.email}</span> ساخته شد. رمز اولیه: <code dir="ltr" className="select-all font-mono">{created.password}</code> (فقط همین یک بار نمایش داده می‌شود).</p>}
    <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-5 text-sm font-semibold text-[var(--ui-button-text)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-50">{saving ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}ایجاد حساب</button>
  </form>;
}

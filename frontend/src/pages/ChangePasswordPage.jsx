import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LoaderCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useUserStore } from "../stores/useUserStore";
import { getPasswordPolicyError } from "../lib/password-policy";
import { getUserErrorMessage } from "../lib/user-error-message";

const inputClass = "mt-1.5 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-4 text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/25";

// Required after an administrator issues a temporary password (wholesale
// accounts are pre-created), and available from the profile at any time.
const ChangePasswordPage = () => {
  const { user, changePassword, logout } = useUserStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const forced = user?.mustChangePassword === true;

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.currentPassword) nextErrors.currentPassword = "رمز عبور فعلی را وارد کنید.";
    const policyError = getPasswordPolicyError(form.newPassword);
    if (policyError) nextErrors.newPassword = policyError;
    if (form.newPassword && form.newPassword === form.currentPassword) nextErrors.newPassword = "رمز عبور جدید باید با رمز فعلی متفاوت باشد.";
    if (form.newPassword !== form.confirmPassword) nextErrors.confirmPassword = "تکرار رمز عبور یکسان نیست.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success("رمز عبور تغییر کرد");
      navigate(user?.accountType === "wholesale" ? "/wholesale/quick-order" : "/profile", { replace: true });
    } catch (error) {
      const fieldErrors = error.response?.data?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") setErrors(fieldErrors);
      else toast.error(getUserErrorMessage(error, "تغییر رمز عبور ناموفق بود."));
    } finally {
      setSaving(false);
    }
  };

  const field = (name, label, autoComplete) => (
    <div>
      <label htmlFor={"cp-" + name} className="text-sm font-semibold text-[var(--ui-text-strong)]">{label}</label>
      <input id={"cp-" + name} type="password" autoComplete={autoComplete} value={form[name]} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? "cp-" + name + "-error" : undefined}
        onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className={inputClass} />
      {errors[name] && <p id={"cp-" + name + "-error"} role="alert" className="mt-1.5 text-xs leading-5 text-[var(--ui-danger)]">{errors[name]}</p>}
    </div>
  );

  return (
    <main dir="rtl" className="flex min-h-[70vh] items-start justify-center bg-[var(--ui-canvas)] px-4 py-10 text-[var(--ui-text)]">
      <section aria-labelledby="change-password-heading" className="w-full max-w-lg rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-6 sm:p-9">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]"><KeyRound size={20} aria-hidden="true" /></span>
        <h1 id="change-password-heading" className="mt-4 text-2xl font-bold">{forced ? "تعیین رمز عبور جدید" : "تغییر رمز عبور"}</h1>
        <p className="mt-2 text-sm leading-7 text-[var(--ui-muted)]">
          {forced
            ? "رمز عبور فعلی شما موقت است و توسط میبا صادر شده. برای ادامه، یک رمز عبور جدید و شخصی انتخاب کنید."
            : "پس از تغییر رمز، همه دستگاه‌های دیگر از حساب خارج می‌شوند."}
        </p>
        <form onSubmit={submit} noValidate className="mt-6 space-y-4">
          {field("currentPassword", forced ? "رمز عبور موقت" : "رمز عبور فعلی", "current-password")}
          {field("newPassword", "رمز عبور جدید", "new-password")}
          {field("confirmPassword", "تکرار رمز عبور جدید", "new-password")}
          <p className="text-xs leading-6 text-[var(--ui-muted)]">حداقل ۱۲ نویسه، ترکیبی از حروف، عدد و نماد؛ از رمزهای ساده و تکراری استفاده نکنید.</p>
          <button type="submit" disabled={saving} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-5 text-sm font-bold text-white transition hover:bg-[var(--ui-accent-hover)] disabled:opacity-60">
            {saving && <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />}
            {saving ? "در حال ذخیره…" : "ذخیره رمز عبور جدید"}
          </button>
          {forced && (
            <button type="button" onClick={() => logout()} className="w-full text-center text-xs font-semibold text-[var(--ui-muted)] underline underline-offset-4">خروج از حساب</button>
          )}
        </form>
      </section>
    </main>
  );
};

export default ChangePasswordPage;

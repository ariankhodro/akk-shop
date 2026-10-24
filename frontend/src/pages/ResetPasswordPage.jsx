import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, LockKeyhole, LoaderCircle, CheckCircle2 } from "lucide-react";
import axios from "../lib/axios";
import PageMeta from "../components/PageMeta";
import { getPasswordPolicyError } from "../lib/password-policy";

const ResetPasswordPage = () => {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setMessage(""); setError("");
    if (!token) { setError("لینک بازیابی معتبر نیست یا توکن آن وجود ندارد."); return; }
    if (password !== confirm) { setError("تکرار رمز عبور یکسان نیست."); return; }
    const passwordError = getPasswordPolicyError(password);
    if (passwordError) { setError(passwordError); return; }
    setLoading(true);
    try {
      const response = await axios.post("/auth/reset-password", { token, password });
      setMessage(response.data.message || "رمز عبور تغییر کرد.");
      setPassword(""); setConfirm("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "لینک بازیابی نامعتبر یا منقضی شده است.");
    } finally { setLoading(false); }
  };
  const field = "mt-2 w-full rounded-xl border border-[#dedbd2] bg-white px-4 py-3 text-sm text-[#252722] outline-none focus:border-[#68745f] focus:ring-4 focus:ring-[#68745f]/10";
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f5f0] px-4 py-10 text-[#252722]">
    <PageMeta title="تنظیم رمز عبور جدید" description="یک رمز عبور جدید و امن برای حساب تیک بوتیک تعیین کنید." path="/reset-password" robots="noindex, nofollow" />
    <section dir="rtl" className="w-full max-w-md rounded-3xl border border-[#e5e0d6] bg-[#fffefa] p-6 shadow-xl sm:p-9">
      <Link to="/" className="font-serif text-2xl font-semibold">تیک بوتیک</Link>
      <h1 className="mt-8 text-2xl font-bold">تنظیم رمز عبور جدید</h1>
      {!token && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">این لینک بازیابی توکن معتبر ندارد؛ درخواست لینک تازه‌ای کنید.</p>}
      {!message && <form onSubmit={submit} className="mt-6 space-y-4">
        <label htmlFor="reset-password" className="block text-sm font-medium">رمز عبور جدید
          <span className="relative mt-2 block"><input id="reset-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={64} required value={password} onChange={(event) => setPassword(event.target.value)} className={field + " pl-12"} dir="ltr" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"} aria-pressed={showPassword} className="absolute left-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#77786f] hover:bg-[#e9ede4]">{showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></span>
          <span className="mt-2 block text-xs leading-5 text-[#77786f]">حداقل ۱۲ نویسه با حروف کوچک و بزرگ انگلیسی، عدد و نماد؛ یا عبارت چندواژه‌ای حداقل ۱۶ نویسه‌ای شامل حرف، عدد و نماد.</span>
        </label>
        <label htmlFor="reset-password-confirm" className="block text-sm font-medium">تکرار رمز عبور
          <span className="relative mt-2 block"><input id="reset-password-confirm" name="confirmPassword" type={showConfirm ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={64} required value={confirm} onChange={(event) => setConfirm(event.target.value)} className={field + " pl-12"} dir="ltr" /><button type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? "پنهان کردن تکرار رمز عبور" : "نمایش تکرار رمز عبور"} aria-pressed={showConfirm} className="absolute left-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#77786f] hover:bg-[#e9ede4]">{showConfirm ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></span>
        </label>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={loading || !token} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#252722] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{loading ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <LockKeyhole size={17} aria-hidden="true" />}ذخیره رمز عبور جدید</button>
      </form>}
      {message && <div role="status" className="mt-6 space-y-3 rounded-xl bg-[#e9ede4] p-4 text-sm leading-6 text-[#41443b]"><CheckCircle2 size={19} aria-hidden="true" />{message}<Link to="/login" className="block font-semibold underline underline-offset-4">رفتن به صفحه ورود</Link></div>}
    </section>
  </main>;
};
export default ResetPasswordPage;

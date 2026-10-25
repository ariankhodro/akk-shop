import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useUserStore } from "../stores/useUserStore";
import { getPasswordPolicyError } from "../lib/password-policy";

const SignUpPage = () => {
	const location = useLocation();
	const [formData, setFormData] = useState({ name: "", email: "", password: "", confirmPassword: "" });
	const [showPassword, setShowPassword] = useState(false);
	const [passwordError, setPasswordError] = useState("");
	const { signup, loading } = useUserStore();

	const updateField = (field) => (event) => {
		setFormData((current) => ({ ...current, [field]: event.target.value }));
	};

	const handleSubmit = (event) => {
		event.preventDefault();
		const nextPasswordError = getPasswordPolicyError(formData.password);
		if (nextPasswordError) {
			setPasswordError(nextPasswordError);
			document.getElementById("signup-password")?.focus();
			return;
		}
		if (formData.password !== formData.confirmPassword) {
			setPasswordError("تکرار رمز عبور با رمز واردشده یکسان نیست.");
			document.getElementById("signup-confirm-password")?.focus();
			return;
		}
		setPasswordError("");
		signup({ ...formData, name: formData.name.trim(), email: formData.email.trim() });
	};

	return (
		<main className="flex min-h-screen items-center justify-center bg-[#f5f6f8] px-4 py-8 text-[#1c1f24] sm:px-6 sm:py-10">
			<div className="w-full max-w-xl overflow-hidden rounded-[2rem] border border-[#e1e4e9] bg-[#ffffff] shadow-[0_28px_90px_-42px_rgba(28,31,36,0.28)]">
<motion.section
					className="flex items-center px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12"
					initial={{ opacity: 0, y: 14 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.45, delay: 0.05 }}
					aria-labelledby="signup-heading"
				>
					<div className="mx-auto w-full max-w-md">
						<Link to="/" aria-label="میبا، صفحه اصلی" className="inline-flex items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ea580c]">
							<img src="/miba-logo.svg" alt="میبا" width="165" height="48" className="h-10 w-auto" />
						</Link>

						<div className="mt-8">
							<div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff1e7] text-[#ea580c]">
								<Sparkles size={20} aria-hidden="true" />
							</div>
							<p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#ea580c]">به مجموعه ما بپیوندید</p>
							<h1 id="signup-heading" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">ساخت حساب مشتری<span className="text-[#ea580c]">.</span></h1>
							<p className="mt-3 text-sm leading-6 text-[#6b717b]">با حساب کاربری، قطعات خودروی خود را سریع‌تر سفارش دهید، نشانی‌ها را ذخیره کنید و وضعیت ارسال را پیگیری کنید.</p>
							<p className="mt-3 rounded-xl border border-[#e2e5ea] bg-[#f5f6f8] p-3 text-xs leading-6 text-[#5a606a]">این فرم برای خرید خرده‌فروشی است. حساب‌های همکاری عمده توسط میبا صادر می‌شوند و ثبت‌نام آنلاین ندارند؛ اگر حساب عمده دارید از <Link to="/login?wholesale=1" className="font-semibold text-[#ea580c] underline underline-offset-4">ورود همکاران</Link> استفاده کنید.</p>
						</div>

						<form onSubmit={handleSubmit} className="mt-7 space-y-4">
							<div>
								<label htmlFor="signup-name" className="mb-2 block text-sm font-medium text-[#33373e]">نام و نام خانوادگی</label>
								<div className="relative">
									<UserRound className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#868c95]" size={18} aria-hidden="true" />
									<input id="signup-name" name="name" type="text" autoComplete="name" required value={formData.name} onChange={updateField("name")} placeholder="نام شما" className="w-full rounded-xl border border-[#dde1e6] bg-white py-3.5 pl-11 pr-4 text-sm text-[#1c1f24] outline-none transition placeholder:text-[#a2a7af] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10" />
								</div>
							</div>

							<div>
								<label htmlFor="signup-email" className="mb-2 block text-sm font-medium text-[#33373e]">نشانی ایمیل</label>
								<div className="relative">
									<Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#868c95]" size={18} aria-hidden="true" />
									<input id="signup-email" name="email" type="email" autoComplete="email" required value={formData.email} onChange={updateField("email")} placeholder="you@example.com" className="w-full rounded-xl border border-[#dde1e6] bg-white py-3.5 pl-11 pr-4 text-sm text-[#1c1f24] outline-none transition placeholder:text-[#a2a7af] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10" />
								</div>
							</div>

							<div>
								<label htmlFor="signup-password" className="mb-2 block text-sm font-medium text-[#33373e]">رمز عبور</label>
								<div className="relative">
									<LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#868c95]" size={18} aria-hidden="true" />
									<input id="signup-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={64} required value={formData.password} onChange={(event) => { updateField("password")(event); setPasswordError(""); }} aria-describedby="password-requirements" placeholder="حداقل ۱۲ نویسه و ترکیب امن" className="w-full rounded-xl border border-[#dde1e6] bg-white py-3.5 pl-12 pr-11 text-sm text-[#1c1f24] outline-none transition placeholder:text-[#a2a7af] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10" />
									<button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "پنهان کردن هر دو رمز" : "نمایش هر دو رمز"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#868c95] transition hover:bg-[#f0f2f5] hover:text-[#1c1f24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ea580c]">
										{showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
									</button>
								</div>
								<p id="password-requirements" className="mt-2 text-xs leading-5 text-[#6b717b]">حداقل ۱۲ نویسه با حروف کوچک و بزرگ انگلیسی، عدد و نماد؛ یا عبارت چندواژه‌ای حداقل ۱۶ نویسه‌ای شامل حرف، عدد و نماد.</p>
								{passwordError && <p role="alert" className="mt-2 text-xs leading-5 text-red-600">{passwordError}</p>}
							</div>

							<div>
								<label htmlFor="signup-confirm-password" className="mb-2 block text-sm font-medium text-[#33373e]">تکرار رمز عبور</label>
								<div className="relative">
									<LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#868c95]" size={18} aria-hidden="true" />
									<input id="signup-confirm-password" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={64} required value={formData.confirmPassword} onChange={(event) => { updateField("confirmPassword")(event); setPasswordError(""); }} placeholder="رمز عبور را دوباره وارد کنید" className="w-full rounded-xl border border-[#dde1e6] bg-white py-3.5 pl-11 pr-12 text-sm text-[#1c1f24] outline-none transition placeholder:text-[#a2a7af] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10" />
								</div>
							</div>

							<button type="submit" disabled={loading} className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ea580c] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#c2410c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c] disabled:cursor-not-allowed disabled:opacity-60">
								{loading ? "در حال ایجاد حساب..." : "ایجاد حساب کاربری"}
								{!loading && <ArrowLeft size={17} className="transition-transform group-hover:-translate-x-1" aria-hidden="true" />}
							</button>
						</form>

						<div className="mt-5 flex items-center gap-2 text-xs leading-5 text-[#7d838d]">
							<ShieldCheck size={16} className="shrink-0 text-[#ea580c]" aria-hidden="true" />
							اطلاعات شما خصوصی و محافظت‌شده باقی می‌ماند.
						</div>
						<p className="mt-6 text-center text-sm text-[#6b717b]">از قبل حساب کاربری دارید؟{" "}<Link to="/login" state={location.state?.from ? { from: location.state.from } : undefined} className="font-semibold text-[#ea580c] underline decoration-[#ea580c]/30 underline-offset-4 transition hover:text-[#33373e]">ورود</Link></p>
					</div>
				</motion.section>
			</div>
		</main>
	);
};

export default SignUpPage;

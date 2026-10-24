import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Wrench } from "lucide-react";
import { useUserStore } from "../stores/useUserStore";

const LoginPage = () => {
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const wholesale = searchParams.get("wholesale") === "1";
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const { login, loading } = useUserStore();

	const handleSubmit = (event) => {
		event.preventDefault();
		login(email.trim(), password);
	};

	return (
		<main className="flex min-h-screen items-center justify-center bg-[#f5f6f8] px-4 py-8 text-[#1c1f24] sm:px-6 sm:py-10">
			<div className="w-full max-w-xl overflow-hidden rounded-[2rem] border border-[#e1e4e9] bg-[#ffffff] shadow-[0_28px_90px_-42px_rgba(28,31,36,0.28)]">
				<motion.section
					className="flex items-center px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12"
					initial={{ opacity: 0, y: 14 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.45 }}
					aria-labelledby="login-heading"
				>
					<div className="mx-auto w-full max-w-md">
						<Link to="/" aria-label="میبا، صفحه اصلی" className="inline-flex items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ea580c]">
							<img src="/miba-logo.svg" alt="میبا" width="165" height="48" className="h-10 w-auto" />
						</Link>

						<div className="mt-10">
							<div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff1e7] text-[#ea580c]">
								{wholesale ? <Building2 size={20} aria-hidden="true" /> : <Wrench size={20} aria-hidden="true" />}
							</div>
							<p className="text-xs font-semibold tracking-wide text-[#ea580c]">{wholesale ? "پنل همکاران" : "خوش آمدید"}</p>
							<h1 id="login-heading" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{wholesale ? "ورود همکاران عمده" : "ورود به حساب کاربری"}<span className="text-[#ea580c]">.</span></h1>
							<p className="mt-4 max-w-sm text-sm leading-6 text-[#6b717b]">
								{wholesale
									? "با ایمیل و رمز عبوری که میبا برای فروشگاه شما صادر کرده وارد شوید تا قیمت‌های همکاری و سفارش سریع با کد فنی فعال شود."
									: "وارد شوید و خرید قطعات را از همان‌جایی که مانده بود ادامه دهید."}
							</p>
						</div>

						<form onSubmit={handleSubmit} className="mt-9 space-y-5">
							<div>
								<label htmlFor="login-email" className="mb-2 block text-sm font-medium text-[#33373e]">نشانی ایمیل</label>
								<div className="relative">
									<Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#868c95]" size={18} aria-hidden="true" />
									<input id="login-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" dir="ltr" className="w-full rounded-xl border border-[#dde1e6] bg-white py-3.5 pl-11 pr-4 text-sm text-[#1c1f24] outline-none transition placeholder:text-[#a2a7af] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10" />
								</div>
							</div>

							<div>
								<div className="mb-2 flex items-center justify-between gap-3">
									<label htmlFor="login-password" className="block text-sm font-medium text-[#33373e]">رمز عبور</label>
								</div>
								<div className="relative">
									<LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#868c95]" size={18} aria-hidden="true" />
									<input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="رمز عبور خود را وارد کنید" className="w-full rounded-xl border border-[#dde1e6] bg-white py-3.5 pl-12 pr-11 text-sm text-[#1c1f24] outline-none transition placeholder:text-[#a2a7af] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10" />
									<button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#868c95] transition hover:bg-[#f0f2f5] hover:text-[#1c1f24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ea580c]">
										{showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
									</button>
								</div>
							</div>

							<button type="submit" disabled={loading} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#ea580c] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#c2410c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c] disabled:cursor-not-allowed disabled:opacity-60">
								{loading ? "در حال ورود..." : "ورود"}
								{!loading && <ArrowLeft size={17} className="transition-transform group-hover:-translate-x-1" aria-hidden="true" />}
							</button>
						</form>
                        <p className="mt-3 text-left text-sm"><Link to="/forgot-password" className="font-semibold text-[#ea580c] underline underline-offset-4">رمز عبور را فراموش کرده‌اید؟</Link></p>

						<div className="mt-7 flex items-center gap-2 text-xs leading-5 text-[#7d838d]">
							<ShieldCheck size={16} className="shrink-0 text-[#ea580c]" aria-hidden="true" />
							اطلاعات حساب شما به‌صورت امن نگهداری می‌شود.
						</div>
						{wholesale ? (
							<p className="mt-8 rounded-xl border border-[#e2e5ea] bg-[#f5f6f8] p-4 text-xs leading-6 text-[#5a606a]">
								حساب همکاری عمده فقط پس از بررسی توسط میبا ساخته می‌شود و ثبت‌نام آنلاین ندارد. برای دریافت حساب عمده با پشتیبانی فروش میبا تماس بگیرید.{" "}
								<Link to="/login" className="font-semibold text-[#ea580c] underline underline-offset-4">ورود مشتریان خرده‌فروشی</Link>
							</p>
						) : (
							<>
								<p className="mt-8 text-center text-sm text-[#6b717b]">تازه به ما پیوسته‌اید؟{" "}<Link to="/signup" state={location.state?.from ? { from: location.state.from } : undefined} className="font-semibold text-[#ea580c] underline decoration-[#ea580c]/30 underline-offset-4 transition hover:text-[#33373e]">ایجاد حساب کاربری</Link></p>
								<p className="mt-3 text-center text-xs text-[#6b717b]">تعمیرگاه یا فروشگاه لوازم یدکی هستید؟{" "}<Link to="/login?wholesale=1" className="font-semibold text-[#ea580c] underline underline-offset-4">ورود همکاران عمده</Link></p>
							</>
						)}
					</div>
				</motion.section>
</div>
		</main>
	);
};

export default LoginPage;

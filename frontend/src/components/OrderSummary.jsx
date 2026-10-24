import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, LoaderCircle, Truck } from "lucide-react";
import toast from "react-hot-toast";
import { useCartStore } from "../stores/useCartStore";
import { useUserStore } from "../stores/useUserStore";
import axios from "../lib/axios";
import { formatPrice, STORE_CURRENCY } from "../lib/commerce";
import { normalizeDigits } from "../lib/normalize-digits";
import GiftCouponCard from "./GiftCouponCard";

const provinces = [
  "آذربایجان شرقی", "آذربایجان غربی", "اردبیل", "اصفهان", "البرز", "ایلام",
  "بوشهر", "تهران", "چهارمحال و بختیاری", "خراسان جنوبی", "خراسان رضوی",
  "خراسان شمالی", "خوزستان", "زنجان", "سمنان", "سیستان و بلوچستان", "فارس",
  "قزوین", "قم", "کردستان", "کرمان", "کرمانشاه", "کهگیلویه و بویراحمد",
  "گلستان", "گیلان", "لرستان", "مازندران", "مرکزی", "هرمزگان", "همدان", "یزد",
];
const normalizeIranPhone = (value) => {
  let digits = normalizeDigits(value).replace(/\D/g, "");
  if (digits.startsWith("0098") && digits.length === 14) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("98") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && digits.startsWith("9")) digits = `0${digits}`;
  return digits;
};

const emptyShippingAddress = { recipientName: "", phone: "", province: "", city: "", district: "", addressLine: "", postalCode: "", notes: "" };
const validateShippingAddress = delivery => {
  const errors = {};
  if (delivery.recipientName.length < 2) errors.recipientName = "نام گیرنده را کامل وارد کنید.";
  if (!/^09\d{9}$/.test(delivery.phone)) errors.phone = "شماره موبایل باید ۱۱ رقم و با 09 شروع شود.";
  if (!delivery.province) errors.province = "استان را انتخاب کنید.";
  if (delivery.city.length < 2) errors.city = "نام شهر را کامل وارد کنید.";
  if (!/^\d{10}$/.test(delivery.postalCode)) errors.postalCode = "کد پستی باید دقیقاً ۱۰ رقم باشد.";
  if (delivery.addressLine.length < 10) errors.addressLine = "نشانی کامل باید دست‌کم ۱۰ نویسه داشته باشد.";
  return errors;
};
const FieldError = ({ id, message }) => message
  ? <span id={id} role="alert" className="mt-1.5 block text-xs leading-5 text-[var(--ui-danger)]">{message}</span>
  : null;

const OrderSummary = () => {
  const { total, subtotal, coupon, isCouponApplied, cart, isMergingGuestCart } = useCartStore();
  const { user } = useUserStore();
  const navigate = useNavigate();
  const hasUnmergedItems = cart.some((item) => item.guestOnly);
  const [paymentConfig, setPaymentConfig] = useState({
    provider: "zarinpal",
    currency: STORE_CURRENCY,
    configured: false,
    loading: true,
    message: "",
  });
  const [shipping, setShipping] = useState({ shippingFee: 0, flatRate: 0, freeShippingThreshold: 0, loading: true, error: "" });
  const [shippingRetry, setShippingRetry] = useState(0);
  const [paymentRetry, setPaymentRetry] = useState(0);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [shippingAddress, setShippingAddress] = useState(emptyShippingAddress);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [hasDefaultAddress, setHasDefaultAddress] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [saveAddressForNextTime, setSaveAddressForNextTime] = useState(false);
  const [addressSaveMessage, setAddressSaveMessage] = useState("");
  const fieldRefs = useRef({});
  const addressFieldClass = field => "mt-1 w-full rounded-lg border bg-[var(--ui-input-bg)] px-3 py-2.5 text-sm text-[var(--ui-text)] outline-none transition placeholder:text-[var(--ui-muted)] focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/25 " + (fieldErrors[field] ? "border-[var(--ui-danger)] focus:border-[var(--ui-danger)] focus:ring-[var(--ui-danger)]/25" : "border-[var(--ui-border)]");

  const savings = Math.max(0, subtotal - total);
  const estimatedTotal = total + Number(shipping.shippingFee || 0);

  useEffect(() => {
    if (!user?._id) {
      setHasDefaultAddress(false);
      setSavedAddresses([]);
      setSelectedAddressId("");
      setShippingAddress(emptyShippingAddress);
      return undefined;
    }
    let active = true;
    axios.get("/auth/profile").then(({ data }) => {
      if (!active) return;
      const legacy = data?.defaultShippingAddress;
      const addresses = Array.isArray(data?.savedShippingAddresses) && data.savedShippingAddresses.length
        ? data.savedShippingAddresses
        : legacy?.addressLine ? [{ ...legacy, _id: "legacy-default", label: "نشانی پیش‌فرض", isDefault: true }] : [];
      setSavedAddresses(addresses);
      const preferred = addresses.find(address => address.isDefault) || addresses[0];
      if (!preferred) return;
      setHasDefaultAddress(Boolean(preferred.isDefault));
      setSelectedAddressId(String(preferred._id));
      setShippingAddress(current => Object.values(current).some(value => String(value || "").trim())
        ? current : { ...emptyShippingAddress, ...preferred });
    }).catch(() => {});
    return () => { active = false; };
  }, [user?._id]);

  const selectSavedAddress = (addressId) => {
    setSelectedAddressId(addressId);
    const selected = savedAddresses.find(address => String(address._id) === addressId);
    setHasDefaultAddress(Boolean(selected?.isDefault));
    setShippingAddress(selected ? { ...emptyShippingAddress, ...selected } : { ...emptyShippingAddress });
    setFieldErrors({});
    setFormError("");
    setAddressSaveMessage("");
    setSaveAddressForNextTime(false);
  };

  const updateAddressField = (field, value) => {
    setShippingAddress(current => ({ ...current, [field]: value }));
    setFieldErrors(current => {
      if (!current[field]) return current;
      const next = { ...current }; delete next[field]; return next;
    });
    setFormError("");
    setAddressSaveMessage("");
  };

  useEffect(() => {
    let active = true;
    setPaymentConfig(current => ({ ...current, loading: true, message: "" }));
    axios.get("/payments/provider")
      .then(({ data }) => {
        if (!active) return;
        const backendCurrency = String(data.currency || "IRT").toUpperCase();
        const currencyMatches = backendCurrency === "IRT";
        const configured = Boolean(data.configured && currencyMatches);
        const message = !currencyMatches
          ? "واحد پول فروشگاه باید تومان (IRT) باشد؛ تنظیمات سرور را بررسی کنید."
          : data.message;
        setPaymentConfig({ ...data, provider: "zarinpal", currency: "IRT", configured, message, loading: false });
      })
      .catch(() => {
        if (active) setPaymentConfig({
          provider: "zarinpal",
          currency: STORE_CURRENCY,
          configured: false,
          loading: false,
          message: "دریافت تنظیمات پرداخت ناموفق بود. لطفاً بعداً دوباره تلاش کنید.",
        });
      });
    return () => { active = false; };
  }, [paymentRetry]);

  useEffect(() => {
    let active = true;
    setShipping((current) => ({ ...current, loading: true, error: "" }));
    axios.get(`/shipping?subtotal=${encodeURIComponent(total)}`)
      .then(({ data }) => {
        if (active) setShipping({ ...data, loading: false, error: "" });
      })
      .catch(() => {
        if (active) setShipping({ shippingFee: 0, flatRate: 0, freeShippingThreshold: 0, loading: false, error: "دریافت قوانین ارسال ناموفق بود؛ پرداخت تا زمان مشخص‌شدن هزینه ارسال غیرفعال است." });
      });
    return () => { active = false; };
  }, [total, shippingRetry]);

  const handlePayment = async () => {
    if (!cart.length) return toast.error("سبد خرید شما خالی است");
    if (!user) {
      navigate("/login", { state: { from: { pathname: "/cart" } } });
      return;
    }
    if (hasUnmergedItems) {
      return toast.error("ابتدا گزینه‌های موجودی‌نامشخص را از سبد حذف کنید");
    }
    if (!paymentConfig.configured) {
      return toast.error(paymentConfig.message || "درگاه پرداخت در حال حاضر آماده نیست");
    }
    const delivery = {
      ...shippingAddress,
      recipientName: shippingAddress.recipientName.trim(),
      phone: normalizeIranPhone(shippingAddress.phone),
      province: shippingAddress.province.trim(),
      city: shippingAddress.city.trim(),
      district: shippingAddress.district.trim(),
      addressLine: shippingAddress.addressLine.trim(),
      postalCode: normalizeDigits(shippingAddress.postalCode).replace(/\D/g, ""),
      notes: shippingAddress.notes.trim(),
    };
    const nextFieldErrors = validateShippingAddress(delivery);
    setFieldErrors(nextFieldErrors);
    setFormError("");
    if (Object.keys(nextFieldErrors).length) {
      const firstInvalid = Object.keys(nextFieldErrors)[0];
      const element = fieldRefs.current[firstInvalid];
      element?.focus();
      element?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return;
    }

    setCheckoutLoading(true);
    try {
      if (saveAddressForNextTime) {
        try {
          const { data: updatedAddressBook } = await axios.patch("/auth/profile/default-address", { shippingAddress: delivery });
          setHasDefaultAddress(true);
          if (Array.isArray(updatedAddressBook?.savedShippingAddresses)) {
            setSavedAddresses(updatedAddressBook.savedShippingAddresses);
            const preferred = updatedAddressBook.savedShippingAddresses.find(address => address.isDefault);
            if (preferred) setSelectedAddressId(String(preferred._id));
          }
          setAddressSaveMessage("نشانی برای سفارش‌های بعدی ذخیره شد.");
        } catch {
          setAddressSaveMessage("نشانی ذخیره نشد؛ پرداخت بدون تغییر اطلاعات همین سفارش ادامه می‌یابد.");
        }
      }
      const response = await axios.post("/payments/create-checkout", {
        couponCode: coupon && isCouponApplied ? coupon.code : null,
        shippingAddress: delivery,
      });

      if (response.status === 202 || response.data?.status === "pending") {
        const orderId = response.data?.orderId;
        const query = new URLSearchParams({ reason: "verification-pending" });
        if (orderId) query.set("order_id", String(orderId));
        navigate(`/purchase-cancel?${query.toString()}`);
        return;
      }

      if (response.data?.status === "paid" && response.data?.orderId) {
        toast.success("سفارش بدون نیاز به پرداخت ثبت شد.");
        navigate(`/purchase-success?provider=zarinpal&order_id=${encodeURIComponent(response.data.orderId)}`);
        return;
      }

      const redirectUrl = response.data?.redirectUrl;
      if (!redirectUrl || !redirectUrl.startsWith("https://")) {
        throw new Error("نشانی امن درگاه پرداخت دریافت نشد");
      }
      window.location.assign(redirectUrl);
      return;
    } catch (error) {
      const message = error.response?.data?.message || error.message || "شروع پرداخت ناموفق بود";
      const serverFields = error.response?.data?.fieldErrors;
      if (serverFields && typeof serverFields === "object") {
        setFieldErrors(current => ({ ...current, ...serverFields }));
        const firstInvalid = Object.keys(serverFields)[0];
        fieldRefs.current[firstInvalid]?.focus();
        fieldRefs.current[firstInvalid]?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }
      setFormError(message);
      toast.error(message);
      setCheckoutLoading(false);
    }
  };

  return (
    <motion.div
      dir="rtl"
      className="space-y-4 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-sm sm:p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <p className="text-xl font-semibold text-[var(--ui-accent)]">خلاصه سفارش</p>
      {isMergingGuestCart && <p role="status" className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-3 text-xs text-[var(--ui-muted)]">در حال ادغام سبد خرید با حساب شما…</p>}
      {!user && (
        <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-3">
          <p className="text-sm font-semibold text-[var(--ui-text)]">سبد خرید شما محفوظ می‌ماند</p>
          <p className="mt-1 text-xs leading-5 text-[var(--ui-muted)]">برای ثبت سفارش و پرداخت، در مرحله بعد وارد حساب شوید یا حساب بسازید.</p>
        </div>
      )}
      {hasUnmergedItems && (
        <p role="alert" className="rounded-xl border border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] p-3 text-xs leading-6 text-[var(--ui-warning)]">
          بعضی گزینه‌های سبد پس از ورود به حساب به‌طور کامل ادغام نشده‌اند. گزینه‌های نشان‌دار را بررسی کنید و اگر موجود نیستند حذف کنید تا پرداخت ادامه پیدا کند.
        </p>
      )}

      <div className="space-y-4">
      {user && (
        <section className="space-y-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] p-4 sm:p-5" aria-labelledby="delivery-address-title">
          <div>
            <h3 id="delivery-address-title" className="text-base font-bold text-[var(--ui-text)]">نشانی تحویل سفارش</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--ui-muted)]">{hasDefaultAddress ? "نشانی پیش‌فرض ذخیره‌شده وارد شد. برای ذخیره تغییرات، گزینه ذخیره برای سفارش‌های بعدی را فعال کنید." : "شماره موبایل و کد پستی را می‌توانید با ارقام فارسی یا انگلیسی وارد کنید."}</p>
          </div>
          {savedAddresses.length > 0 && (
            <label className="block text-sm text-[var(--ui-muted)]">
              انتخاب از نشانی‌های ذخیره‌شده
              <select className={addressFieldClass("savedAddress")} value={selectedAddressId} onChange={(event) => selectSavedAddress(event.target.value)}>
                <option value="">واردکردن نشانی جدید</option>
                {savedAddresses.map((address) => (
                  <option key={address._id} value={String(address._id)}>
                    {(address.label || "نشانی من") + (address.isDefault ? " · پیش‌فرض" : "") + " — " + address.city + "، " + address.province}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm text-[var(--ui-muted)]">نام و نام خانوادگی گیرنده
              <input autoComplete="name" required maxLength={100} ref={(element) => { fieldRefs.current.recipientName = element; }} aria-invalid={Boolean(fieldErrors.recipientName)} aria-describedby={fieldErrors.recipientName ? "checkout-error-recipientName" : undefined} className={addressFieldClass("recipientName")} value={shippingAddress.recipientName} onChange={(event) => updateAddressField("recipientName", event.target.value)} placeholder="نام گیرنده" />
              <FieldError id="checkout-error-recipientName" message={fieldErrors.recipientName} />
            </label>
            <label className="block text-sm text-[var(--ui-muted)]">شماره موبایل
              <input type="tel" inputMode="tel" autoComplete="tel" required maxLength={18} ref={(element) => { fieldRefs.current.phone = element; }} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "checkout-error-phone" : undefined} className={addressFieldClass("phone")} value={shippingAddress.phone} onChange={(event) => updateAddressField("phone", event.target.value)} placeholder="09123456789" />
              <FieldError id="checkout-error-phone" message={fieldErrors.phone} />
            </label>
            <label className="block text-sm text-[var(--ui-muted)]">استان
              <select autoComplete="address-level1" required ref={(element) => { fieldRefs.current.province = element; }} aria-invalid={Boolean(fieldErrors.province)} aria-describedby={fieldErrors.province ? "checkout-error-province" : undefined} className={addressFieldClass("province")} value={shippingAddress.province} onChange={(event) => updateAddressField("province", event.target.value)}>
                <option value="">انتخاب استان</option>
                {provinces.map((province) => <option key={province} value={province}>{province}</option>)}
              </select>
              <FieldError id="checkout-error-province" message={fieldErrors.province} />
            </label>
            <label className="block text-sm text-[var(--ui-muted)]">شهر
              <input autoComplete="address-level2" required maxLength={80} ref={(element) => { fieldRefs.current.city = element; }} aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? "checkout-error-city" : undefined} className={addressFieldClass("city")} value={shippingAddress.city} onChange={(event) => updateAddressField("city", event.target.value)} placeholder="نام شهر" />
              <FieldError id="checkout-error-city" message={fieldErrors.city} />
            </label>
            <label className="block text-sm text-[var(--ui-muted)]">محله (اختیاری)
              <input maxLength={80} className={addressFieldClass("district")} value={shippingAddress.district} onChange={(event) => updateAddressField("district", event.target.value)} placeholder="محله یا منطقه" />
            </label>
            <label className="block text-sm text-[var(--ui-muted)]">کد پستی ۱۰ رقمی
              <input inputMode="numeric" autoComplete="postal-code" required maxLength={10} ref={(element) => { fieldRefs.current.postalCode = element; }} aria-invalid={Boolean(fieldErrors.postalCode)} aria-describedby={fieldErrors.postalCode ? "checkout-error-postalCode" : undefined} className={addressFieldClass("postalCode")} value={shippingAddress.postalCode} onChange={(event) => updateAddressField("postalCode", event.target.value)} placeholder="1234567890" />
              <FieldError id="checkout-error-postalCode" message={fieldErrors.postalCode} />
            </label>
          </div>
          <label className="block text-sm text-[var(--ui-muted)]">نشانی کامل و پلاک
            <textarea autoComplete="street-address" required minLength={10} maxLength={500} rows={3} ref={(element) => { fieldRefs.current.addressLine = element; }} aria-invalid={Boolean(fieldErrors.addressLine)} aria-describedby={fieldErrors.addressLine ? "checkout-error-addressLine" : undefined} className={addressFieldClass("addressLine")} value={shippingAddress.addressLine} onChange={(event) => updateAddressField("addressLine", event.target.value)} placeholder="خیابان، کوچه، پلاک، واحد و نشانه‌های لازم برای تحویل" />
            <FieldError id="checkout-error-addressLine" message={fieldErrors.addressLine} />
          </label>
          <label className="block text-sm text-[var(--ui-muted)]">توضیحات تحویل (اختیاری)
            <textarea maxLength={500} rows={2} className={addressFieldClass("notes")} value={shippingAddress.notes} onChange={(event) => updateAddressField("notes", event.target.value)} placeholder="زمان مناسب یا توضیحات تکمیلی برای پیک" />
          </label>
          <label className="flex items-start gap-2.5 text-sm text-[var(--ui-text)]">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--ui-accent)]" checked={saveAddressForNextTime} onChange={(event) => { setSaveAddressForNextTime(event.target.checked); setAddressSaveMessage(""); }} />
            <span>این نشانی را برای سفارش‌های بعدی ذخیره کن و نشانی پیش‌فرض قرار بده</span>
          </label>
          {addressSaveMessage && <p role="status" className={`rounded-lg border p-3 text-xs leading-5 ${addressSaveMessage.includes("ذخیره شد") ? "border-[var(--ui-success-border)] bg-[var(--ui-success-bg)] text-[var(--ui-success)]" : "border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] text-[var(--ui-warning)]"}`}>{addressSaveMessage}</p>}
          {formError && <p role="alert" className="rounded-lg border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-3 text-sm leading-6 text-[var(--ui-danger)]">{formError}</p>}
          <GiftCouponCard />
        </section>
      )}
        <div className="space-y-3">
          <dl className="flex items-center justify-between gap-4">
            <dt className="text-sm font-normal text-[var(--ui-muted)]">قیمت محصولات</dt>
            <dd dir="ltr" className="text-sm font-medium text-[var(--ui-text)]">{formatPrice(subtotal, paymentConfig.currency)}</dd>
          </dl>

          {savings > 0 && (
            <dl className="flex items-center justify-between gap-4">
              <dt className="text-sm font-normal text-[var(--ui-muted)]">تخفیف {coupon && isCouponApplied ? `(${coupon.code})` : ""}</dt>
              <dd dir="ltr" className="text-sm font-medium text-[var(--ui-accent)]">−{formatPrice(savings, paymentConfig.currency)}</dd>
            </dl>
          )}

          <dl className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-2 text-sm font-normal text-[var(--ui-muted)]"><Truck size={15} aria-hidden="true" />هزینه ارسال</dt>
            <dd dir="ltr" className="text-sm font-medium text-[var(--ui-text)]">
              {shipping.loading ? "در حال محاسبه…" : shipping.error ? "نامشخص" : shipping.shippingFee === 0 ? "رایگان" : formatPrice(shipping.shippingFee, paymentConfig.currency)}
            </dd>
          </dl>

          {user && shipping.error && <div role="alert" className="rounded-lg border border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] p-3 text-sm leading-6 text-[var(--ui-warning)]"><p>{shipping.error}</p><button type="button" disabled={shipping.loading} onClick={() => setShippingRetry(value => value + 1)} className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-[var(--ui-warning-border)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--ui-hover)] disabled:cursor-not-allowed disabled:opacity-50">تلاش مجدد برای دریافت هزینه ارسال</button></div>}

          {!shipping.loading && !shipping.error && shipping.freeShippingThreshold > 0 && total < shipping.freeShippingThreshold && (
            <p className="text-xs leading-5 text-[var(--ui-muted)]">
              برای ارسال رایگان، مبلغ سفارش باید به {formatPrice(shipping.freeShippingThreshold, paymentConfig.currency)} برسد.
            </p>
          )}

          <dl className="flex items-center justify-between gap-4 border-t border-[var(--ui-border)] pt-3">
            <dt className="text-base font-bold text-[var(--ui-text)]">مبلغ نهایی قابل پرداخت</dt>
            <dd dir="ltr" className="text-base font-bold text-[var(--ui-accent)]">{shipping.loading ? "در حال محاسبه…" : shipping.error ? "قابل محاسبه نیست" : formatPrice(estimatedTotal, paymentConfig.currency)}</dd>
          </dl>
          <p className="text-xs leading-5 text-[var(--ui-muted)]">{shipping.error ? "تا زمان دریافت هزینه ارسال، مبلغ نهایی قابل نمایش نیست و پرداخت غیرفعال می‌ماند." : "محاسبه: قیمت محصولات منهای تخفیف، به‌علاوه هزینه ارسال. مبلغ و موجودی پیش از پرداخت در سرور دوباره بررسی می‌شوند."}</p>
        </div>

        {user && !paymentConfig.loading && !paymentConfig.configured && (
          <div role="alert" className="rounded-lg border border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] p-3 text-sm leading-6 text-[var(--ui-warning)]">
            <p>{paymentConfig.message || "درگاه پرداخت پیکربندی نشده است."}</p>
            <button type="button" onClick={() => setPaymentRetry(value => value + 1)} className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-[var(--ui-warning-border)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--ui-hover)]">تلاش مجدد برای بررسی درگاه</button>
          </div>
        )}

        <motion.button
          type="button"
          disabled={checkoutLoading || isMergingGuestCart || !cart.length || hasUnmergedItems || (Boolean(user) && (paymentConfig.loading || !paymentConfig.configured || shipping.loading || Boolean(shipping.error)))}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--ui-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--ui-button-text)] transition hover:bg-[var(--ui-accent-hover)] focus:outline-none focus:ring-4 focus:ring-[var(--ui-focus)]/30 disabled:cursor-not-allowed disabled:opacity-50"
          whileHover={{ scale: checkoutLoading ? 1 : 1.02 }}
          whileTap={{ scale: checkoutLoading ? 1 : 0.98 }}
          onClick={handlePayment}
        >
          {checkoutLoading || (user && paymentConfig.loading) ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
          {checkoutLoading ? "در حال انتقال به درگاه…" : !user ? "ورود برای ادامه و پرداخت" : "پرداخت آنلاین با زرین‌پال"}
        </motion.button>

        <div className="flex flex-wrap items-center justify-center gap-2 text-center">
          {!user && (
            <>
              <span className="text-sm text-[var(--ui-muted)]">حساب ندارید؟</span>
              <Link to="/signup" state={{ from: { pathname: "/cart" } }} className="text-sm font-semibold text-[var(--ui-accent)] underline underline-offset-4">ثبت‌نام</Link>
              <span className="mx-1 text-[var(--ui-muted)]">·</span>
            </>
          )}
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ui-accent)] underline hover:no-underline">
            <ArrowLeft size={16} aria-hidden="true" />ادامه خرید
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

export default OrderSummary;

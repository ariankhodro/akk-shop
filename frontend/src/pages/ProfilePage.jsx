import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Check, ChevronLeft, ClipboardList, Home, KeyRound, MapPin, Pencil, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import { normalizeDigits } from "../lib/normalize-digits";
import { useUserStore } from "../stores/useUserStore";

const provinces = [
  "آذربایجان شرقی", "آذربایجان غربی", "اردبیل", "اصفهان", "البرز", "ایلام",
  "بوشهر", "تهران", "چهارمحال و بختیاری", "خراسان جنوبی", "خراسان رضوی",
  "خراسان شمالی", "خوزستان", "زنجان", "سمنان", "سیستان و بلوچستان", "فارس",
  "قزوین", "قم", "کردستان", "کرمان", "کرمانشاه", "کهگیلویه و بویراحمد",
  "گلستان", "گیلان", "لرستان", "مازندران", "مرکزی", "هرمزگان", "همدان", "یزد",
];
const emptyAddress = {
  label: "نشانی منزل", recipientName: "", phone: "", province: "", city: "",
  district: "", addressLine: "", postalCode: "", notes: "", isDefault: false,
};
const fieldClass = "mt-1 min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2.5 text-sm text-[var(--ui-text)] outline-none transition placeholder:text-[var(--ui-muted)] focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/20";
const getMessage = (error, fallback) => error.response?.data?.message || fallback;
const addressFromSaved = address => ({ ...emptyAddress, ...address, label: address.label || "نشانی من" });
const normalizeIranianPhone = value => {
  let phone = normalizeDigits(value).replace(/\D/g, "");
  if (phone.startsWith("0098") && phone.length === 14) phone = "0" + phone.slice(4);
  else if (phone.startsWith("98") && phone.length === 12) phone = "0" + phone.slice(2);
  else if (phone.length === 10 && phone.startsWith("9")) phone = "0" + phone;
  return phone;
};
const normalizePostalCode = value => normalizeDigits(value).replace(/\D/g, "").slice(0, 10);

const ProfilePage = () => {
  const user = useUserStore(state => state.user);
  const updateProfile = useUserStore(state => state.updateProfile);
  const [profile, setProfile] = useState({ name: "", email: "", savedShippingAddresses: [] });
  const [name, setName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNameError, setProfileNameError] = useState("");
  const [profileSaveError, setProfileSaveError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const profileNameRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [addressForm, setAddressForm] = useState(null);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressErrors, setAddressErrors] = useState({});
  const [addressError, setAddressError] = useState("");
  const [addressPendingDeletion, setAddressPendingDeletion] = useState(null);
  const [addressDeleting, setAddressDeleting] = useState(false);
  const dialogCancelRef = useRef(null);

  const refreshProfile = useCallback(async () => {
    try {
      const { data } = await axios.get("/auth/profile");
      setProfile({
        ...data,
        savedShippingAddresses: Array.isArray(data.savedShippingAddresses) ? data.savedShippingAddresses : [],
      });
      setName(data.name || "");
      setPageError("");
      return data;
    } catch (error) {
      setPageError(getMessage(error, "دریافت اطلاعات حساب ناموفق بود. دوباره تلاش کنید."));
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshProfile().catch(() => {}); }, [refreshProfile]);

  useEffect(() => {
    if (!addressPendingDeletion) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    dialogCancelRef.current?.focus();
    const closeOnEscape = event => {
      if (event.key === "Escape" && !addressDeleting) setAddressPendingDeletion(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [addressPendingDeletion, addressDeleting]);

  const saveProfile = async event => {
    event.preventDefault();
    const value = name.trim();
    setProfileNameError("");
    setProfileSaveError("");
    setProfileSuccess("");
    if (value.length < 2 || value.length > 100) {
      setProfileNameError("نام و نام خانوادگی باید بین ۲ تا ۱۰۰ نویسه باشد.");
      window.requestAnimationFrame(() => profileNameRef.current?.focus());
      return;
    }
    setProfileSaving(true);
    try {
      const updated = await updateProfile(value);
      setProfile(current => ({ ...current, ...updated }));
      setName(updated?.name || value);
      setProfileSuccess("اطلاعات پروفایل با موفقیت ذخیره شد.");
      toast.success("اطلاعات پروفایل ذخیره شد.");
    } catch (error) {
      const message = getMessage(error, "ذخیره پروفایل ناموفق بود.");
      setProfileSaveError(message);
      toast.error(message);
    } finally {
      setProfileSaving(false);
    }
  };

  const startNewAddress = () => {
    setAddressErrors({});
    setAddressError("");
    setAddressForm({
      ...emptyAddress,
      recipientName: profile.name || user?.name || "",
      isDefault: profile.savedShippingAddresses.length === 0,
    });
  };
  const editAddress = address => {
    setAddressErrors({});
    setAddressError("");
    setAddressForm(addressFromSaved(address));
  };

  const focusFirstAddressError = fieldErrors => {
    const firstInvalidField = Object.keys(fieldErrors || {}).find(Boolean);
    if (firstInvalidField) {
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-address-field="${firstInvalidField}"]`)?.focus();
      });
    }
  };

  const updateAddressField = (key, value) => {
    setAddressForm(current => ({ ...current, [key]: value }));
    setAddressErrors(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setAddressError("");
  };

  const saveAddress = async event => {
    event.preventDefault();
    if (!addressForm) return;

    const normalizedForm = {
      ...addressForm,
      phone: normalizeIranianPhone(addressForm.phone),
      postalCode: normalizePostalCode(addressForm.postalCode),
    };
    const localErrors = {};
    const labelValue = String(normalizedForm.label || "").trim();
    const recipientName = String(normalizedForm.recipientName || "").trim();
    const city = String(normalizedForm.city || "").trim();
    const district = String(normalizedForm.district || "").trim();
    const addressLine = String(normalizedForm.addressLine || "").trim();
    const notes = String(normalizedForm.notes || "").trim();
    if (labelValue.length < 2 || labelValue.length > 60) localErrors.label = "عنوان نشانی باید بین ۲ تا ۶۰ نویسه باشد.";
    if (recipientName.length < 2 || recipientName.length > 100) localErrors.recipientName = "نام گیرنده باید بین ۲ تا ۱۰۰ نویسه باشد.";
    if (!/^09\d{9}$/.test(normalizedForm.phone)) localErrors.phone = "شماره موبایل باید با 09 شروع شود و ۱۱ رقم داشته باشد.";
    if (!normalizedForm.province || String(normalizedForm.province).length > 80) localErrors.province = "استان را انتخاب کنید.";
    if (city.length < 2 || city.length > 80) localErrors.city = "نام شهر را کامل وارد کنید.";
    if (district.length > 80) localErrors.district = "نام محله بیش از حد طولانی است.";
    if (addressLine.length < 10 || addressLine.length > 500) localErrors.addressLine = "نشانی باید بین ۱۰ تا ۵۰۰ نویسه باشد.";
    if (!/^\d{10}$/.test(normalizedForm.postalCode)) localErrors.postalCode = "کد پستی باید ۱۰ رقم داشته باشد.";
    if (notes.length > 500) localErrors.notes = "توضیحات بیش از حد طولانی است.";
    setAddressForm(normalizedForm);
    if (Object.keys(localErrors).length) {
      setAddressErrors(localErrors);
      setAddressError("لطفاً موارد مشخص‌شده را اصلاح کنید.");
      focusFirstAddressError(localErrors);
      return;
    }

    setAddressSaving(true);
    setAddressErrors({});
    setAddressError("");
    const { label, isDefault, _id, ...shippingFields } = normalizedForm;
    try {
      if (_id) {
        await axios.patch("/auth/profile/addresses/" + encodeURIComponent(_id), {
          label: label.trim(), isDefault, shippingAddress: shippingFields,
        });
      } else {
        await axios.post("/auth/profile/addresses", {
          label: label.trim(), isDefault, shippingAddress: shippingFields,
        });
      }
      await refreshProfile();
      setAddressForm(null);
      toast.success(_id ? "نشانی به‌روزرسانی شد." : "نشانی ذخیره شد.");
    } catch (error) {
      const fieldErrors = error.response?.data?.fieldErrors || {};
      setAddressErrors(fieldErrors);
      setAddressError(getMessage(error, "ذخیره نشانی ناموفق بود. اطلاعات را بررسی کنید."));
      focusFirstAddressError(fieldErrors);
    } finally {
      setAddressSaving(false);
    }
  };

  const setDefaultAddress = async id => {
    try {
      await axios.patch("/auth/profile/addresses/" + encodeURIComponent(id) + "/default");
      await refreshProfile();
      toast.success("نشانی پیش‌فرض تغییر کرد.");
    } catch (error) {
      toast.error(getMessage(error, "تغییر نشانی پیش‌فرض ناموفق بود."));
    }
  };
  const deleteAddress = address => setAddressPendingDeletion(address);

  const confirmDeleteAddress = async () => {
    if (!addressPendingDeletion || addressDeleting) return;
    setAddressDeleting(true);
    try {
      await axios.delete("/auth/profile/addresses/" + encodeURIComponent(addressPendingDeletion._id));
      await refreshProfile();
      setAddressPendingDeletion(null);
      toast.success("نشانی حذف شد.");
    } catch (error) {
      toast.error(getMessage(error, "حذف نشانی ناموفق بود."));
    } finally {
      setAddressDeleting(false);
    }
  };

  const field = (key, label, options = {}) => (
    <label key={key} className="block min-w-0 text-sm text-[var(--ui-muted)]">
      {label}
      {key === "province" ? (
        <select id={"address-field-" + key} required value={addressForm?.[key] || ""} onChange={event => updateAddressField(key, event.target.value)} data-address-field={key} className={fieldClass + (addressErrors[key] ? " border-[var(--ui-danger)]" : "")} aria-invalid={Boolean(addressErrors[key])} aria-describedby={addressErrors[key] ? "address-error-" + key : undefined}>
          <option value="">انتخاب استان</option>
          {provinces.map(province => <option key={province} value={province}>{province}</option>)}
        </select>
      ) : key === "addressLine" || key === "notes" ? (
        <textarea id={"address-field-" + key} value={addressForm?.[key] || ""} onChange={event => updateAddressField(key, event.target.value)} data-address-field={key} className={fieldClass + (addressErrors[key] ? " border-[var(--ui-danger)]" : "")} rows={key === "addressLine" ? 3 : 2} required={key === "addressLine"} maxLength={500} placeholder={options.placeholder || ""} aria-invalid={Boolean(addressErrors[key])} aria-describedby={addressErrors[key] ? "address-error-" + key : undefined} />
      ) : (
        <input id={"address-field-" + key} value={addressForm?.[key] || ""} onChange={event => updateAddressField(key, key === "postalCode" ? normalizePostalCode(event.target.value) : key === "phone" ? normalizeDigits(event.target.value) : event.target.value)} onBlur={key === "phone" ? () => updateAddressField(key, normalizeIranianPhone(addressForm?.[key])) : key === "postalCode" ? () => updateAddressField(key, normalizePostalCode(addressForm?.[key])) : undefined} data-address-field={key} className={fieldClass + (addressErrors[key] ? " border-[var(--ui-danger)]" : "")} required={options.required !== false} type={key === "phone" ? "tel" : "text"} inputMode={key === "phone" || key === "postalCode" ? "numeric" : undefined} dir={key === "phone" || key === "postalCode" ? "ltr" : undefined} maxLength={options.maxLength || 100} placeholder={options.placeholder || ""} aria-invalid={Boolean(addressErrors[key])} aria-describedby={addressErrors[key] ? "address-error-" + key : undefined} autoComplete={options.autoComplete} />
      )}
      {addressErrors[key] && <span id={"address-error-" + key} role="alert" className="mt-1 block text-xs leading-5 text-[var(--ui-danger)]">{addressErrors[key]}</span>}
    </label>
  );

  return (
    <main dir="rtl" className="min-h-[70vh] bg-[var(--ui-canvas)] px-4 py-8 text-[var(--ui-text)] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[0.15em] text-[var(--ui-accent)]">حساب کاربری میبا</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">پروفایل من</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--ui-muted)]">اطلاعات شخصی و نشانی‌های تحویل را یک‌بار ذخیره کنید تا در خریدهای بعدی، فرم پرداخت به‌صورت خودکار تکمیل شود.</p>
          </div>
          <nav aria-label="دسترسی‌های سریع حساب" className="flex flex-wrap gap-2">
            <Link to="/orders" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)]">سفارش‌ها <ChevronLeft size={16} aria-hidden="true" /></Link>
            <a href="#saved-addresses" className="inline-flex min-h-10 items-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)]">نشانی‌ها</a>
            <Link to="/wishlist" className="inline-flex min-h-10 items-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-2 text-sm font-medium text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)]">علاقه‌مندی‌ها</Link>
          </nav>
        </header>

        {pageError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-4 text-sm text-[var(--ui-danger)]"><span>{pageError}</span><button type="button" onClick={() => { setLoading(true); refreshProfile().catch(() => {}); }} className="rounded-lg border border-current px-3 py-2 font-semibold">تلاش دوباره</button></div>}
        {loading ? (
          <div role="status" className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-10 text-center text-sm text-[var(--ui-muted)]">در حال بارگذاری پروفایل…</div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <section className="h-fit rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]"><UserRound size={23} aria-hidden="true" /></div><div><h2 className="font-bold text-[var(--ui-text)]">اطلاعات شخصی</h2><p className="mt-1 text-xs text-[var(--ui-muted)]">اطلاعات حساب کاربری شما</p></div></div>
              <form onSubmit={saveProfile} noValidate className="space-y-4">
                <label className="block text-sm text-[var(--ui-muted)]">نام و نام خانوادگی<input ref={profileNameRef} id="profile-name" value={name} onChange={event => { setName(event.target.value); setProfileNameError(""); setProfileSaveError(""); setProfileSuccess(""); }} required minLength={2} maxLength={100} autoComplete="name" aria-invalid={Boolean(profileNameError)} aria-describedby={profileNameError ? "profile-name-error" : profileSuccess ? "profile-save-success" : undefined} className={fieldClass + (profileNameError ? " border-[var(--ui-danger)]" : "")} placeholder="نام و نام خانوادگی" /></label>
                {profileNameError && <p id="profile-name-error" role="alert" className="text-xs leading-5 text-[var(--ui-danger)]">{profileNameError}</p>}
                {profileSaveError && <p id="profile-save-error" role="alert" className="text-xs leading-5 text-[var(--ui-danger)]">{profileSaveError}</p>}
                {profileSuccess && <p id="profile-save-success" role="status" className="text-xs leading-5 text-[var(--ui-success)]">{profileSuccess}</p>}
                <label className="block text-sm text-[var(--ui-muted)]">ایمیل حساب<input type="email" value={profile.email || user?.email || ""} readOnly className={fieldClass + " cursor-not-allowed opacity-75"} dir="ltr" /><span className="mt-1 block text-xs leading-5 text-[var(--ui-muted)]">ایمیل ورود در این بخش قابل تغییر نیست.</span></label>
                <button type="submit" disabled={profileSaving || name.trim() === profile.name} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ui-button-text)] transition hover:bg-[var(--ui-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"><Save size={16} aria-hidden="true" /> {profileSaving ? "در حال ذخیره…" : "ذخیره اطلاعات"}</button>
              </form>
              <Link to="/account/change-password" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--ui-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)]"><KeyRound size={16} aria-hidden="true" />تغییر رمز عبور</Link>
              {profile.accountType === "wholesale" && (
                <div className="mt-5 rounded-2xl border border-[var(--ui-accent)]/30 bg-[var(--ui-accent-soft)] p-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-[var(--ui-text)]"><Building2 size={17} className="text-[var(--ui-accent)]" aria-hidden="true" />حساب همکاری عمده</p>
                  <dl className="mt-3 space-y-1.5 text-xs text-[var(--ui-text-strong)]">
                    {profile.wholesaleProfile?.companyName && <div className="flex justify-between gap-3"><dt className="text-[var(--ui-muted)]">فروشگاه / شرکت</dt><dd className="font-semibold">{profile.wholesaleProfile.companyName}</dd></div>}
                    {profile.wholesaleProfile?.city && <div className="flex justify-between gap-3"><dt className="text-[var(--ui-muted)]">شهر</dt><dd>{profile.wholesaleProfile.city}</dd></div>}
                    {Number(profile.wholesaleProfile?.discountPercent) > 0 && <div className="flex justify-between gap-3"><dt className="text-[var(--ui-muted)]">تخفیف اختصاصی</dt><dd className="font-semibold">{new Intl.NumberFormat("fa-IR").format(profile.wholesaleProfile.discountPercent)}٪</dd></div>}
                  </dl>
                  <p className="mt-3 text-xs leading-6 text-[var(--ui-muted)]">برای تغییر اطلاعات همکاری با کارشناس فروش میبا تماس بگیرید.</p>
                  <Link to="/wholesale/quick-order" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 text-xs font-bold text-white hover:bg-[var(--ui-accent-hover)]"><ClipboardList size={15} aria-hidden="true" />سفارش سریع با کد فنی</Link>
                </div>
              )}
            </section>

            <section id="saved-addresses" className="min-w-0 scroll-mt-28 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><MapPin size={20} className="text-[var(--ui-accent)]" aria-hidden="true" /><h2 className="font-bold text-[var(--ui-text)]">نشانی‌های من</h2><span className="rounded-full bg-[var(--ui-surface-raised)] px-2 py-0.5 text-xs text-[var(--ui-muted)]">{new Intl.NumberFormat("fa-IR").format(profile.savedShippingAddresses.length)} از ۱۰</span></div><p className="mt-1 text-xs leading-6 text-[var(--ui-muted)]">نشانی پیش‌فرض در مرحله پرداخت به‌صورت خودکار انتخاب می‌شود.</p></div><button type="button" onClick={startNewAddress} disabled={profile.savedShippingAddresses.length >= 10} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--ui-border-strong)] bg-[var(--ui-surface)] px-3 py-2 text-sm font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface-raised)] disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} aria-hidden="true" /> افزودن نشانی</button></div>

              {addressForm && <form onSubmit={saveAddress} noValidate className="mb-5 space-y-4 rounded-2xl border border-[var(--ui-border-strong)] bg-[var(--ui-surface-raised)] p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{addressForm._id ? "ویرایش نشانی" : "نشانی جدید"}</h3><button type="button" onClick={() => setAddressForm(null)} aria-label="بستن فرم نشانی" className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--ui-hover)]"><X size={17} aria-hidden="true" /></button></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {field("label", "عنوان نشانی", { maxLength: 60, placeholder: "مثلاً خانه یا محل کار" })}
                  {field("recipientName", "نام گیرنده", { maxLength: 100 })}
                  {field("phone", "شماره موبایل", { maxLength: 18, autoComplete: "tel" })}
                  {field("province", "استان")}
                  {field("city", "شهر", { maxLength: 80, autoComplete: "address-level2" })}
                  {field("district", "محله (اختیاری)", { required: false, maxLength: 80 })}
                  {field("postalCode", "کد پستی ۱۰ رقمی", { maxLength: 10, autoComplete: "postal-code" })}
                  <div className="sm:col-span-2">{field("addressLine", "نشانی کامل و پلاک", { placeholder: "خیابان، کوچه، پلاک، واحد..." })}</div>
                  <div className="sm:col-span-2">{field("notes", "توضیحات تحویل (اختیاری)", { required: false, placeholder: "راهنمای پیدا کردن نشانی" })}</div>
                </div>
                <label className="flex items-start gap-2.5 text-sm leading-6 text-[var(--ui-text)]"><input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--ui-accent)]" checked={Boolean(addressForm.isDefault)} onChange={event => setAddressForm(current => ({ ...current, isDefault: event.target.checked }))} /><span>این نشانی، پیش‌فرض سفارش‌های بعدی باشد</span></label>
                {addressError && <p role="alert" className="rounded-xl border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-3 text-sm leading-6 text-[var(--ui-danger)]">{addressError}</p>}
                <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={() => setAddressForm(null)} className="min-h-11 rounded-xl border border-[var(--ui-border)] px-4 py-2 text-sm font-semibold">انصراف</button><button type="submit" disabled={addressSaving} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold text-[var(--ui-button-text)] transition hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"><Save size={16} aria-hidden="true" /> {addressSaving ? "در حال ذخیره…" : "ذخیره نشانی"}</button></div>
              </form>}

              {profile.savedShippingAddresses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-canvas)] px-5 py-9 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ui-surface-raised)] text-[var(--ui-muted)]"><Home size={22} aria-hidden="true" /></div><h3 className="mt-3 font-semibold">هنوز نشانی ذخیره نکرده‌اید</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ui-muted)]">یک نشانی اضافه کنید تا اطلاعات تحویل هنگام پرداخت خودکار تکمیل شود.</p><button type="button" onClick={startNewAddress} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold text-[var(--ui-button-text)]"><Plus size={16} aria-hidden="true" /> افزودن اولین نشانی</button></div>
              ) : (
                <div className="space-y-3">{profile.savedShippingAddresses.map(address => <article key={address._id} className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-canvas)] p-4 sm:p-5">
                  <div className="flex items-start gap-3"><div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-surface)] text-[var(--ui-accent)]"><MapPin size={19} aria-hidden="true" /></div><div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-[var(--ui-text)]">{address.label || "نشانی من"}</h3>{address.isDefault && <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ui-success-border)] bg-[var(--ui-success-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ui-success)]"><Check size={12} aria-hidden="true" /> پیش‌فرض</span>}</div>
                    <p className="mt-1 break-words text-sm leading-6 text-[var(--ui-text-strong)]">{address.province}، {address.city}{address.district ? "، " + address.district : ""}</p><p className="mt-1 break-words text-sm leading-6 text-[var(--ui-muted)]">{address.addressLine}</p>
                    <p className="mt-2 text-xs text-[var(--ui-muted)]">{address.recipientName} · <span dir="ltr" className="inline-block">{address.phone}</span> · کد پستی <span dir="ltr" className="inline-block">{address.postalCode}</span></p>{address.notes && <p className="mt-2 text-xs leading-5 text-[var(--ui-muted)]">توضیحات تحویل: {address.notes}</p>}
                  </div></div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--ui-border)] pt-3">{!address.isDefault && <button type="button" onClick={() => setDefaultAddress(address._id)} className="min-h-9 rounded-lg border border-[var(--ui-border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface)]">انتخاب به‌عنوان پیش‌فرض</button>}<button type="button" onClick={() => editAddress(address)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--ui-text-strong)] transition hover:bg-[var(--ui-surface)]"><Pencil size={14} aria-hidden="true" /> ویرایش</button><button type="button" onClick={() => deleteAddress(address)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--ui-danger)] transition hover:bg-[var(--ui-danger-bg)]"><Trash2 size={14} aria-hidden="true" /> حذف</button></div>
                </article>)}</div>
              )}
              <p className="mt-4 text-xs leading-6 text-[var(--ui-muted)]">نشانی هر سفارش جداگانه ثبت می‌شود؛ ویرایش پروفایل، نشانی سفارش‌های قبلی را تغییر نمی‌دهد.</p>
            </section>
          </div>
        )}
      </div>
      {addressPendingDeletion && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-3 sm:items-center sm:p-6"
          onMouseDown={event => { if (event.target === event.currentTarget && !addressDeleting) setAddressPendingDeletion(null); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-address-title"
            aria-describedby="delete-address-description"
            onKeyDown={event => {
              if (event.key !== "Tab") return;
              const focusable = Array.from(event.currentTarget.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
              )).filter(element => element.getAttribute("aria-hidden") !== "true");
              if (!focusable.length) {
                event.preventDefault();
                return;
              }
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && event.target === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && event.target === last) {
                event.preventDefault();
                first.focus();
              }
            }}
            tabIndex={-1}
            className="w-full max-w-md rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-5 text-[var(--ui-text)] shadow-2xl sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-danger-bg)] text-[var(--ui-danger)]"><Trash2 size={19} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h2 id="delete-address-title" className="font-bold">حذف این نشانی؟</h2>
                <p id="delete-address-description" className="mt-2 text-sm leading-6 text-[var(--ui-muted)]">
                  نشانی «{addressPendingDeletion.label || "نشانی من"}» حذف می‌شود. این کار قابل بازگشت نیست.
                </p>
                <p className="mt-2 break-words text-xs leading-5 text-[var(--ui-muted)]">
                  {addressPendingDeletion.province}، {addressPendingDeletion.city} — {addressPendingDeletion.addressLine}
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={dialogCancelRef} type="button" disabled={addressDeleting} onClick={() => setAddressPendingDeletion(null)} className="min-h-11 rounded-xl border border-[var(--ui-border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--ui-surface-raised)] disabled:opacity-50">انصراف</button>
              <button type="button" disabled={addressDeleting} onClick={confirmDeleteAddress} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ui-danger)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                <Trash2 size={16} aria-hidden="true" />{addressDeleting ? "در حال حذف…" : "حذف نشانی"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
};

export default ProfilePage;
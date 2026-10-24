import { useCallback, useEffect, useState } from "react";
import { Building2, KeyRound, LoaderCircle, RefreshCw, Save, Search, UserPlus, Users } from "lucide-react";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import WholesaleAccountForm, { WholesaleProfileFields } from "./admin/WholesaleAccountForm";
import { emptyWholesaleProfile, generateTemporaryPassword, wholesaleProfilePayload } from "../lib/wholesale-accounts";
import { getPasswordPolicyError } from "../lib/password-policy";

const permissions = [
  ["catalogue.manage", "مدیریت کاتالوگ قطعات"], ["inventory.manage", "موجودی انبار"], ["orders.manage", "مدیریت سفارش‌ها"],
  ["customers.manage", "مشاهده مشتریان"], ["wholesale.manage", "مدیریت حساب‌های عمده"], ["support.manage", "پشتیبانی و مرجوعی"], ["refunds.manage", "تأیید و ثبت بازپرداخت"],
  ["marketing.manage", "بازاریابی"], ["reports.view", "گزارش‌های فروش"], ["reports.export", "خروجی گزارش (شامل اطلاعات مشتری)"],
  ["settings.manage", "تنظیمات فروشگاه"], ["audit.view", "تاریخچه اقدامات"], ["system.view", "وضعیت سامانه"],
  ["roles.manage", "مدیریت دسترسی‌ها (فقط مالک)"],
];
const presetLabels = {
  manager: "مدیر فروشگاه", catalogue_editor: "ویرایشگر کاتالوگ", fulfillment: "انبار و ارسال",
  support: "پشتیبانی", sales: "فروش و همکاران", marketing: "بازاریابی", analyst: "تحلیلگر",
};
// Mirrors backend/lib/rbac.js ROLE_PRESETS (the server expands presets itself; this only pre-fills the checkboxes).
const presets = {
  manager: ["catalogue.manage", "inventory.manage", "orders.manage", "customers.manage", "wholesale.manage", "support.manage", "refunds.manage", "marketing.manage", "reports.view", "reports.export", "settings.manage", "audit.view", "system.view"],
  catalogue_editor: ["catalogue.manage", "inventory.manage"], fulfillment: ["orders.manage", "inventory.manage"],
  support: ["support.manage", "customers.manage"], sales: ["customers.manage", "wholesale.manage", "orders.manage", "reports.view"],
  marketing: ["marketing.manage"], analyst: ["reports.view"],
};
const accountTabs = [["", "همه حساب‌ها"], ["retail", "خرده‌فروشی"], ["wholesale", "همکاران عمده"]];
const numberFa = (value) => new Intl.NumberFormat("fa-IR").format(Number(value) || 0);

const profileDraft = (customer) => ({
  ...emptyWholesaleProfile(),
  ...(customer.wholesaleProfile || {}),
  discountPercent: String(customer.wholesaleProfile?.discountPercent ?? 0),
});

export default function CustomerManagement({ viewerIsOwner = false, viewerPermissions = null }) {
  const [canManageAccess, setCanManageAccess] = useState(false);
  const [canManageWholesale, setCanManageWholesale] = useState(Array.isArray(viewerPermissions) && viewerPermissions.includes("wholesale.manage"));
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [drafts, setDrafts] = useState({});
  const [termDrafts, setTermDrafts] = useState({});
  const [passwordDrafts, setPasswordDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await axios.get("/admin/customers", { params: { q: search, page, limit: 25, ...(accountType ? { accountType } : {}) } });
      setCustomers(data.customers || []);
      setCanManageAccess(data.canManageAccess === true);
      setCanManageWholesale(data.canManageWholesale === true);
      setTotalPages(data.pagination?.totalPages || 1);
      setDrafts({}); setTermDrafts({}); setPasswordDrafts({});
    } catch (e) { setError(e.response?.data?.message || "بارگذاری مشتریان ناموفق بود."); }
    finally { setLoading(false); }
  }, [page, search, accountType]);
  useEffect(() => { void load(); }, [load]);

  const draftFor = (customer) => drafts[customer._id] || {
    role: customer.role,
    isActive: customer.isActive !== false,
    isOwner: customer.isOwner === true,
    permissions: customer.role !== "admin" ? [] : (Array.isArray(customer.permissions) ? customer.permissions.filter((value) => value !== "*") : []),
  };
  const change = (customer, field, value) => setDrafts((current) => ({
    ...current,
    [customer._id]: { ...(current[customer._id] || draftFor(customer)), [field]: value },
  }));
  const termsFor = (customer) => termDrafts[customer._id] || {
    accountType: customer.accountType || "retail",
    isActive: customer.isActive !== false,
    profile: profileDraft(customer),
  };
  const changeTerms = (customer, field, value) => setTermDrafts((current) => ({
    ...current,
    [customer._id]: { ...(current[customer._id] || termsFor(customer)), [field]: value },
  }));

  const save = async (customer) => {
    const draft = draftFor(customer);
    setSaving(customer._id + ":access");
    try {
      await axios.patch("/admin/customers/" + customer._id + "/access", {
        role: draft.role, isActive: draft.isActive,
        ...(draft.role === "admin" ? { permissions: draft.permissions } : {}),
        ...(viewerIsOwner && draft.role === "admin" ? { isOwner: draft.isOwner } : {}),
      });
      toast.success("دسترسی حساب ذخیره شد");
      await load();
    } catch (e) { toast.error(e.response?.data?.message || "ذخیره دسترسی ناموفق بود"); }
    finally { setSaving(""); }
  };

  const saveTerms = async (customer) => {
    const terms = termsFor(customer);
    if (terms.accountType === "wholesale" && !terms.profile.companyName.trim()) { toast.error("نام فروشگاه یا شرکت همکار الزامی است."); return; }
    setSaving(customer._id + ":terms");
    try {
      await axios.patch("/admin/customers/" + customer._id + "/wholesale", {
        accountType: terms.accountType,
        isActive: terms.isActive,
        ...(terms.accountType === "wholesale" ? { wholesaleProfile: wholesaleProfilePayload(terms.profile) } : {}),
      });
      toast.success("شرایط حساب ذخیره شد");
      await load();
    } catch (e) { toast.error(e.response?.data?.message || "ذخیره شرایط حساب ناموفق بود"); }
    finally { setSaving(""); }
  };

  const issuePassword = async (customer) => {
    const password = passwordDrafts[customer._id] || "";
    const policyError = getPasswordPolicyError(password);
    if (policyError) { toast.error(policyError); return; }
    if (!window.confirm("رمز عبور موقت برای «" + customer.name + "» ثبت شود؟ همه نشست‌های فعال این حساب بسته می‌شوند.")) return;
    setSaving(customer._id + ":password");
    try {
      await axios.post("/admin/customers/" + customer._id + "/password", { password });
      toast.success("رمز موقت ثبت شد؛ آن را از راه امن به مشتری بدهید.");
    } catch (e) { toast.error(e.response?.data?.message || "ثبت رمز موقت ناموفق بود"); }
    finally { setSaving(""); }
  };

  const fieldClass = "min-h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2 text-sm text-[var(--ui-text)]";
  return <section dir="rtl" className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-bold text-[var(--ui-text)]"><Users size={22}/>مشتریان، همکاران عمده و دسترسی مدیران</h2><p className="mt-1 text-sm leading-6 text-[var(--ui-muted)]">حساب همکاران عمده را بسازید، تخفیف اختصاصی و وضعیت آن‌ها را تعیین کنید و نقش و مجوزهای مدیران را مدیریت کنید.</p></div>
      <div className="flex flex-wrap gap-2">
        {canManageWholesale&&<button type="button" onClick={()=>setShowCreate(v=>!v)} aria-expanded={showCreate} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--ui-accent)] px-4 text-sm font-semibold text-[var(--ui-button-text)] hover:bg-[var(--ui-accent-hover)]"><UserPlus size={15}/>{showCreate?"بستن فرم":"حساب همکار جدید"}</button>}
        <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ui-border)] px-4 text-sm"><RefreshCw size={15}/>تازه‌سازی</button>
      </div>
    </header>
    {canManageWholesale&&showCreate&&<WholesaleAccountForm fieldClass={fieldClass} onCreated={()=>{setAccountType("wholesale");setPage(1);void load();}}/>}
    <div role="tablist" aria-label="نوع حساب" className="flex flex-wrap gap-2">
      {accountTabs.map(([value,label])=><button key={value||"all"} type="button" role="tab" aria-selected={accountType===value} onClick={()=>{setAccountType(value);setPage(1);}} className={"min-h-10 rounded-full border px-4 text-sm "+(accountType===value?"border-[var(--ui-accent)] bg-[var(--ui-accent-soft)] font-semibold text-[var(--ui-accent)]":"border-[var(--ui-border)] text-[var(--ui-text)] hover:bg-[var(--ui-hover)]")}>{label}</button>)}
    </div>
    <form onSubmit={(e)=>{e.preventDefault();setPage(1);void load();}} className="flex flex-col gap-2 sm:flex-row">
      <label className="relative min-w-0 flex-1"><span className="sr-only">جست‌وجوی مشتری</span><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]"/><input className={fieldClass+" pr-9"} value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="جست‌وجو با نام، ایمیل یا نام فروشگاه"/></label>
      <button className="min-h-11 rounded-lg bg-[var(--ui-accent)] px-5 text-sm font-semibold text-[var(--ui-button-text)]">جست‌وجو</button>
    </form>
    {error&&<p role="alert" className="rounded-xl border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-4 text-sm text-[var(--ui-danger)]">{error}</p>}
    {loading?<div role="status" className="flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--ui-muted)]"><LoaderCircle className="animate-spin"/>در حال بارگذاری مشتریان…</div>
    :customers.length===0?<p className="rounded-xl border border-[var(--ui-border)] p-8 text-center text-sm text-[var(--ui-muted)]">حسابی پیدا نشد.</p>
    :<div className="space-y-4">{customers.map(customer=>{const draft=draftFor(customer);const terms=termsFor(customer);const isWholesale=customer.accountType==="wholesale";return <article key={customer._id} className="min-w-0 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 break-words font-semibold text-[var(--ui-text)]">{customer.name}
          {customer.role==="admin"&&<span className="rounded-full bg-[var(--ui-surface-raised)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ui-muted)]">مدیر</span>}
          {isWholesale&&<span className="inline-flex items-center gap-1 rounded-full bg-[var(--ui-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ui-accent)]"><Building2 size={12}/>همکار عمده{customer.wholesaleProfile?.discountPercent?" · "+numberFa(customer.wholesaleProfile.discountPercent)+"٪":""}</span>}
          {customer.isActive===false&&<span className="rounded-full bg-[var(--ui-danger-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ui-danger)]">غیرفعال</span>}
          {customer.mustChangePassword&&<span className="rounded-full bg-[var(--ui-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ui-warning)]">در انتظار تغییر رمز</span>}
        </p>
        {customer.wholesaleProfile?.companyName&&<p className="mt-1 text-sm text-[var(--ui-text)]">{customer.wholesaleProfile.companyName}{customer.wholesaleProfile.city?" · "+customer.wholesaleProfile.city:""}</p>}
        <p dir="ltr" className="mt-1 break-all text-right text-sm text-[var(--ui-muted)]">{customer.email}</p><p className="mt-1 text-xs text-[var(--ui-muted)]">شناسه: <span dir="ltr" className="break-all">{customer._id}</span></p></div>
      {canManageAccess&&<button type="button" onClick={()=>save(customer)} disabled={saving===customer._id+":access"} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--ui-accent)] px-4 text-sm font-semibold text-[var(--ui-button-text)] disabled:opacity-50">{saving===customer._id+":access"?<LoaderCircle className="animate-spin" size={15}/>:<Save size={15}/>}ذخیره دسترسی</button>}</div>
      {canManageAccess?<div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm text-[var(--ui-muted)]">نقش حساب<select className={fieldClass+" mt-1"} value={draft.role} onChange={e=>change(customer,"role",e.target.value)}><option value="customer">مشتری</option><option value="admin">مدیر</option></select></label>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--ui-border)] px-3 text-sm text-[var(--ui-text)]"><input type="checkbox" checked={draft.isActive} onChange={e=>change(customer,"isActive",e.target.checked)}/>حساب فعال باشد</label>{viewerIsOwner&&draft.role==="admin"&&<label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--ui-border)] px-3 text-sm text-[var(--ui-text)] sm:col-span-2"><input type="checkbox" checked={draft.isOwner} onChange={e=>change(customer,"isOwner",e.target.checked)}/>مالک فروشگاه (دسترسی کامل؛ حداقل یک مالک فعال باید بماند)</label>}</div>:<p className="mt-3 text-xs text-[var(--ui-muted)]">نقش: {customer.role==="admin"?"مدیر":"مشتری"} · نوع: {isWholesale?"همکار عمده":"خرده‌فروشی"} · {customer.isActive===false?"غیرفعال":"فعال"}</p>}
      {canManageAccess&&draft.role==="admin"&&<fieldset className="mt-4 rounded-xl border border-[var(--ui-border)] p-3"><legend className="px-2 text-sm font-semibold text-[var(--ui-text)]">مجوزهای مدیر</legend><label className="mb-3 block text-sm text-[var(--ui-muted)]">قالب آماده<select className={fieldClass+" mt-1"} value="" onChange={e=>{const preset=presets[e.target.value];if(preset)change(customer,"permissions",preset);}}><option value="">انتخاب قالب نقش…</option>{Object.entries(presetLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{permissions.map(([value,label])=><label key={value} className="flex min-h-10 items-start gap-2 rounded-lg bg-[var(--ui-surface-raised)] p-2 text-sm text-[var(--ui-text)]"><input type="checkbox" className="mt-1 shrink-0" checked={draft.permissions.includes(value)} disabled={value==="roles.manage"&&!viewerIsOwner} onChange={e=>change(customer,"permissions",e.target.checked?[...draft.permissions,value]:draft.permissions.filter(x=>x!==value))}/><span>{label}</span></label>)}</div><p className="mt-2 text-xs leading-5 text-[var(--ui-muted)]">تغییر نقش و مجوزها همین حالا اعمال می‌شود و نشست‌های فعال آن حساب باطل می‌شوند. فقط مالک می‌تواند مجوز «مدیریت دسترسی‌ها» یا مالکیت بدهد و حداقل یک مالک فعال باید باقی بماند.</p></fieldset>}
      {canManageWholesale&&customer.role==="customer"&&<details className="mt-4 rounded-xl border border-[var(--ui-border)] p-3" open={isWholesale&&Boolean(termDrafts[customer._id])}>
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ui-text)]">شرایط خرید عمده و رمز موقت</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-[var(--ui-muted)]">نوع حساب<select className={fieldClass+" mt-1"} value={terms.accountType} onChange={e=>changeTerms(customer,"accountType",e.target.value)}><option value="retail">خرده‌فروشی</option><option value="wholesale">همکار عمده</option></select></label>
            <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-[var(--ui-border)] px-3 text-sm text-[var(--ui-text)]"><input type="checkbox" checked={terms.isActive} onChange={e=>changeTerms(customer,"isActive",e.target.checked)}/>حساب فعال باشد</label>
          </div>
          {terms.accountType==="wholesale"&&<WholesaleProfileFields value={terms.profile} onChange={profile=>changeTerms(customer,"profile",profile)} fieldClass={fieldClass} idPrefix={"terms-"+customer._id}/>}
          <p className="text-xs leading-5 text-[var(--ui-muted)]">تغییر نوع حساب، تخفیف یا غیرفعال‌کردن حساب، نشست‌های فعال مشتری را می‌بندد تا قیمت‌های جدید از درخواست بعدی اعمال شوند.</p>
          <button type="button" onClick={()=>saveTerms(customer)} disabled={saving===customer._id+":terms"} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--ui-accent)] px-4 text-sm font-semibold text-[var(--ui-button-text)] disabled:opacity-50">{saving===customer._id+":terms"?<LoaderCircle className="animate-spin" size={15}/>:<Save size={15}/>}ذخیره شرایط حساب</button>
          <div className="flex flex-col gap-2 border-t border-[var(--ui-border)] pt-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm text-[var(--ui-muted)]">رمز عبور موقت<input type="text" dir="ltr" autoComplete="off" spellCheck={false} className={fieldClass+" mt-1 font-mono"} value={passwordDrafts[customer._id]||""} maxLength={72} onChange={e=>setPasswordDrafts(current=>({...current,[customer._id]:e.target.value}))}/></label>
            <button type="button" onClick={()=>setPasswordDrafts(current=>({...current,[customer._id]:generateTemporaryPassword()}))} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-[var(--ui-border)] px-3 text-xs text-[var(--ui-text)] hover:bg-[var(--ui-hover)]"><KeyRound size={14}/>رمز تصادفی</button>
            <button type="button" onClick={()=>issuePassword(customer)} disabled={!passwordDrafts[customer._id]||saving===customer._id+":password"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--ui-accent)] px-4 text-sm font-semibold text-[var(--ui-accent)] disabled:opacity-50">{saving===customer._id+":password"&&<LoaderCircle className="animate-spin" size={15}/>}ثبت رمز موقت</button>
          </div>
        </div>
      </details>}
    </article>})}
    <div className="flex items-center justify-between gap-3 text-sm text-[var(--ui-muted)]"><button type="button" disabled={page<=1} onClick={()=>setPage(v=>v-1)} className="min-h-10 rounded-full border border-[var(--ui-border)] px-4 disabled:opacity-40">صفحه قبل</button><span>صفحه {numberFa(page)} از {numberFa(totalPages)}</span><button type="button" disabled={page>=totalPages} onClick={()=>setPage(v=>v+1)} className="min-h-10 rounded-full border border-[var(--ui-border)] px-4 disabled:opacity-40">صفحه بعد</button></div></div>}
  </section>;
}

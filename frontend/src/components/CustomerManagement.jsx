import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Save, Search, Users } from "lucide-react";
import toast from "react-hot-toast";
import axios from "../lib/axios";

const permissions = [
  ["catalogue.manage", "مدیریت کاتالوگ"], ["inventory.manage", "موجودی کالا"], ["orders.manage", "مدیریت سفارش‌ها"],
  ["customers.manage", "مشاهده مشتریان"], ["support.manage", "پشتیبانی و مرجوعی"], ["refunds.manage", "تأیید و ثبت بازپرداخت"],
  ["marketing.manage", "بازاریابی"], ["reports.view", "گزارش‌های فروش"], ["reports.export", "خروجی گزارش (شامل اطلاعات مشتری)"],
  ["settings.manage", "تنظیمات فروشگاه"], ["audit.view", "تاریخچه اقدامات"], ["system.view", "وضعیت سامانه"],
  ["roles.manage", "مدیریت دسترسی‌ها (فقط مالک)"],
];
const presetLabels = {
  manager: "مدیر فروشگاه", catalogue_editor: "ویرایشگر کاتالوگ", fulfillment: "انبار و ارسال",
  support: "پشتیبانی", marketing: "بازاریابی", analyst: "تحلیلگر",
};

export default function CustomerManagement({ viewerIsOwner = false }) {
  const [canManageAccess, setCanManageAccess] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await axios.get("/admin/customers", { params: { q: search, page, limit: 25 } });
      setCustomers(data.customers || []);
      setCanManageAccess(data.canManageAccess === true);
      setTotalPages(data.pagination?.totalPages || 1);
      setDrafts({});
    } catch (e) { setError(e.response?.data?.message || "بارگذاری مشتریان ناموفق بود."); }
    finally { setLoading(false); }
  }, [page, search]);
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
  const save = async (customer) => {
    const draft = draftFor(customer);
    setSaving(customer._id);
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

  const presets = {
  manager: ["catalogue.manage","inventory.manage","orders.manage","customers.manage","support.manage","refunds.manage","marketing.manage","reports.view","reports.export","settings.manage","audit.view","system.view"],
  catalogue_editor: ["catalogue.manage","inventory.manage"], fulfillment: ["orders.manage","inventory.manage"],
  support: ["support.manage","customers.manage"], marketing: ["marketing.manage"], analyst: ["reports.view"],
};
  const fieldClass = "min-h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2 text-sm text-[var(--ui-text)]";
  return <section dir="rtl" className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-xl font-bold text-[var(--ui-text)]"><Users size={22}/>مدیریت مشتریان و دسترسی مدیران</h2><p className="mt-1 text-sm leading-6 text-[var(--ui-muted)]">نقش، وضعیت حساب و مجوزهای دقیق هر مدیر را مدیریت کنید.</p></div>
      <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ui-border)] px-4 text-sm"><RefreshCw size={15}/>تازه‌سازی</button>
    </header>
    <form onSubmit={(e)=>{e.preventDefault();setPage(1);void load();}} className="flex flex-col gap-2 sm:flex-row">
      <label className="relative min-w-0 flex-1"><span className="sr-only">جست‌وجوی مشتری</span><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]"/><input className={fieldClass+" pr-9"} value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="جست‌وجو با نام یا ایمیل"/></label>
      <button className="min-h-11 rounded-lg bg-[var(--ui-accent)] px-5 text-sm font-semibold text-[var(--ui-button-text)]">جست‌وجو</button>
    </form>
    {error&&<p role="alert" className="rounded-xl border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-4 text-sm text-[var(--ui-danger)]">{error}</p>}
    {loading?<div role="status" className="flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--ui-muted)]"><LoaderCircle className="animate-spin"/>در حال بارگذاری مشتریان…</div>
    :customers.length===0?<p className="rounded-xl border border-[var(--ui-border)] p-8 text-center text-sm text-[var(--ui-muted)]">مشتری‌ای پیدا نشد.</p>
    :<div className="space-y-4">{customers.map(customer=>{const draft=draftFor(customer);return <article key={customer._id} className="min-w-0 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="break-words font-semibold text-[var(--ui-text)]">{customer.name}</p><p dir="ltr" className="mt-1 break-all text-sm text-[var(--ui-muted)]">{customer.email}</p><p className="mt-1 text-xs text-[var(--ui-muted)]">شناسه: <span dir="ltr" className="break-all">{customer._id}</span></p></div>
      {canManageAccess&&<button type="button" onClick={()=>save(customer)} disabled={saving===customer._id} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--ui-accent)] px-4 text-sm font-semibold text-[var(--ui-button-text)] disabled:opacity-50">{saving===customer._id?<LoaderCircle className="animate-spin" size={15}/>:<Save size={15}/>}ذخیره دسترسی</button>}</div>
      {canManageAccess?<div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm text-[var(--ui-muted)]">نقش حساب<select className={fieldClass+" mt-1"} value={draft.role} onChange={e=>change(customer,"role",e.target.value)}><option value="customer">مشتری</option><option value="admin">مدیر</option></select></label>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--ui-border)] px-3 text-sm text-[var(--ui-text)]"><input type="checkbox" checked={draft.isActive} onChange={e=>change(customer,"isActive",e.target.checked)}/>حساب فعال باشد</label>{viewerIsOwner&&draft.role==="admin"&&<label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--ui-border)] px-3 text-sm text-[var(--ui-text)] sm:col-span-2"><input type="checkbox" checked={draft.isOwner} onChange={e=>change(customer,"isOwner",e.target.checked)}/>مالک فروشگاه (دسترسی کامل؛ حداقل یک مالک فعال باید بماند)</label>}</div>:<p className="mt-3 text-xs text-[var(--ui-muted)]">نقش: {customer.role==="admin"?"مدیر":"مشتری"} · {customer.isActive===false?"غیرفعال":"فعال"}</p>}
      {canManageAccess&&draft.role==="admin"&&<fieldset className="mt-4 rounded-xl border border-[var(--ui-border)] p-3"><legend className="px-2 text-sm font-semibold text-[var(--ui-text)]">مجوزهای مدیر</legend><label className="mb-3 block text-sm text-[var(--ui-muted)]">قالب آماده<select className={fieldClass+" mt-1"} value="" onChange={e=>{const preset=presets[e.target.value];if(preset)change(customer,"permissions",preset);}}><option value="">انتخاب قالب نقش…</option>{Object.entries(presetLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{permissions.map(([value,label])=><label key={value} className="flex min-h-10 items-start gap-2 rounded-lg bg-[var(--ui-surface-raised)] p-2 text-sm text-[var(--ui-text)]"><input type="checkbox" className="mt-1 shrink-0" checked={draft.permissions.includes(value)} disabled={value==="roles.manage"&&!viewerIsOwner} onChange={e=>change(customer,"permissions",e.target.checked?[...draft.permissions,value]:draft.permissions.filter(x=>x!==value))}/><span>{label}</span></label>)}</div><p className="mt-2 text-xs leading-5 text-[var(--ui-muted)]">تغییر نقش و مجوزها همین حالا اعمال می‌شود و نشست‌های فعال آن حساب باطل می‌شوند. فقط مالک می‌تواند مجوز «مدیریت دسترسی‌ها» یا مالکیت بدهد و حداقل یک مالک فعال باید باقی بماند.</p></fieldset>}
    </article>})}
    <div className="flex items-center justify-between gap-3 text-sm text-[var(--ui-muted)]"><button type="button" disabled={page<=1} onClick={()=>setPage(v=>v-1)} className="min-h-10 rounded-full border border-[var(--ui-border)] px-4 disabled:opacity-40">صفحه قبل</button><span>صفحه {page} از {totalPages}</span><button type="button" disabled={page>=totalPages} onClick={()=>setPage(v=>v+1)} className="min-h-10 rounded-full border border-[var(--ui-border)] px-4 disabled:opacity-40">صفحه بعد</button></div></div>}
  </section>;
}

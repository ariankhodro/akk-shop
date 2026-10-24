import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Boxes, LoaderCircle, RefreshCw } from "lucide-react";
import axios from "../lib/axios";
import { formatPrice } from "../lib/commerce";

export default function InventoryAlerts(){
 const [threshold,setThreshold]=useState(5),[alerts,setAlerts]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[capped,setCapped]=useState(false);
 const load=useCallback(async()=>{setLoading(true);setError("");try{const {data}=await axios.get("/admin/inventory",{params:{threshold}});setAlerts(data.alerts||[]);setCapped(Boolean(data.capped));}catch(e){setError(e.response?.data?.message||"بارگذاری هشدارهای موجودی ناموفق بود.");}finally{setLoading(false);}},[threshold]);
 useEffect(()=>{void load();},[load]);
 return <section dir="rtl" className="space-y-5"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-bold text-[var(--ui-text)]"><Boxes/>هشدار موجودی کالا</h2><p className="mt-1 text-sm leading-6 text-[var(--ui-muted)]">محصولات فعال با موجودی کمتر یا مساوی آستانه؛ این هشدار درون داشبورد است و هنوز اعلان خودکار ارسال نمی‌کند.</p></div><button onClick={load} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ui-border)] px-4 text-sm"><RefreshCw size={15}/>تازه‌سازی</button></header>
 <label className="block max-w-xs text-sm text-[var(--ui-muted)]">آستانه هشدار (تعداد)<select value={threshold} onChange={e=>setThreshold(Number(e.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm text-[var(--ui-text)]">{[0,1,2,3,5,10,20,50].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
 {error&&<p role="alert" className="rounded-xl border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] p-4 text-sm text-[var(--ui-danger)]">{error}</p>}
 {loading?<div role="status" className="flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--ui-muted)]"><LoaderCircle className="animate-spin"/>در حال بررسی موجودی…</div>:alerts.length===0?<div className="rounded-xl border border-[var(--ui-border)] p-8 text-center text-sm text-[var(--ui-muted)]">در این آستانه، محصول کم‌موجودی پیدا نشد.</div>:<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{alerts.map(p=><article key={p._id} className="flex min-w-0 gap-3 rounded-xl border border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] p-4"><AlertTriangle className="mt-1 shrink-0 text-[var(--ui-warning)]"/><div className="min-w-0"><h3 className="break-words font-semibold text-[var(--ui-text)]">{p.name}</h3><p className="mt-1 text-sm text-[var(--ui-muted)]">موجودی: {p.totalStock===null?"نامشخص":new Intl.NumberFormat("fa-IR").format(p.totalStock)}</p><p className="mt-1 text-sm text-[var(--ui-muted)]">{formatPrice(p.price)}</p><p dir="ltr" className="mt-1 break-all text-xs text-[var(--ui-muted)]">{p._id}</p></div></article>)}</div>}
 {capped&&<p className="text-xs leading-5 text-[var(--ui-muted)]">فقط ۵۰۰ محصول اخیر بررسی شدند؛ نتایج ممکن است کامل نباشند.</p>}
 </section>;
}

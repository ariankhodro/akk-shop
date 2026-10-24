import { Activity, BarChart, PlusCircle, ShoppingBasket, Megaphone, Truck, Mail, ScrollText, FolderTree, TicketPercent, Users, LifeBuoy, Boxes } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import axios from "../lib/axios";
import { canOpenTab, hasAnyPermission } from "../lib/admin-access";

const AnalyticsTab = lazy(() => import("../components/AnalyticsTab"));
const DashboardOverview = lazy(() => import("../components/DashboardOverview"));
const CreateProductForm = lazy(() => import("../components/CreateProductForm"));
const ProductsList = lazy(() => import("../components/ProductsList"));
const CampaignManager = lazy(() => import("../components/CampaignManager"));
const ShippingSettings = lazy(() => import("../components/ShippingSettings"));
const NewsletterManager = lazy(() => import("../components/NewsletterManager"));
const OrderManagement = lazy(() => import("../components/OrderManagement"));
const AuditLogTab = lazy(() => import("../components/AuditLogTab"));
const CategoryManager = lazy(() => import("../components/CategoryManager"));
const CouponManager = lazy(() => import("../components/CouponManager"));
const OperationsDashboard = lazy(() => import("../components/OperationsDashboard"));
const CustomerManagement = lazy(() => import("../components/CustomerManagement"));
const ServiceCases = lazy(() => import("../components/ServiceCases"));
const InventoryAlerts = lazy(() => import("../components/InventoryAlerts"));

const groups = [
 { id:"catalogue", label:"کاتالوگ", items:[{id:"create",label:"افزودن قطعه",icon:PlusCircle},{id:"products",label:"قطعات، قیمت و موجودی",icon:ShoppingBasket},{id:"categories",label:"مدیریت دسته‌بندی‌ها",icon:FolderTree}] },
 { id:"orders-group", label:"سفارش‌ها و پشتیبانی", items:[{id:"orders",label:"صف سفارش‌ها",icon:Truck},{id:"service-cases",label:"پشتیبانی و مرجوعی",icon:LifeBuoy},{id:"customers",label:"مشتریان و همکاران عمده",icon:Users},{id:"inventory",label:"هشدار موجودی",icon:Boxes},{id:"shipping",label:"تنظیمات ارسال",icon:Truck}] },
 { id:"marketing", label:"بازاریابی", items:[{id:"campaigns",label:"کمپین‌ها",icon:Megaphone},{id:"coupons",label:"کدهای تخفیف",icon:TicketPercent},{id:"newsletter",label:"خبرنامه",icon:Mail}] },
 { id:"reports-system", label:"گزارش‌ها و سامانه", items:[{id:"dashboard",label:"نمای کلی",icon:Activity},{id:"analytics",label:"آمار و تحلیل",icon:BarChart},{id:"audit",label:"تاریخچه اقدامات",icon:ScrollText},{id:"operations",label:"وضعیت سامانه",icon:Activity}] },
];
const AdminPage = () => {
 const [searchParams,setSearchParams]=useSearchParams();
 const requestedTab=searchParams.get("tab");
 const [adminPermissions,setAdminPermissions]=useState(null);
 const [isOwner,setIsOwner]=useState(false);
 const [profileError,setProfileError]=useState(false);
 useEffect(()=>{axios.get("/auth/profile").then(({data})=>{setAdminPermissions(Array.isArray(data.effectivePermissions)?data.effectivePermissions:[]);setIsOwner(data.isOwner===true);}).catch(()=>{setAdminPermissions([]);setProfileError(true);});},[]);
 // Until the profile arrives (or if it fails) nothing is offered: the UI never defaults to full access.
 const visibleGroups=useMemo(()=>groups.map(group=>({...group,items:group.items.filter(tab=>canOpenTab(adminPermissions,tab.id))})).filter(group=>group.items.length>0),[adminPermissions]);
 const tabs=useMemo(()=>visibleGroups.flatMap(group=>group.items),[visibleGroups]);
 const initialTab=tabs.some(tab=>tab.id===requestedTab)?requestedTab:(tabs.some(tab=>tab.id==="dashboard")?"dashboard":tabs[0]?.id||"dashboard");
 const [activeTab,setActiveTab]=useState(initialTab);
 const [packingCount,setPackingCount]=useState(null);
 const canSeeOrders=hasAnyPermission(adminPermissions,"orders.manage");
 const refreshPackingCount=useCallback(async()=>{
  if(!canSeeOrders){setPackingCount(null);return;}
  try {
   const response=await axios.get("/orders/admin",{params:{page:1,limit:1,shipmentStatus:"processing"}});
   const total=Number(response.data?.pagination?.total);
   setPackingCount(Number.isFinite(total)&&total>=0?total:null);
  } catch { setPackingCount(null); }
 },[canSeeOrders]);
 useEffect(()=>{setActiveTab(tabs.some(tab=>tab.id===requestedTab)?requestedTab:(tabs.some(tab=>tab.id==="dashboard")?"dashboard":tabs[0]?.id||"dashboard"));},[requestedTab,tabs]);
 useEffect(()=>{void refreshPackingCount();},[refreshPackingCount]);
 const selectTab=(id)=>{
  setActiveTab(id);
  setSearchParams(current=>{const next=new URLSearchParams(current);next.set("tab",id);return next;});
  if(id==="orders")void refreshPackingCount();
 };
 const handleKeyDown=(event,currentId)=>{
  if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
  event.preventDefault();
  const index=tabs.findIndex(tab=>tab.id===currentId);
  const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(["ArrowLeft","ArrowDown"].includes(event.key)?1:-1)+tabs.length)%tabs.length;
  selectTab(tabs[next].id);document.getElementById("admin-tab-"+tabs[next].id)?.focus();
 };
 const renderTab=tab=>{
  const Icon=tab.icon,selected=activeTab===tab.id;
  return <button id={"admin-tab-"+tab.id} key={tab.id} type="button" role="tab" aria-selected={selected} aria-controls="admin-tab-panel" tabIndex={selected?0:-1} onKeyDown={event=>handleKeyDown(event,tab.id)} onClick={()=>selectTab(tab.id)}
   className={"flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)] "+(selected?"bg-[var(--ui-accent-soft)] text-[var(--ui-accent)] ring-1 ring-inset ring-[var(--ui-accent)]":"text-[var(--ui-text)] hover:bg-[var(--ui-hover)]")}>
   <Icon size={18} className="shrink-0" aria-hidden="true"/><span className="min-w-0 flex-1">{tab.label}</span>
   {tab.id==="orders"&&packingCount!==null&&<span aria-label={packingCount+" سفارش در انتظار بسته‌بندی"} className={"inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums "+(packingCount>0?"bg-[var(--ui-warning-bg)] text-[var(--ui-warning)]":"bg-[var(--ui-surface-raised)] text-[var(--ui-muted)]")}>{new Intl.NumberFormat("fa-IR").format(packingCount)}</span>}
  </button>;
 };
 return <div className="min-h-[65vh] bg-[var(--ui-canvas)] text-[var(--ui-text)]">
  <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:py-8">
   <motion.header className="mb-6" initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} transition={{duration:.25}}>
    <h1 className="text-2xl font-bold sm:text-3xl">داشبورد مدیریت</h1><p className="mt-2 text-sm leading-6 text-[var(--ui-muted)]">کاتالوگ، سفارش‌ها، بازاریابی و گزارش‌های فروشگاه را از یک فضای کاری مدیریت کنید.</p>
   </motion.header>
   <div className="mb-5 md:hidden"><label htmlFor="admin-mobile-nav" className="mb-2 block text-xs font-semibold text-[var(--ui-muted)]">رفتن به بخش</label>
    <select id="admin-mobile-nav" value={activeTab} onChange={event=>selectTab(event.target.value)} className="min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 py-2 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/25">
     {visibleGroups.map(group=><optgroup key={group.id} label={group.label}>{group.items.map(tab=><option key={tab.id} value={tab.id}>{tab.label}{tab.id==="orders"&&packingCount>0?" ("+new Intl.NumberFormat("fa-IR").format(packingCount)+")":""}</option>)}</optgroup>)}
    </select>
   </div>
   <div dir="rtl" className="grid items-start gap-5 md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)] xl:gap-7">
    <aside className="hidden md:sticky md:top-5 md:block md:max-h-[calc(100vh-2.5rem)] md:overflow-y-auto rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 xl:p-4">
     <p className="mb-3 px-3 pt-1 text-xs font-semibold text-[var(--ui-muted)]">ناوبری مدیریت</p><nav role="tablist" aria-label="بخش‌های مدیریت" aria-orientation="vertical" className="space-y-5">
      {visibleGroups.map(group=><section key={group.id} aria-label={group.label}><h2 className="mb-2 px-3 text-[11px] font-bold tracking-wide text-[var(--ui-muted)]">{group.label}</h2><div className="space-y-1">{group.items.map(renderTab)}</div></section>)}
     </nav>
    </aside>
    <section className="min-w-0" id="admin-tab-panel" role="tabpanel" aria-labelledby={"admin-tab-"+activeTab}>
     <Suspense fallback={<div role="status" className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-8 text-center text-sm text-[var(--ui-muted)]">در حال بارگذاری بخش مدیریت…</div>}>
      {adminPermissions!==null&&tabs.length===0&&<p role={profileError?"alert":"status"} className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-8 text-center text-sm text-[var(--ui-muted)]">{profileError?"دریافت دسترسی‌های حساب ناموفق بود؛ صفحه را تازه‌سازی کنید.":"برای این حساب هنوز دسترسی مدیریتی تعریف نشده است. با مالک فروشگاه تماس بگیرید."}</p>}{activeTab==="dashboard"&&<DashboardOverview permissions={adminPermissions}/>}{activeTab==="create"&&<CreateProductForm/>}{activeTab==="products"&&<ProductsList/>}{activeTab==="categories"&&<CategoryManager/>}{activeTab==="coupons"&&<CouponManager/>}{activeTab==="campaigns"&&<CampaignManager/>}{activeTab==="shipping"&&<ShippingSettings/>}{activeTab==="newsletter"&&<NewsletterManager/>}{activeTab==="analytics"&&<AnalyticsTab/>}{activeTab==="orders"&&<OrderManagement/>}{activeTab==="audit"&&<AuditLogTab/>}{activeTab==="operations"&&<OperationsDashboard/>}{activeTab==="customers"&&<CustomerManagement viewerIsOwner={isOwner} viewerPermissions={adminPermissions}/>}{activeTab==="service-cases"&&<ServiceCases/>}{activeTab==="inventory"&&<InventoryAlerts/>}
     </Suspense>
    </section>
   </div>
  </div>
 </div>;
};
export default AdminPage;

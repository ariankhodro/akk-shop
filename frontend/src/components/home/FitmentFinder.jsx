import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CarFront, Search } from "lucide-react";
import axios from "../../lib/axios";

// Used until the catalogue has fitment data (or when the API is unreachable).
const FALLBACK_VEHICLE_MAKES = [
  { make: "چری", models: ["تیگو ۵", "تیگو ۷", "تیگو ۸", "آریزو ۵", "آریزو ۶"] },
  { make: "ام‌وی‌ام", models: ["110", "315", "530", "550", "X22", "X33", "X55"] },
  { make: "جک", models: ["J4", "J5", "S3", "S5", "S7"] },
  { make: "هاوال", models: ["H2", "H6", "H9"] },
  { make: "جیلی", models: ["امگرند ۷", "GC6", "کولری"] },
  { make: "بی‌وای‌دی", models: ["F3", "S6"] },
  { make: "لیفان", models: ["520", "620", "X50", "X60"] },
  { make: "برلیانس", models: ["H220", "H230", "H320", "H330", "V5"] },
  { make: "دانگ‌فنگ", models: ["H30 کراس", "AX7", "S30"] },
  { make: "چانگان", models: ["CS35", "Eado"] },
  { make: "فاو", models: ["B30", "بسترن B30"] },
  { make: "کی‌ام‌سی", models: ["T8", "J7", "K7"] },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 2004 }, (_, index) => currentYear - index);
const fieldClass = "min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/25 disabled:cursor-not-allowed disabled:opacity-60";

const FitmentFinder = ({ compact = false }) => {
  const navigate = useNavigate();
  const [makes, setMakes] = useState(FALLBACK_VEHICLE_MAKES);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");

  useEffect(() => {
    let active = true;
    axios.get("/products/vehicles")
      .then(({ data }) => {
        const list = Array.isArray(data?.makes) ? data.makes.filter((item) => typeof item?.make === "string" && item.make) : [];
        if (active && list.length) setMakes(list);
      })
      .catch(() => { /* keep the fallback list */ });
    return () => { active = false; };
  }, []);

  const models = useMemo(() => makes.find((item) => item.make === make)?.models || [], [makes, make]);

  const submit = (event) => {
    event.preventDefault();
    if (!make) return;
    const params = new URLSearchParams({ make });
    if (model) params.set("model", model);
    if (year) params.set("year", year);
    navigate("/shop?" + params.toString());
  };

  return (
    <form onSubmit={submit} aria-labelledby="fitment-finder-heading" className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]"><CarFront size={20} aria-hidden="true" /></span>
        <div>
          <h2 id="fitment-finder-heading" className="text-base font-bold text-[var(--ui-text)]">قطعه مناسب خودروی خود را پیدا کنید</h2>
          {!compact && <p className="mt-0.5 text-xs text-[var(--ui-muted)]">برند، مدل و سال ساخت را انتخاب کنید.</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_0.8fr_auto]">
        <label className="block">
          <span className="sr-only">برند خودرو</span>
          <select value={make} onChange={(event) => { setMake(event.target.value); setModel(""); }} className={fieldClass} required>
            <option value="">برند خودرو</option>
            {makes.map((item) => <option key={item.make} value={item.make}>{item.make}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">مدل خودرو</span>
          <select value={model} onChange={(event) => setModel(event.target.value)} className={fieldClass} disabled={!make || models.length === 0}>
            <option value="">همه مدل‌ها</option>
            {models.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">سال ساخت</span>
          <select value={year} onChange={(event) => setYear(event.target.value)} className={fieldClass} disabled={!make}>
            <option value="">سال ساخت</option>
            {YEARS.map((item) => <option key={item} value={item}>{new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(item)}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!make} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-6 text-sm font-bold text-white transition hover:bg-[var(--ui-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-focus)]">
          <Search size={17} aria-hidden="true" />جستجوی قطعات
        </button>
      </div>
    </form>
  );
};

export default FitmentFinder;

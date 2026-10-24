import { useEffect, useMemo, useState } from "react";
import { Car, X } from "lucide-react";
import { PART_QUALITY_LABELS } from "../lib/commerce";
import { loadVehicleCatalog, VEHICLE_YEARS } from "../lib/vehicles";

const faYear = new Intl.NumberFormat("fa-IR", { useGrouping: false });
const selectClass = "min-h-11 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input-bg)] px-3 text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-focus)] focus:ring-2 focus:ring-[var(--ui-focus)]/25 disabled:cursor-not-allowed disabled:opacity-50";

// Vehicle + part filters. Values live in the URL (owned by the page); this
// component only reports changes. `makes` may come from the category facets;
// otherwise the public vehicle catalogue is used.
const PartFilters = ({ values, onChange, makes: providedMakes, brands = [], idPrefix = "part-filters", compact = false }) => {
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    if (providedMakes?.length) return undefined;
    let active = true;
    loadVehicleCatalog().then((makes) => { if (active) setCatalog(makes); }).catch(() => {});
    return () => { active = false; };
  }, [providedMakes?.length]);
  const makes = providedMakes?.length ? providedMakes : catalog;
  const models = useMemo(() => {
    const entry = makes.find((item) => item.make === values.make);
    return [...new Set(entry?.models || [])];
  }, [makes, values.make]);
  const qualities = Array.isArray(values.quality) ? values.quality : [];
  const partBrands = Array.isArray(values.partBrand) ? values.partBrand : [];
  const hasVehicle = Boolean(values.make || values.model || values.year);

  const toggleList = (key, list, value) =>
    onChange({ [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] });

  return (
    <div className={compact ? "space-y-4" : "space-y-5"}>
      <fieldset className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
        <legend className="flex items-center gap-2 px-1 text-sm font-bold text-[var(--ui-text)]"><Car size={16} aria-hidden="true" className="text-[var(--ui-accent)]" />خودروی شما</legend>
        <div className={"mt-2 grid gap-3 " + (compact ? "" : "sm:grid-cols-3")}>
          <label className="block text-xs font-semibold text-[var(--ui-muted)]" htmlFor={idPrefix + "-make"}>برند خودرو
            <select id={idPrefix + "-make"} className={selectClass + " mt-1"} value={values.make || ""} onChange={(event) => onChange({ make: event.target.value, model: "", year: values.year })}>
              <option value="">همه برندها</option>
              {makes.map((item) => <option key={item.make} value={item.make}>{item.make}</option>)}
              {values.make && !makes.some((item) => item.make === values.make) && <option value={values.make}>{values.make}</option>}
            </select>
          </label>
          <label className="block text-xs font-semibold text-[var(--ui-muted)]" htmlFor={idPrefix + "-model"}>مدل
            <select id={idPrefix + "-model"} className={selectClass + " mt-1"} disabled={!values.make} value={values.model || ""} onChange={(event) => onChange({ model: event.target.value })}>
              <option value="">همه مدل‌ها</option>
              {models.map((model) => <option key={model} value={model}>{model}</option>)}
              {values.model && !models.includes(values.model) && <option value={values.model}>{values.model}</option>}
            </select>
          </label>
          <label className="block text-xs font-semibold text-[var(--ui-muted)]" htmlFor={idPrefix + "-year"}>سال تولید (میلادی)
            <select id={idPrefix + "-year"} className={selectClass + " mt-1"} disabled={!values.make} value={values.year || ""} onChange={(event) => onChange({ year: event.target.value })}>
              <option value="">همه سال‌ها</option>
              {VEHICLE_YEARS.map((year) => <option key={year} value={String(year)}>{faYear.format(year)}</option>)}
            </select>
          </label>
        </div>
        {hasVehicle && (
          <button type="button" onClick={() => onChange({ make: "", model: "", year: "" })} className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs font-semibold text-[var(--ui-accent)] hover:bg-[var(--ui-hover)]">
            <X size={13} aria-hidden="true" />حذف خودرو
          </button>
        )}
      </fieldset>

      <fieldset className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
        <legend className="px-1 text-sm font-bold text-[var(--ui-text)]">کیفیت قطعه</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(PART_QUALITY_LABELS).map(([value, label]) => {
            const active = qualities.includes(value);
            return (
              <button key={value} type="button" aria-pressed={active} onClick={() => toggleList("quality", qualities, value)}
                className={"min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)] " + (active ? "border-[var(--ui-accent)] bg-[var(--ui-accent)] text-white" : "border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-strong)] hover:border-[var(--ui-accent)]")}>
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {brands.length > 0 && (
        <fieldset className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
          <legend className="px-1 text-sm font-bold text-[var(--ui-text)]">برند قطعه</legend>
          <div className="mt-2 flex max-h-48 flex-col gap-2 overflow-y-auto">
            {brands.map((brand) => (
              <label key={brand} className="flex min-h-8 items-center gap-2 text-sm text-[var(--ui-text)]">
                <input type="checkbox" className="h-4 w-4 accent-[var(--ui-accent)]" checked={partBrands.includes(brand)} onChange={() => toggleList("partBrand", partBrands, brand)} />
                <span dir="auto">{brand}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 text-sm font-semibold text-[var(--ui-text)]">
        <input type="checkbox" className="h-4 w-4 accent-[var(--ui-accent)]" checked={Boolean(values.inStock)} onChange={(event) => onChange({ inStock: event.target.checked })} />
        فقط کالاهای موجود
      </label>
    </div>
  );
};

export default PartFilters;

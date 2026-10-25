import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Filter, LoaderCircle, Search, ShoppingBag, SlidersHorizontal, X } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import PageMeta from "../components/PageMeta";
import { hasIndexExcludedQuery } from "../lib/seo-utils.js";
import toast from "react-hot-toast";
import axios from "../lib/axios";
import { formatPrice, getCurrencyLabel, PART_QUALITY_LABELS, STORE_CURRENCY } from "../lib/commerce";
import { VEHICLE_YEARS } from "../lib/vehicles";

const faYear = new Intl.NumberFormat("fa-IR", { useGrouping: false });
import { normalizeDigits, normalizePersianText as normalizePersian } from "../lib/persian-search";
import { useDialog } from "../lib/use-dialog";
import { useProductStore } from "../stores/useProductStore";
import { useCategoryStore } from "../stores/useCategoryStore";

const sortOptions = [
  ["newest", "جدیدترین"],
  ["priceAsc", "ارزان‌ترین"],
  ["priceDesc", "گران‌ترین"],
  ["nameAsc", "نام قطعه (الف تا ی)"],
];

const priceUnitLabel = getCurrencyLabel(STORE_CURRENCY);
const usesWholeCurrencyUnits = true;

const parseStorePrice = (value) => {
  if (String(value ?? "").trim() === "") return null;
  const normalized = normalizeDigits(value)
    .replace(/[,\u060C\u066C\u2009\s]/g, "")
    .replace(/[٫]/g, ".");
  const validFormat = usesWholeCurrencyUnits ? /^\d+$/.test(normalized) : /^\d+(?:\.\d{1,2})?$/.test(normalized);
  if (!validFormat) return Number.NaN;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return Number.NaN;
  return usesWholeCurrencyUnits && !Number.isSafeInteger(amount) ? Number.NaN : amount;
};

const formatStorePrice = (value) => formatPrice(value, STORE_CURRENCY);

const makeEmptyFilters = () => ({
  q: "",
  minPrice: "",
  maxPrice: "",
  sizes: [],
  colors: [],
  brands: [],
  qualities: [],
  make: "",
  model: "",
  year: "",
  inStock: false,
  attributes: {},
  sort: "newest",
});

const CATEGORY_PAGE_SIZE = 24;

const parsePageNumber = (value) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 100000) : 1;
};

const filtersFromParams = (params) => {
  const filters = makeEmptyFilters();
  filters.q = params.get("q") || "";
  filters.minPrice = params.get("minPrice") || "";
  filters.maxPrice = params.get("maxPrice") || "";
  filters.sizes = params.getAll("size").slice(0, 24);
  filters.colors = params.getAll("color").slice(0, 24);
  filters.brands = params.getAll("brand").slice(0, 24);
  filters.qualities = params.getAll("quality").filter((value) => Object.hasOwn(PART_QUALITY_LABELS, value));
  filters.make = params.get("make") || "";
  filters.model = filters.make ? params.get("model") || "" : "";
  filters.year = filters.make ? params.get("year") || "" : "";
  filters.inStock = params.get("inStock") === "1";
  const sort = params.get("sort");
  if (["newest", "oldest", "priceAsc", "priceDesc", "nameAsc"].includes(sort)) filters.sort = sort;
  try {
    const attributes = JSON.parse(params.get("attributes") || "{}");
    if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) filters.attributes = attributes;
  } catch {
    // Malformed "attributes" query param: ignore it and keep default filters.
  }
  return filters;
};

const paramsFromFilters = (filters) => {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.minPrice.trim()) params.set("minPrice", filters.minPrice.trim());
  if (filters.maxPrice.trim()) params.set("maxPrice", filters.maxPrice.trim());
  filters.sizes.forEach((value) => params.append("size", value));
  filters.colors.forEach((value) => params.append("color", value));
  filters.brands.forEach((value) => params.append("brand", value));
  filters.qualities.forEach((value) => params.append("quality", value));
  if (filters.make) params.set("make", filters.make);
  if (filters.make && filters.model) params.set("model", filters.model);
  if (filters.make && filters.year) params.set("year", filters.year);
  if (filters.inStock) params.set("inStock", "1");
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (Object.keys(filters.attributes || {}).length) params.set("attributes", JSON.stringify(filters.attributes));
  return params;
};

const uniqueByNormalizedName = (values) => {
  const seen = new Set();
  return values
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim())
    .filter((value) => {
      const normalized = normalizePersian(value);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, "fa", { numeric: true }));
};

const getPriceError = (filters) => {
  const min = parseStorePrice(filters.minPrice);
  const max = parseStorePrice(filters.maxPrice);
  if (Number.isNaN(min) || Number.isNaN(max)) return "قیمت را فقط با عدد وارد کنید.";
  if (min !== null && max !== null && min > max) {
    return "حداقل قیمت نباید از حداکثر قیمت بیشتر باشد.";
  }
  return "";
};

const CategoryPage = () => {
  const { slug: category = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const lastAppliedUrlRef = useRef(searchParams.toString());
  const urlChangedRef = useRef(false);
  const { fetchProductsByCategory, products, loading, priceBounds: remotePriceBounds, categoryPagination, categoryFacets } = useProductStore();
  const { categories: dynamicCategories, fetchCategories } = useCategoryStore();
  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  const [filters, setFilters] = useState(() => filtersFromParams(searchParams));
  const [draftFilters, setDraftFilters] = useState(() => filtersFromParams(searchParams));
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const mobileFiltersRef = useDialog({ open: mobileFiltersOpen, onClose: () => setMobileFiltersOpen(false) });
  const [page, setPage] = useState(() => parsePageNumber(searchParams.get("page")));
  const [draftResultCount, setDraftResultCount] = useState(0);

  useEffect(() => {
    const serialized = searchParams.toString();
    if (serialized !== lastAppliedUrlRef.current) {
      lastAppliedUrlRef.current = serialized;
      urlChangedRef.current = true;
      const fromUrl = filtersFromParams(searchParams);
      setFilters(fromUrl);
      setDraftFilters(fromUrl);
      setPage(parsePageNumber(searchParams.get("page")));
    }
  }, [searchParams]);

  useEffect(() => {
    if (urlChangedRef.current) {
      urlChangedRef.current = false;
      return;
    }
    const nextParams = paramsFromFilters(filters);
    if (page > 1) nextParams.set("page", String(page));
    const serialized = nextParams.toString();
    if (serialized !== searchParams.toString()) {
      lastAppliedUrlRef.current = serialized;
      setSearchParams(new URLSearchParams(serialized), { replace: true });
    }
  }, [filters, page, searchParams, setSearchParams]);

  useEffect(() => {
    const fromUrl = filtersFromParams(new URLSearchParams(window.location.search));
    setFilters(fromUrl);
    setDraftFilters(fromUrl);
    setMobileFiltersOpen(false);
    setPage(parsePageNumber(new URLSearchParams(window.location.search).get("page")));
  }, [category]);

  useEffect(() => {
    if (getPriceError(filters)) return;
    const query = paramsFromFilters(filters);
    query.set("page", String(page));
    query.set("limit", String(CATEGORY_PAGE_SIZE));
    fetchProductsByCategory(category, query.toString());
  }, [fetchProductsByCategory, category, filters, page]);

  const catalog = useMemo(() => (Array.isArray(products) ? products : []), [products]);
  const priceBounds = useMemo(() => {
    const reportedCount = Number(remotePriceBounds?.count);
    const reportedMin = Number(remotePriceBounds?.minPrice);
    const reportedMax = Number(remotePriceBounds?.maxPrice);
    if (
      remotePriceBounds &&
      reportedCount > 0 &&
      Number.isFinite(reportedMin) &&
      Number.isFinite(reportedMax)
    ) {
      const minPrice = Math.max(0, Math.floor(reportedMin));
      return {
        minPrice,
        maxPrice: Math.max(minPrice + 1, Math.ceil(reportedMax)),
        count: reportedCount,
      };
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let count = 0;
    catalog.forEach((product) => {
      const amount = Number(product.price);
      if (!Number.isFinite(amount) || amount < 0) return;
      min = Math.min(min, amount);
      max = Math.max(max, amount);
      count += 1;
    });
    if (!count) return { minPrice: 0, maxPrice: 1, count: 0 };
    const minPrice = Math.max(0, Math.floor(min));
    return {
      minPrice,
      maxPrice: Math.max(minPrice + 1, Math.ceil(max)),
      count,
    };
  }, [catalog, remotePriceBounds]);
  const currentFilterError = getPriceError(filters);
  const filteredProducts = currentFilterError ? [] : catalog;
  const resultCount = currentFilterError ? 0 : Number(categoryPagination?.total ?? catalog.length);
  const pageCount = Math.max(1, Number(categoryPagination?.pages) || Math.ceil(resultCount / CATEGORY_PAGE_SIZE));
  const visibleProducts = filteredProducts;

  const appliedFiltersKey = useMemo(() => paramsFromFilters(filters).toString(), [filters]);
  const draftFiltersKey = useMemo(() => paramsFromFilters(draftFilters).toString(), [draftFilters]);

  useEffect(() => {
    if (getPriceError(draftFilters)) {
      setDraftResultCount(0);
      return;
    }
    if (appliedFiltersKey === draftFiltersKey) {
      setDraftResultCount(resultCount);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const query = new URLSearchParams(draftFiltersKey);
      query.set("page", "1");
      query.set("limit", "1");
      query.set("countOnly", "1");
      try {
        const response = await axios.get(`/products/category/${encodeURIComponent(category)}?${query.toString()}`);
        if (!cancelled) setDraftResultCount(Number(response.data.pagination?.total || 0));
      } catch {
        if (!cancelled) setDraftResultCount(0);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [category, appliedFiltersKey, draftFiltersKey, resultCount, draftFilters]);

  const sizeOptions = useMemo(
    () => uniqueByNormalizedName(categoryFacets?.sizes || []),
    [categoryFacets],
  );

  const colorOptions = useMemo(
    () => Array.isArray(categoryFacets?.colors)
      ? categoryFacets.colors.filter((color) => color?.name).sort((a, b) => a.name.localeCompare(b.name, "fa"))
      : [],
    [categoryFacets],
  );

  const makeOptions = useMemo(
    () => (Array.isArray(categoryFacets?.makes) ? categoryFacets.makes.filter((entry) => entry?.make) : []),
    [categoryFacets],
  );
  const brandOptions = useMemo(
    () => uniqueByNormalizedName(categoryFacets?.brands || []),
    [categoryFacets],
  );

  const selectedCategory = dynamicCategories.find((item) => item.slug === category);
  const categoryAttributeDefinitions = useMemo(() => {
    if (!selectedCategory) return [];
    const byId = new Map(dynamicCategories.map((item) => [String(item._id), item]));
    const ancestors = (selectedCategory.ancestors || []).map((id) => byId.get(String(id))).filter(Boolean);
    const chain = [...ancestors, selectedCategory].sort((a, b) => (a.ancestors || []).length - (b.ancestors || []).length);
    const definitions = new Map();
    for (const currentCategory of chain) {
      for (const attribute of currentCategory.attributes || []) {
        if (String(currentCategory._id) === String(selectedCategory._id) || attribute.inherited !== false) definitions.set(attribute.key, attribute);
      }
    }
    return [...definitions.values()].filter((attribute) => attribute.filterable).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }, [dynamicCategories, selectedCategory]);

  const updateFilter = (setter, field, value) => {
    setter((current) => {
      if (["sizes", "colors", "qualities", "brands"].includes(field)) {
        const existing = current[field];
        return {
          ...current,
          [field]: existing.includes(value)
            ? existing.filter((entry) => entry !== value)
            : [...existing, value],
        };
      }
      return { ...current, [field]: value };
    });
    if (setter === setFilters) setPage(1);
  };

  const clearAllFilters = () => {
    const empty = makeEmptyFilters();
    setFilters(empty);
    setDraftFilters(empty);
    setMobileFiltersOpen(false);
    setPage(1);
  };

  const removeFilter = (field, value) => {
    setPage(1);
    setFilters((current) => {
      if (["sizes", "colors", "qualities", "brands"].includes(field)) {
        return { ...current, [field]: current[field].filter((entry) => entry !== value) };
      }
      if (field === "inStock") return { ...current, inStock: false };
      if (field === "make") return { ...current, make: "", model: "", year: "" };
      if (field === "attributes") {
        const attributes = { ...(current.attributes || {}) };
        delete attributes[value];
        return { ...current, attributes };
      }
      if (field === "sort") return { ...current, sort: "newest" };
      return { ...current, [field]: "" };
    });
  };

  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.q.trim()) chips.push({ field: "q", label: "جست‌وجو: «" + filters.q.trim() + "»" });
    if (filters.minPrice.trim()) {
      const value = parseStorePrice(filters.minPrice);
      chips.push({ field: "minPrice", label: "از " + (value !== null && Number.isFinite(value) ? formatStorePrice(value) : filters.minPrice + " " + priceUnitLabel) });
    }
    if (filters.maxPrice.trim()) {
      const value = parseStorePrice(filters.maxPrice);
      chips.push({ field: "maxPrice", label: "تا " + (value !== null && Number.isFinite(value) ? formatStorePrice(value) : filters.maxPrice + " " + priceUnitLabel) });
    }
    if (filters.make) chips.push({ field: "make", label: "خودرو: " + [filters.make, filters.model, filters.year].filter(Boolean).join(" ") });
    filters.qualities.forEach((value) => chips.push({ field: "qualities", value, label: "کیفیت: " + (PART_QUALITY_LABELS[value] || value) }));
    filters.sizes.forEach((value) => chips.push({ field: "sizes", value, label: "نوع: " + value }));
    filters.colors.forEach((value) => chips.push({ field: "colors", value, label: "رنگ: " + value }));
    filters.brands.forEach((value) => chips.push({ field: "brands", value, label: "برند قطعه: " + value }));
    Object.entries(filters.attributes || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
      const definition = categoryAttributeDefinitions.find((attribute) => attribute.key === key);
      const values = Array.isArray(value) ? value : [value];
      const labels = values.map((entry) => definition?.options?.find((option) => option.value === String(entry))?.name?.fa || String(entry));
      chips.push({ field: "attributes", value: key, label: (definition?.name?.fa || key) + ": " + labels.join("، ") });
    });
    if (filters.inStock) chips.push({ field: "inStock", label: "فقط کالاهای موجود" });
    if (filters.sort !== "newest") {
      const sortLabel = sortOptions.find(([value]) => value === filters.sort)?.[1];
      if (sortLabel) chips.push({ field: "sort", label: "مرتب‌سازی: " + sortLabel });
    }
    return chips;
  }, [filters, categoryAttributeDefinitions]);

  const renderFilterFields = (current, onFilterChange) => {
    const rangeMin = priceBounds.minPrice;
    const rangeMax = Math.max(rangeMin + 1, priceBounds.maxPrice);
    const span = rangeMax - rangeMin;
    const sliderStep = Math.max(1, Math.ceil(span / 1200));
    const minParsed = parseStorePrice(current.minPrice);
    const maxParsed = parseStorePrice(current.maxPrice);
    const clampToRange = (value, fallback) =>
      Number.isFinite(value) ? Math.min(rangeMax, Math.max(rangeMin, value)) : fallback;
    const minCandidate = clampToRange(minParsed, rangeMin);
    const maxCandidate = clampToRange(maxParsed, rangeMax);
    const sliderMinValue = Math.min(minCandidate, maxCandidate);
    const sliderMaxValue = Math.max(minCandidate, maxCandidate);
    const sliderMinPercent = ((sliderMinValue - rangeMin) / span) * 100;
    const sliderMaxPercent = ((sliderMaxValue - rangeMin) / span) * 100;
    const updateSliderPrice = (field, rawValue) => {
      const value = Math.min(rangeMax, Math.max(rangeMin, Math.round(Number(rawValue))));
      const nextMin = field === "minPrice" ? Math.min(value, sliderMaxValue) : sliderMinValue;
      const nextMax = field === "maxPrice" ? Math.max(value, sliderMinValue) : sliderMaxValue;
      onFilterChange("minPrice", nextMin <= rangeMin ? "" : String(nextMin));
      onFilterChange("maxPrice", nextMax >= rangeMax ? "" : String(nextMax));
    };

    return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <fieldset className="min-w-0 space-y-3">
        <legend className="text-sm font-semibold text-[#33373e]">محدوده قیمت ({priceUnitLabel})</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-[#6b717b]">
            از
            <input
              type="text"
              inputMode="numeric"
              dir="ltr"
              maxLength={18}
              value={current.minPrice}
              onChange={(event) => onFilterChange("minPrice", event.target.value)}
              placeholder="بدون محدودیت"
              aria-label={"حداقل قیمت به " + priceUnitLabel}
              className="mt-1 min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm tabular-nums text-[#1c1f24] outline-none transition placeholder:text-[#aaa99f] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10"
            />
          </label>
          <label className="block text-xs text-[#6b717b]">
            تا
            <input
              type="text"
              inputMode="numeric"
              dir="ltr"
              maxLength={18}
              value={current.maxPrice}
              onChange={(event) => onFilterChange("maxPrice", event.target.value)}
              placeholder="بدون محدودیت"
              aria-label={"حداکثر قیمت به " + priceUnitLabel}
              className="mt-1 min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm tabular-nums text-[#1c1f24] outline-none transition placeholder:text-[#aaa99f] focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10"
            />
          </label>
        </div>
        <div className="rounded-xl border border-[#e2e5ea] bg-[#f5f6f8] px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[#5a606a]">
            <span>از <strong className="tabular-nums text-[#1c1f24]">{formatStorePrice(sliderMinValue)}</strong></span>
            <span>تا <strong className="tabular-nums text-[#1c1f24]">{formatStorePrice(sliderMaxValue)}</strong></span>
          </div>
          <div className={"relative h-7 " + (priceBounds.count > 0 ? "" : "opacity-50")} dir="ltr">
            <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#dde1e6]" />
            <div
              className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#ea580c]"
              style={{ left: sliderMinPercent + "%", right: 100 - sliderMaxPercent + "%" }}
            />
            <input
              type="range"
              min={rangeMin}
              max={rangeMax}
              step={sliderStep}
              value={sliderMinValue}
              disabled={priceBounds.count === 0}
              aria-label={"حداقل قیمت به " + priceUnitLabel}
              aria-valuetext={formatStorePrice(sliderMinValue)}
              onChange={(event) => updateSliderPrice("minPrice", event.target.value)}
              className="price-range-slider"
              style={{ zIndex: sliderMinValue >= sliderMaxValue - sliderStep ? 5 : 4 }}
            />
            <input
              type="range"
              min={rangeMin}
              max={rangeMax}
              step={sliderStep}
              value={sliderMaxValue}
              disabled={priceBounds.count === 0}
              aria-label={"حداکثر قیمت به " + priceUnitLabel}
              aria-valuetext={formatStorePrice(sliderMaxValue)}
              onChange={(event) => updateSliderPrice("maxPrice", event.target.value)}
              className="price-range-slider"
              style={{ zIndex: sliderMinValue >= sliderMaxValue - sliderStep ? 4 : 5 }}
            />
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[#7d838d]">با جابه‌جایی هر دستگیره، نتایج همان لحظه به‌روز می‌شوند.</p>
        </div>
        {getPriceError(current) && (
          <p role="alert" className="text-xs leading-5 text-[#a13f35]">{getPriceError(current)}</p>
        )}
        <p className="text-[11px] leading-5 text-[#7d838d]">قیمت‌ها بر اساس {priceUnitLabel} هستند؛ اعداد فارسی و انگلیسی پذیرفته می‌شوند.</p>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold text-[#33373e]">مرتب‌سازی</legend>
        <select
          value={current.sort}
          onChange={(event) => onFilterChange("sort", event.target.value)}
          aria-label="مرتب‌سازی قطعات"
          className="min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none transition focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10"
        >
          {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[#e2e5ea] bg-white px-3 py-2 text-sm text-[#33373e] transition hover:border-[#c3c8cf]">
          <input
            type="checkbox"
            checked={current.inStock}
            onChange={(event) => onFilterChange("inStock", event.target.checked)}
            className="h-4 w-4 accent-[#ea580c]"
          />
          فقط کالاهای موجود
        </label>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold text-[#33373e]">خودروی شما</legend>
        <select
          value={current.make}
          onChange={(event) => { onFilterChange("make", event.target.value); onFilterChange("model", ""); if (!event.target.value) onFilterChange("year", ""); }}
          aria-label="برند خودرو"
          className="min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10"
        >
          <option value="">همه برندهای خودرو</option>
          {makeOptions.map((entry) => <option key={entry.make} value={entry.make}>{entry.make}</option>)}
          {current.make && !makeOptions.some((entry) => entry.make === current.make) && <option value={current.make}>{current.make}</option>}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={current.model}
            disabled={!current.make}
            onChange={(event) => onFilterChange("model", event.target.value)}
            aria-label="مدل خودرو"
            className="min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none focus:border-[#ea580c] disabled:opacity-50"
          >
            <option value="">همه مدل‌ها</option>
            {(makeOptions.find((entry) => entry.make === current.make)?.models || []).map((model) => <option key={model} value={model}>{model}</option>)}
            {current.model && !(makeOptions.find((entry) => entry.make === current.make)?.models || []).includes(current.model) && <option value={current.model}>{current.model}</option>}
          </select>
          <select
            value={current.year}
            disabled={!current.make}
            onChange={(event) => onFilterChange("year", event.target.value)}
            aria-label="سال تولید خودرو"
            className="min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none focus:border-[#ea580c] disabled:opacity-50"
          >
            <option value="">همه سال‌ها</option>
            {VEHICLE_YEARS.map((year) => <option key={year} value={String(year)}>{faYear.format(year)}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="کیفیت قطعه">
          {Object.entries(PART_QUALITY_LABELS).map(([value, label]) => (
            <label key={value} className={"inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition " + (current.qualities.includes(value) ? "border-[#ea580c] bg-[#fff1e7] text-[#33373e]" : "border-[#ebedf1] text-[#5a606a] hover:border-[#c3c8cf]")}>
              <input type="checkbox" checked={current.qualities.includes(value)} onChange={() => onFilterChange("qualities", value)} className="h-3.5 w-3.5 accent-[#ea580c]" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {sizeOptions.length > 0 && (
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-semibold text-[#33373e]">نوع / موقعیت</legend>
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-xl border border-[#e2e5ea] bg-white p-2">
            {sizeOptions.map((option) => (
              <label key={option} className={"inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition " + (current.sizes.includes(option) ? "border-[#ea580c] bg-[#fff1e7] text-[#33373e]" : "border-[#ebedf1] text-[#5a606a] hover:border-[#c3c8cf]")}>
                <input
                  type="checkbox"
                  checked={current.sizes.includes(option)}
                  onChange={() => onFilterChange("sizes", option)}
                  className="h-3.5 w-3.5 accent-[#ea580c]"
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {colorOptions.length > 0 && (
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-semibold text-[#33373e]">رنگ</legend>
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-xl border border-[#e2e5ea] bg-white p-2">
            {colorOptions.map((option) => (
              <label key={option.name} className={"inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition " + (current.colors.includes(option.name) ? "border-[#ea580c] bg-[#fff1e7] text-[#33373e]" : "border-[#ebedf1] text-[#5a606a] hover:border-[#c3c8cf]")}>
                <input
                  type="checkbox"
                  checked={current.colors.includes(option.name)}
                  onChange={() => onFilterChange("colors", option.name)}
                  className="h-3.5 w-3.5 accent-[#ea580c]"
                />
                {option.hex && <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: option.hex }} />}
                <span>{option.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {(categoryAttributeDefinitions.length > 0 || brandOptions.length > 0) && (
        <details
          className="min-w-0 rounded-2xl border border-[#e2e5ea] bg-white/70 p-3 sm:col-span-2 sm:p-4 xl:col-span-3"
          open={Boolean(
            current.brands.length ||
            Object.values(current.attributes || {}).some((value) =>
              value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)
            )
          )}
        >
          <summary className="cursor-pointer list-none text-sm font-semibold text-[#33373e] outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]">
            فیلترهای بیشتر
            <span className="mr-2 text-xs font-normal text-[#7d838d]">ویژگی‌های تخصصی و برند قطعه</span>
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
      {categoryAttributeDefinitions.filter((attribute) => attribute.filterable).map((attribute) => {
        const selected = current.attributes?.[attribute.key];
        const updateAttributeFilter = (value) => onFilterChange("attributes", { ...(current.attributes || {}), [attribute.key]: value });
        return (
          <fieldset key={attribute.key} className="min-w-0 space-y-2">
            <legend className="text-sm font-semibold text-[#33373e]">{attribute.name?.fa || attribute.name?.en || attribute.key}</legend>
            {attribute.type === "select" ? (
              <select value={selected === undefined ? "" : String(selected)} onChange={(event) => updateAttributeFilter(event.target.value === "" ? undefined : event.target.value)} className="min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10">
                <option value="">همه</option>
                {(attribute.options || []).map((option) => <option key={option.value} value={option.value}>{option.name?.fa || option.name?.en || option.value}</option>)}
              </select>
            ) : attribute.type === "multi-select" ? (
              <select multiple value={Array.isArray(selected) ? selected.map(String) : []} onChange={(event) => updateAttributeFilter([...event.target.selectedOptions].map((option) => option.value))} className="min-h-24 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none focus:border-[#ea580c] focus:ring-4 focus:ring-[#ea580c]/10">
                {(attribute.options || []).map((option) => <option key={option.value} value={option.value}>{option.name?.fa || option.name?.en || option.value}</option>)}
              </select>
            ) : attribute.type === "boolean" ? (
              <select value={selected === undefined ? "" : (selected ? "true" : "false")} onChange={(event) => updateAttributeFilter(event.target.value === "" ? undefined : event.target.value === "true")} className="min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none focus:border-[#ea580c]">
                <option value="">همه</option><option value="true">بله</option><option value="false">خیر</option>
              </select>
            ) : (
              <input type={attribute.type === "number" ? "number" : "text"} value={selected ?? ""} onChange={(event) => updateAttributeFilter(event.target.value === "" ? undefined : (attribute.type === "number" ? Number(event.target.value) : event.target.value))} className="min-h-11 w-full rounded-xl border border-[#dde1e6] bg-white px-3 py-2 text-sm text-[#1c1f24] outline-none focus:border-[#ea580c]" />
            )}
          </fieldset>
        );
      })}

      {brandOptions.length > 0 && (
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-semibold text-[#33373e]">برند</legend>
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-xl border border-[#e2e5ea] bg-white p-2">
            {brandOptions.map((option) => (
              <label key={option} className={"inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition " + (current.brands.includes(option) ? "border-[#ea580c] bg-[#fff1e7] text-[#33373e]" : "border-[#ebedf1] text-[#5a606a] hover:border-[#c3c8cf]")}>
                <input
                  type="checkbox"
                  checked={current.brands.includes(option)}
                  onChange={() => onFilterChange("brands", option)}
                  className="h-3.5 w-3.5 accent-[#ea580c]"
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
          </div>
        </details>
      )}
    </div>
    );
  };

  const pageTitle = selectedCategory?.name?.fa || category.replace(/-/g, " ");
  const copyFilterLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("لینک فیلترها کپی شد.");
    } catch {
      window.prompt("لینک قابل‌اشتراک دسته‌بندی:", url);
    }
  };
  const categoryChildren = selectedCategory
    ? dynamicCategories
        .filter((item) => String(item.parentId || "") === String(selectedCategory._id) && item.showInNavigation !== false)
        .sort((a, b) =>
          Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
          String(a.name?.fa || "").localeCompare(String(b.name?.fa || ""), "fa")
        )
    : [];
  const categoryAncestors = selectedCategory
    ? (selectedCategory.ancestors || []).map((ancestorId) => dynamicCategories.find((item) => String(item._id) === String(ancestorId))).filter(Boolean)
    : [];
  const priceError = getPriceError(filters);

  return (
    <main dir="rtl" className="min-h-screen bg-[#f5f6f8] px-3 py-7 text-[#1c1f24] sm:px-6 sm:py-10 lg:px-8">
      <PageMeta title={pageTitle} description={selectedCategory?.description?.fa || selectedCategory?.description?.en || ("خرید قطعات یدکی دسته " + pageTitle + " برای خودروهای چینی در میبا.")} image={selectedCategory?.image} path={"/category/" + category} type="category" itemList={products} breadcrumbs={[{ name: "صفحه اصلی", path: "/" }, { name: pageTitle, path: "/category/" + category }]} robots={hasIndexExcludedQuery(Object.fromEntries(searchParams.entries())) || !selectedCategory ? "noindex, follow" : "index, follow, max-image-preview:large"} canonical={Boolean(selectedCategory)} />
      <div className="mx-auto max-w-[1920px]">
        <header className="mb-6 flex flex-col gap-4 border-b border-[#e2e5ea] pb-5 sm:mb-7 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
          <div className="min-w-0">
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#ea580c]">
              <ShoppingBag size={15} aria-hidden="true" />
              مجموعه میبا
            </p>
            <motion.h1
              className="text-3xl font-semibold tracking-tight text-[#1c1f24] sm:text-4xl"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {pageTitle}
            </motion.h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6b717b]">
              {selectedCategory?.description?.fa?.trim() || selectedCategory?.description?.en?.trim() || ("نام یا کد فنی قطعه را جست‌وجو کنید و با فیلتر خودرو، کیفیت و قیمت به " + priceUnitLabel + " قطعه سازگار را پیدا کنید.")}
            </p>
            {currentFilterError && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{currentFilterError}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div aria-live="polite" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#e2e5ea] bg-[#ffffff] px-4 py-2 text-sm text-[#5a606a]">
              {loading ? (
                <>
                  <LoaderCircle size={16} className="animate-spin text-[#ea580c]" aria-hidden="true" />
                  در حال دریافت قطعات…
                </>
              ) : (
                <>
                  <ShoppingBag size={16} className="text-[#ea580c]" aria-hidden="true" />
                  {new Intl.NumberFormat("fa-IR").format(resultCount)} قطعه
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setDraftFilters(filters);
                setMobileFiltersOpen(true);
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d2d6dc] bg-[#ffffff] px-4 py-2 text-sm font-semibold text-[#33373e] transition hover:border-[#a8adb4] hover:bg-[#fff1e7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c] md:hidden"
            >
              <Filter size={16} aria-hidden="true" />
              فیلترها
              {activeChips.length > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#ea580c] px-1.5 py-0.5 text-xs font-bold text-white">
                  {new Intl.NumberFormat("fa-IR").format(activeChips.length)}
                </span>
              )}
            </button>
            <button type="button" onClick={copyFilterLink} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d2d6dc] bg-[#ffffff] px-3 py-2 text-xs font-semibold text-[#33373e] transition hover:border-[#ea580c]" aria-label="کپی لینک این دسته‌بندی با فیلترهای فعلی">کپی لینک فیلترها</button>
          </div>
        </header>

        {selectedCategory && (categoryAncestors.length > 0 || categoryChildren.length > 0) && (
          <nav aria-label="مسیر دسته‌بندی" className="mb-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b717b]">
              <Link to="/shop" className="hover:text-[#ea580c]">فروشگاه</Link>
              {categoryAncestors.map((ancestor) => (
                <span key={ancestor._id} className="inline-flex items-center gap-2">
                  <span aria-hidden="true">/</span>
                  <Link to={"/category/" + ancestor.slug} className="hover:text-[#ea580c]">{ancestor.name?.fa || ancestor.name?.en}</Link>
                </span>
              ))}
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-[#33373e]">{pageTitle}</span>
            </div>
            {categoryChildren.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {categoryChildren.map((child) => (
                  <Link key={child._id} to={"/category/" + child.slug} className="inline-flex min-h-9 items-center rounded-full border border-[#d2d6dc] bg-white px-3 py-1.5 text-xs font-medium text-[#33373e] transition hover:border-[#ea580c] hover:bg-[#fff1e7]">
                    {child.name?.fa || child.name?.en}
                  </Link>
                ))}
              </div>
            )}
          </nav>
        )}

        <section aria-label="جست‌وجو در این دسته‌بندی" className="mb-5 rounded-2xl border border-[#e2e5ea] bg-[#ffffff] p-3 shadow-[0_8px_30px_-24px_rgba(28,31,36,0.22)] sm:p-4">
          <label htmlFor="category-product-search" className="mb-2 block text-sm font-semibold text-[#33373e]">جست‌وجو در {pageTitle}</label>
          <div className="flex min-h-12 items-center gap-2 rounded-xl border border-[#dde1e6] bg-white px-3 transition focus-within:border-[#ea580c] focus-within:ring-4 focus-within:ring-[#ea580c]/10">
            <Search size={19} className="shrink-0 text-[#ea580c]" aria-hidden="true" />
            <input
              id="category-product-search"
              type="search"
              value={filters.q}
              onChange={(event) => { setFilters((current) => ({ ...current, q: event.target.value })); setPage(1); }}
              placeholder="مثلاً لنت ترمز، T11-3501080، تیگو ۵…"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-[#1c1f24] outline-none placeholder:text-[#9aa0a8]"
            />
            {filters.q && (
              <button type="button" onClick={() => { setFilters((current) => ({ ...current, q: "" })); setPage(1); }} aria-label="پاک‌کردن عبارت جست‌وجو" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6b717b] transition hover:bg-[#f0f2f5] hover:text-[#1c1f24]">
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="mt-2 text-xs leading-5 text-[#7d838d]">جست‌وجو با حروف «ی» و «ک» فارسی یا عربی و اعداد فارسی و انگلیسی پشتیبانی می‌شود.</p>
        </section>

        <section aria-label="فیلترهای قطعات" className="mb-5 hidden rounded-2xl border border-[#e2e5ea] bg-[#ffffff] p-4 shadow-[0_8px_30px_-24px_rgba(28,31,36,0.22)] md:block sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#eceff3] pb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={18} className="text-[#ea580c]" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[#1c1f24]">فیلترها</h2>
              <span className="text-xs text-[#7d838d]">نتایج بر اساس مشخصات ثبت‌شده قطعه</span>
            </div>
            <button
              type="button"
              onClick={clearAllFilters}
              disabled={activeChips.length === 0}
              className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold text-[#ea580c] transition hover:bg-[#fff1e7] hover:text-[#33373e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c] disabled:cursor-not-allowed disabled:text-[#a9a99f] disabled:hover:bg-transparent"
            >
              <X size={15} aria-hidden="true" />
              پاک‌کردن فیلترها
            </button>
          </div>
          {renderFilterFields(filters, (field, value) => updateFilter(setFilters, field, value))}
        </section>

        {activeChips.length > 0 && (
          <section aria-label="فیلترهای فعال" className="mb-5 rounded-2xl border border-[#e2e5ea] bg-white/70 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#33373e]">
                <SlidersHorizontal size={15} className="text-[#ea580c]" aria-hidden="true" />
                فیلترهای فعال
                <span className="text-xs font-medium text-[#7d838d]">({new Intl.NumberFormat("fa-IR").format(activeChips.length)})</span>
              </div>
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex min-h-9 items-center rounded-full px-3 text-xs font-bold text-[#ea580c] transition hover:bg-[#fff1e7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ea580c]"
              >
                پاک‌کردن فیلترها
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeChips.map((chip, index) => (
                <button
                  key={chip.field + ":" + (chip.value || chip.label) + ":" + index}
                  type="button"
                  onClick={() => removeFilter(chip.field, chip.value)}
                  aria-label={"حذف فیلتر " + chip.label}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#d2d6dc] bg-[#ffffff] px-3 py-1.5 text-xs font-medium text-[#33373e] transition hover:border-[#a8adb4] hover:bg-[#fff1e7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]"
                >
                  <span>{chip.label}</span>
                  <X size={13} className="text-[#7d838d]" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}

        {priceError && (
          <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{priceError}</p>
        )}

        {loading ? (
          <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-[#5a606a]">
            <LoaderCircle size={28} className="animate-spin text-[#ea580c]" aria-hidden="true" />
            در حال آماده‌سازی قطعات…
          </div>
        ) : filteredProducts.length > 0 ? (
          <motion.div
            className="grid grid-cols-2 justify-items-stretch gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            {visibleProducts.map((product) => <ProductCard key={product._id} product={product} />)}
          </motion.div>
        ) : (
          <section className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-[#d5d9df] bg-[#ffffff] px-5 py-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff1e7] text-[#ea580c]">
              <Search size={24} aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-[#1c1f24]">قطعه‌ای پیدا نشد</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[#6b717b]">
              {activeChips.length > 0
                ? "فیلترها یا عبارت جست‌وجو را تغییر دهید تا قطعات بیشتری ببینید."
                : "در حال حاضر قطعه‌ای در این دسته‌بندی ثبت نشده است."}
            </p>
            {activeChips.length > 0 && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1c1f24] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#33373e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]"
              >
                پاک‌کردن فیلترها
              </button>
            )}
          </section>
        )}
        {!loading && resultCount > CATEGORY_PAGE_SIZE && (
          <nav aria-label="صفحه‌بندی قطعات دسته‌بندی" className="mt-8 flex flex-wrap items-center justify-center gap-3 border-t border-[#e2e5ea] pt-6">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 rounded-full border border-[#d2d6dc] bg-white px-4 py-2 text-sm disabled:opacity-40">قبلی</button>
            <span className="text-sm text-[#5a606a]">صفحه {new Intl.NumberFormat("fa-IR").format(page)} از {new Intl.NumberFormat("fa-IR").format(pageCount)} · {new Intl.NumberFormat("fa-IR").format(resultCount)} قطعه</span>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="min-h-10 rounded-full border border-[#d2d6dc] bg-white px-4 py-2 text-sm disabled:opacity-40">بعدی</button>
          </nav>
        )}
      </div>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <button
            type="button"
            aria-label="بستن فیلترها"
            onClick={() => setMobileFiltersOpen(false)}
            className="absolute inset-0 h-full w-full bg-[#1c1f24]/45 backdrop-blur-sm"
          />
          <section
            ref={mobileFiltersRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-category-filters-title"
            className="absolute inset-y-0 right-0 flex h-[100dvh] w-[min(94vw,30rem)] flex-col border-l border-[#e2e5ea] bg-[#f5f6f8] shadow-[0_24px_80px_-20px_rgba(28,31,36,0.42)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#e2e5ea] bg-[#ffffff] px-4 py-4">
              <div>
                <h2 id="mobile-category-filters-title" className="text-lg font-semibold text-[#1c1f24]">فیلتر قطعات</h2>
                <p className="mt-1 text-xs text-[#6b717b]">نتیجه فعلی: {new Intl.NumberFormat("fa-IR").format(draftResultCount)} قطعه</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="بستن پنجره فیلترها"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e2e5ea] bg-white text-[#5a606a] transition hover:bg-[#f0f2f5] hover:text-[#1c1f24]"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
              {renderFilterFields(draftFilters, (field, value) => updateFilter(setDraftFilters, field, value))}
            </div>
            <div className="border-t border-[#e2e5ea] bg-[#ffffff] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <p aria-live="polite" className="mb-3 text-center text-sm font-semibold text-[#5a606a]">
                {getPriceError(draftFilters) || (new Intl.NumberFormat("fa-IR").format(draftResultCount) + " قطعه با این فیلترها")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#d2d6dc] bg-white px-3 py-2.5 text-sm font-semibold text-[#33373e] transition hover:bg-[#f0f2f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ea580c]"
                >
                  پاک‌کردن فیلترها
                </button>
                <button
                  type="button"
                  disabled={Boolean(getPriceError(draftFilters))}
                  onClick={() => {
                    setFilters((current) => ({ ...draftFilters, q: current.q }));
                    setPage(1);
                    setMobileFiltersOpen(false);
                  }}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#1c1f24] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#33373e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ea580c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  نمایش {new Intl.NumberFormat("fa-IR").format(draftResultCount)} قطعه
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
};

export default CategoryPage;

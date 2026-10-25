// URL <-> filter state for the vehicle/part filters (shared by shop and category pages).
export const PART_FILTER_KEYS = ["make", "model", "year", "quality", "partBrand", "inStock"];

export const readPartFilters = (searchParams) => ({
  make: searchParams.get("make") || "",
  model: searchParams.get("model") || "",
  year: searchParams.get("year") || "",
  quality: searchParams.getAll("quality"),
  partBrand: searchParams.getAll("partBrand"),
  inStock: ["1", "true"].includes(searchParams.get("inStock") || ""),
});

// Returns a new URLSearchParams with `patch` applied; resets pagination.
export const applyPartFilterPatch = (searchParams, patch) => {
  const next = new URLSearchParams(searchParams);
  for (const [key, value] of Object.entries(patch)) {
    next.delete(key);
    if (Array.isArray(value)) value.filter(Boolean).forEach((entry) => next.append(key, entry));
    else if (typeof value === "boolean") { if (value) next.set(key, "1"); }
    else if (value !== undefined && value !== null && String(value).trim()) next.set(key, String(value).trim());
  }
  if (next.get("model") && !next.get("make")) next.delete("model");
  if (next.get("year") && !next.get("make")) next.delete("year");
  next.delete("page");
  return next;
};

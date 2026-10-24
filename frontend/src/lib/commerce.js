export const STORE_CURRENCY = "IRT";

const persianNumberFormat = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 0,
});

export const getCurrencyLabel = () => "تومان";

export const formatPrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${persianNumberFormat.format(Math.round(amount))} تومان`;
};

export const isStockTracked = (product) =>
  typeof product?.stock === "number" && Number.isFinite(product.stock);

export const isOutOfStock = (product) => isStockTracked(product) && product.stock <= 0;

// ---- Automotive part helpers ----------------------------------------------

export const PART_QUALITY_LABELS = Object.freeze({
  genuine: "اصلی (جنیون)",
  oem: "OEM / شرکتی",
  aftermarket: "یدکی تجاری",
  used: "استوک",
});
export const partQualityLabel = (quality) => PART_QUALITY_LABELS[quality] || "";

export const RETAIL_MAX_LINE_QUANTITY = 100;
export const maxLineQuantity = (item) => {
  const value = Number(item?.maxQuantity);
  return Number.isInteger(value) && value > 0 ? value : RETAIL_MAX_LINE_QUANTITY;
};

const wholeAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

// The wholesale offer shown to a wholesale viewer, or null. Only meaningful
// when it is actually cheaper than retail.
export const wholesaleOffer = (product) => {
  const unit = wholeAmount(product?.wholesaleUnitPrice);
  const retail = wholeAmount(product?.price);
  if (product?.pricingTier !== "wholesale" || unit === null || retail === null || unit >= retail) return null;
  const minQuantity = Number.isInteger(Number(product.wholesaleMinQuantity)) && Number(product.wholesaleMinQuantity) > 0
    ? Number(product.wholesaleMinQuantity) : 1;
  return { unitPrice: unit, minQuantity, retailPrice: retail };
};

// Mirrors backend/lib/pricing.js unitPriceFor (the server re-prices at checkout).
export const effectiveUnitPrice = (item, quantity = item?.quantity ?? 1) => {
  const retail = wholeAmount(item?.price) ?? 0;
  const offer = wholesaleOffer(item);
  if (!offer) return retail;
  return Number(quantity) >= offer.minQuantity ? offer.unitPrice : retail;
};

export const lineTotal = (item) => effectiveUnitPrice(item) * Number(item?.quantity || 0);

const yearRange = (from, to) => {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `از ${from}`;
  if (to) return `تا ${to}`;
  return "";
};
export const formatFitment = (fitment) => {
  if (!fitment || typeof fitment !== "object") return "";
  const years = yearRange(fitment.yearFrom, fitment.yearTo);
  return [fitment.make, fitment.model, fitment.engine, years ? `(${years})` : ""].filter(Boolean).join(" ");
};
export const fitmentSummary = (fitments, limit = 2) => {
  const list = Array.isArray(fitments) ? fitments : [];
  const names = [...new Set(list.map((item) => [item?.make, item?.model].filter(Boolean).join(" ")).filter(Boolean))];
  if (!names.length) return "";
  const shown = names.slice(0, limit).join("، ");
  return names.length > limit ? `${shown} و ${new Intl.NumberFormat("fa-IR").format(names.length - limit)} خودروی دیگر` : shown;
};

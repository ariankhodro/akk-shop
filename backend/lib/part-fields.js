import { PART_QUALITIES } from "../models/product.model.js";

// Validation for the automotive-part fields of a product. Pure function:
// returns { values } or { error } (Persian message for the admin UI).
const MAX_OEM_NUMBERS = 20;
const MAX_FITMENTS = 60;
const PART_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$/;

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const toLatinDigits = (value) => String(value ?? "")
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

const optionalYear = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const year = Number(toLatinDigits(value));
  return Number.isInteger(year) && year >= 1950 && year <= 2100 ? year : Number.NaN;
};

const optionalWholeNumber = (value, { min, max }) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(toLatinDigits(value).replace(/[,،٬\s]/g, ""));
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : Number.NaN;
};

export const normalizePartFields = (body = {}) => {
  const sku = toLatinDigits(text(body.sku, 64)).toUpperCase();
  if (sku && !PART_NUMBER_PATTERN.test(sku)) return { error: "کد کالا فقط می‌تواند شامل حروف لاتین، عدد، فاصله و - _ . / باشد." };

  const rawOem = Array.isArray(body.oemNumbers)
    ? body.oemNumbers
    : typeof body.oemNumbers === "string" ? body.oemNumbers.split(/[,،\n]/) : [];
  if (rawOem.length > MAX_OEM_NUMBERS) return { error: "حداکثر " + MAX_OEM_NUMBERS + " شماره فنی مجاز است." };
  const oemNumbers = [];
  for (const entry of rawOem) {
    if (typeof entry !== "string") return { error: "شماره فنی معتبر نیست." };
    const value = toLatinDigits(entry.trim()).toUpperCase();
    if (!value) continue;
    if (!PART_NUMBER_PATTERN.test(value)) return { error: "شماره فنی «" + value.slice(0, 30) + "» معتبر نیست." };
    if (!oemNumbers.includes(value)) oemNumbers.push(value);
  }

  const quality = typeof body.quality === "string" ? body.quality : "";
  if (quality && !PART_QUALITIES.includes(quality)) return { error: "کیفیت قطعه معتبر نیست." };

  const warrantyMonths = optionalWholeNumber(body.warrantyMonths, { min: 0, max: 120 });
  if (Number.isNaN(warrantyMonths)) return { error: "مدت گارانتی باید بین ۰ تا ۱۲۰ ماه باشد." };

  const rawFitments = body.fitments === undefined || body.fitments === null ? [] : body.fitments;
  if (!Array.isArray(rawFitments) || rawFitments.length > MAX_FITMENTS) return { error: "فهرست خودروهای سازگار معتبر نیست." };
  const fitments = [];
  const seen = new Set();
  for (const item of rawFitments) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "اطلاعات خودروی سازگار معتبر نیست." };
    const make = text(item.make, 60);
    const model = text(item.model, 80);
    const engine = text(item.engine, 80);
    const yearFrom = optionalYear(item.yearFrom);
    const yearTo = optionalYear(item.yearTo);
    if (!make) return { error: "برند خودرو برای هر ردیف سازگاری الزامی است." };
    if (Number.isNaN(yearFrom) || Number.isNaN(yearTo)) return { error: "سال تولید خودرو باید بین ۱۹۵۰ تا ۲۱۰۰ باشد." };
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) return { error: "سال شروع سازگاری نمی‌تواند بعد از سال پایان باشد." };
    const key = [make, model, engine, yearFrom, yearTo].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fitments.push({ make, model, engine, yearFrom, yearTo });
  }

  return {
    values: {
      sku,
      oemNumbers,
      brand: text(body.brand, 80),
      quality,
      countryOfOrigin: text(body.countryOfOrigin, 60),
      warrantyMonths: warrantyMonths ?? 0,
      fitments,
    },
  };
};

// Wholesale terms for a product. `price` is the validated retail price.
export const normalizeWholesaleTerms = (body = {}, price) => {
  const wholesalePrice = optionalWholeNumber(body.wholesalePrice, { min: 0, max: Number.MAX_SAFE_INTEGER });
  if (Number.isNaN(wholesalePrice)) return { error: "قیمت عمده باید مبلغ صحیح و بدون اعشار به تومان باشد." };
  if (wholesalePrice !== null && Number.isSafeInteger(price) && wholesalePrice > price) {
    return { error: "قیمت عمده نمی‌تواند بیشتر از قیمت خرده‌فروشی باشد." };
  }
  const wholesaleMinQuantity = optionalWholeNumber(body.wholesaleMinQuantity, { min: 1, max: 1000 });
  if (Number.isNaN(wholesaleMinQuantity)) return { error: "حداقل تعداد خرید عمده باید بین ۱ تا ۱۰۰۰ باشد." };
  return { values: { wholesalePrice, wholesaleMinQuantity: wholesaleMinQuantity ?? 1 } };
};

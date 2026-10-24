// Automotive-part form helpers shared by the admin create/edit product forms.
// The server validates everything again (backend/lib/part-fields.js).

export const PART_QUALITY_OPTIONS = [
  ["", "نامشخص"],
  ["genuine", "اصلی (جنیون)"],
  ["oem", "OEM / شرکتی"],
  ["aftermarket", "یدکی تجاری (Aftermarket)"],
  ["used", "استوک"],
];

export const CHINESE_CAR_MAKES = [
  "چری", "ام‌وی‌ام", "جک", "هاوال", "گریت وال", "جیلی", "بی‌وای‌دی", "لیفان",
  "برلیانس", "دانگ‌فنگ", "چانگان", "فاو", "کی‌ام‌سی", "دیگنیتی", "فونیکس",
];

export const emptyFitment = () => ({ make: "", model: "", yearFrom: "", yearTo: "", engine: "" });

export const emptyPartFields = () => ({
  sku: "", oemNumbersText: "", brand: "", quality: "", countryOfOrigin: "", warrantyMonths: "0",
  wholesalePrice: "", wholesaleMinQuantity: "1", fitments: [],
});

export const partFieldsFromProduct = (product = {}) => ({
  sku: product.sku || "",
  oemNumbersText: (product.oemNumbers || []).join(", "),
  brand: product.brand || "",
  quality: product.quality || "",
  countryOfOrigin: product.countryOfOrigin || "",
  warrantyMonths: String(product.warrantyMonths ?? 0),
  wholesalePrice: product.wholesalePrice === null || product.wholesalePrice === undefined ? "" : String(product.wholesalePrice),
  wholesaleMinQuantity: String(product.wholesaleMinQuantity ?? 1),
  fitments: (product.fitments || []).map((item) => ({
    make: item.make || "", model: item.model || "", engine: item.engine || "",
    yearFrom: item.yearFrom === null || item.yearFrom === undefined ? "" : String(item.yearFrom),
    yearTo: item.yearTo === null || item.yearTo === undefined ? "" : String(item.yearTo),
  })),
});

// Client-side checks with Persian messages; returns "" when the input is acceptable.
export const partFieldsError = (value, retailPrice) => {
  if (value.wholesalePrice !== "") {
    const wholesale = Number(value.wholesalePrice);
    if (!Number.isSafeInteger(wholesale) || wholesale < 0) return "قیمت عمده باید عدد صحیح و نامنفی به تومان باشد.";
    if (Number.isSafeInteger(Number(retailPrice)) && wholesale > Number(retailPrice)) return "قیمت عمده نمی‌تواند بیشتر از قیمت خرده‌فروشی باشد.";
  }
  const minQuantity = Number(value.wholesaleMinQuantity || 1);
  if (!Number.isInteger(minQuantity) || minQuantity < 1 || minQuantity > 1000) return "حداقل تعداد خرید عمده باید بین ۱ تا ۱۰۰۰ باشد.";
  const warranty = Number(value.warrantyMonths || 0);
  if (!Number.isInteger(warranty) || warranty < 0 || warranty > 120) return "مدت گارانتی باید بین ۰ تا ۱۲۰ ماه باشد.";
  const rows = value.fitments.filter((row) => Object.values(row).some((entry) => String(entry).trim()));
  if (rows.some((row) => !row.make.trim())) return "برند خودرو برای هر ردیف سازگاری الزامی است.";
  if (rows.some((row) => row.yearFrom && row.yearTo && Number(row.yearFrom) > Number(row.yearTo))) return "سال شروع سازگاری نمی‌تواند بعد از سال پایان باشد.";
  return "";
};

export const partFieldsPayload = (value) => ({
  sku: value.sku.trim(),
  oemNumbers: value.oemNumbersText.split(/[,،\n]+/).map((entry) => entry.trim()).filter(Boolean),
  brand: value.brand.trim(),
  quality: value.quality,
  countryOfOrigin: value.countryOfOrigin.trim(),
  warrantyMonths: value.warrantyMonths === "" ? 0 : Number(value.warrantyMonths),
  wholesalePrice: value.wholesalePrice === "" ? null : Number(value.wholesalePrice),
  wholesaleMinQuantity: value.wholesaleMinQuantity === "" ? 1 : Number(value.wholesaleMinQuantity),
  fitments: value.fitments
    .filter((row) => Object.values(row).some((entry) => String(entry).trim()))
    .map((row) => ({
      make: row.make.trim(), model: row.model.trim(), engine: row.engine.trim(),
      yearFrom: row.yearFrom === "" ? null : Number(row.yearFrom),
      yearTo: row.yearTo === "" ? null : Number(row.yearTo),
    })),
});


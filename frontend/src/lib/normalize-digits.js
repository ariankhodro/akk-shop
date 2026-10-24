// Single source of truth for converting Persian (۰-۹) and Arabic-Indic (٠-٩)
// digits, plus NFKC-compatible forms such as full-width digits, to ASCII.
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export const normalizeDigits = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));

export const toLatinDigits = normalizeDigits;

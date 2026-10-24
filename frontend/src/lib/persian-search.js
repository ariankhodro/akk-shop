const persianDigitMap = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigitMap = "٠١٢٣٤٥٦٧٨٩";

export const normalizeDigits = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[۰-۹]/g, (digit) => String(persianDigitMap.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabicDigitMap.indexOf(digit)));

export const normalizePersianText = (value) =>
  normalizeDigits(value)
    .toLocaleLowerCase("fa-IR")
    .replace(/[يىئ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[ؤ]/g, "و")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/\u0640|[\u064B-\u065F]|\u0670/g, "")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/[\u200C\u200D]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

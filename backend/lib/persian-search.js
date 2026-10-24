const persianDigitMap = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigitMap = "٠١٢٣٤٥٦٧٨٩";

const categoryAliases = {
  jeans: "شلوار جین",
  "t-shirts": "تی شرت",
  shoes: "کفش",
  glasses: "عینک",
  jackets: "کت و کاپشن",
  suits: "کت و شلوار",
  bags: "کیف",
};

export const normalizePersianText = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[۰-۹]/g, (digit) => String(persianDigitMap.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabicDigitMap.indexOf(digit)))
    .toLocaleLowerCase("fa-IR")
    .replace(/[يىئ]/g, (char) => char === "ئ" ? "ی" : "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[ؤ]/g, "و")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/[\u200C\u200D]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

export const escapeSearchRegex = (value) =>
  String(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");

export const buildNormalizedProductSearchText = (product) => {
  const category = String(product?.category ?? "");
  const attributeEntries = product?.attributes instanceof Map
    ? [...product.attributes.entries()]
    : Object.entries(product?.attributes && typeof product.attributes === "object" ? product.attributes : {});
  const attributeText = attributeEntries.flatMap(([key, value]) => [key, ...(Array.isArray(value) ? value : [value])])
    .filter((value) => value !== null && value !== undefined && typeof value !== "object");
  const options = [
    ...(Array.isArray(product?.sizes) ? product.sizes : []),
    ...(Array.isArray(product?.colors) ? product.colors.map((item) => item?.name) : []),
    ...(Array.isArray(product?.variants) ? product.variants.flatMap((item) => [item?.size, item?.color]) : []),
    product?.fit?.type,
    ...attributeText,
  ];
  return normalizePersianText([
    product?.name,
    product?.description,
    category,
    categoryAliases[category] || "",
    ...options,
  ].filter(Boolean).join(" "));
};

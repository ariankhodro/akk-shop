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

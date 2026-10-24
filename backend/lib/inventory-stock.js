const parseKnownQuantity = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

export const getKnownProductStock = (product) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length === 0) return parseKnownQuantity(product?.stock);
  const quantities = variants.map((variant) => parseKnownQuantity(variant?.stock));
  if (quantities.some((quantity) => quantity === null)) return null;
  return quantities.reduce((total, quantity) => total + quantity, 0);
};

// Null, missing, negative, fractional, and unsafe quantities are not unlimited stock.
// Unlimited inventory is not currently an explicit product policy, so checkout must fail
// closed unless the product (or every sellable variant) has an authoritative quantity.
export const hasConfiguredInventory = (product) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length > 0) return variants.every((variant) => parseKnownQuantity(variant?.stock) !== null);
  return parseKnownQuantity(product?.stock) !== null;
};

export const hasKnownFiniteStock = (product) => parseKnownQuantity(product?.stock) !== null;

// Admin stock edits are deltas against the live value, not absolute overwrites, so units
// reserved by customers between the admin's read and write are preserved (BIZ-5).
// `baseline` is the value the admin saw; without a known baseline the submitted value wins.
export const applyStockDelta = (liveValue, baseline, submitted) => {
  if (!Number.isSafeInteger(liveValue) || !Number.isSafeInteger(baseline)) return submitted;
  return liveValue + (submitted - baseline);
};

export const stockConflictError = (code) => Object.assign(new Error(code), { code });

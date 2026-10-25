// Single source of truth for what a signed-in (or anonymous) viewer pays.
//
// Rules:
//  * Retail viewers (anonymous, retail accounts, administrators shopping) pay
//    `price`.
//  * Active wholesale accounts pay the product's wholesale price when the order
//    line quantity reaches `wholesaleMinQuantity`; below that they pay retail.
//    Products without a wholesale price use the retail price as the base.
//  * The account's personal discount (0-50%) is applied on top of the base.
//  * The result is a whole Toman amount and never exceeds the retail price.
//
// Wholesale prices are `select: false` in the schema, so every public query
// omits them by default; only code that has confirmed a wholesale viewer loads
// them through WHOLESALE_FIELDS.

export const WHOLESALE_FIELDS = "+wholesalePrice +wholesaleMinQuantity";
export const RETAIL_MAX_LINE_QUANTITY = 100;
export const WHOLESALE_MAX_LINE_QUANTITY = 1000;

export const isWholesaleViewer = (user) =>
  Boolean(user) && user.accountType === "wholesale" && user.isActive !== false && user.role !== "admin";

export const maxLineQuantityFor = (user) =>
  isWholesaleViewer(user) ? WHOLESALE_MAX_LINE_QUANTITY : RETAIL_MAX_LINE_QUANTITY;

export const customerDiscountPercent = (user) => {
  const value = Number(user?.wholesaleProfile?.discountPercent);
  return Number.isFinite(value) && value > 0 ? Math.min(50, value) : 0;
};

const validAmount = (value) => Number.isSafeInteger(value) && value >= 0;

export const wholesaleMinQuantityOf = (product) => {
  const value = Number(product?.wholesaleMinQuantity);
  return Number.isInteger(value) && value >= 1 ? value : 1;
};

// The wholesale unit price for a viewer, ignoring the quantity threshold.
// Returns null when the viewer is not a wholesale customer.
export const wholesaleUnitPrice = (product, user) => {
  if (!isWholesaleViewer(user) || !validAmount(product?.price)) return null;
  const base = validAmount(product.wholesalePrice) ? Math.min(product.wholesalePrice, product.price) : product.price;
  const discount = customerDiscountPercent(user);
  const discounted = discount ? Math.round((base * (100 - discount)) / 100) : base;
  return Math.max(0, Math.min(product.price, discounted));
};

// What one unit costs on an order line of `quantity` units.
export const unitPriceFor = (product, user, quantity = 1) => {
  const wholesale = wholesaleUnitPrice(product, user);
  if (wholesale === null) return product.price;
  return quantity >= wholesaleMinQuantityOf(product) ? wholesale : product.price;
};

// Strip confidential fields from a product document that may have been loaded
// with WHOLESALE_FIELDS.
export const stripWholesaleFields = (product) => {
  if (!product || typeof product !== "object") return product;
  const { wholesalePrice: _price, wholesaleMinQuantity: _min, ...rest } = product;
  return rest;
};

// Shape a public product for the viewer. Retail viewers get the stored object
// minus confidential fields. Wholesale viewers additionally get
// `wholesaleUnitPrice` and `wholesaleMinQuantity` (their own prices only;
// the raw catalogue wholesale price and other customers' discounts never leave
// the server).
export const presentProductForViewer = (product, user, wholesaleSource = product) => {
  const base = stripWholesaleFields(product);
  if (!isWholesaleViewer(user) || !base) return base;
  const unit = wholesaleUnitPrice({ ...base, wholesalePrice: wholesaleSource?.wholesalePrice }, user);
  if (unit === null) return base;
  return {
    ...base,
    pricingTier: "wholesale",
    wholesaleUnitPrice: unit,
    wholesaleMinQuantity: wholesaleMinQuantityOf(wholesaleSource),
  };
};

// Decorate a list of public products for the viewer, loading wholesale fields
// in one query when (and only when) the viewer is a wholesale customer.
export const presentProductsForViewer = async (products, user, ProductModel) => {
  const list = Array.isArray(products) ? products : [];
  if (!isWholesaleViewer(user) || !list.length) return list.map((product) => stripWholesaleFields(product));
  const ids = list.map((product) => product?._id).filter(Boolean);
  const rows = await ProductModel.find({ _id: { $in: ids } }).select("_id " + WHOLESALE_FIELDS).lean();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  return list.map((product) => presentProductForViewer(product, user, byId.get(String(product?._id)) || {}));
};

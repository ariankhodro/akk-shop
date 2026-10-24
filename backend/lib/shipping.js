import StoreSettings from "../models/store-settings.model.js";

export const getShippingSettings = async ({ session } = {}) => {
  let query = StoreSettings.findOne({ key: "default" });
  if (session) query = query.session(session);
  const saved = await query.lean();
  return {
    flatRate: Number(saved?.flatRate ?? process.env.DEFAULT_SHIPPING_FEE ?? 0),
    freeShippingThreshold: Number(saved?.freeShippingThreshold ?? process.env.FREE_SHIPPING_THRESHOLD ?? 0),
  };
};

export const calculateShippingFee = (subtotal, settings) => {
  const threshold = Number(settings.freeShippingThreshold || 0);
  if (threshold > 0 && subtotal >= threshold) return 0;
  return Math.max(0, Number(settings.flatRate || 0));
};

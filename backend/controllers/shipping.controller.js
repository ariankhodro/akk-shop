import StoreSettings from "../models/store-settings.model.js";
import { calculateShippingFee, getShippingSettings } from "../lib/shipping.js";
import { recordAuditEvent } from "../lib/audit-log.js";

const getCurrency = () => "IRT";

export const getShippingQuote = async (req, res) => {
  const subtotal = Number(req.query.subtotal ?? 0);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return res.status(400).json({ message: "Subtotal must be a non-negative number" });
  }
  try {
    const settings = await getShippingSettings();
    return res.json({
      ...settings,
      currency: getCurrency(),
      shippingFee: calculateShippingFee(subtotal, settings),
    });
  } catch (error) {
    console.error("Error calculating shipping", error.message);
    return res.status(500).json({ message: "Unable to calculate shipping" });
  }
};

export const updateShippingSettings = async (req, res) => {
  const flatRate = Number(req.body.flatRate);
  const freeShippingThreshold = Number(req.body.freeShippingThreshold);
  const currency = getCurrency();
  if (!Number.isFinite(flatRate) || flatRate < 0 ||
      !Number.isFinite(freeShippingThreshold) || freeShippingThreshold < 0) {
    return res.status(400).json({ message: "Shipping values must be non-negative numbers" });
  }
  if (!Number.isSafeInteger(flatRate) || !Number.isSafeInteger(freeShippingThreshold)) {
    return res.status(400).json({ message: "Shipping amounts must be whole-number Toman values." });
  }
  try {
    const previousSettings = await getShippingSettings();
    const settings = await StoreSettings.findOneAndUpdate(
      { key: "default" },
      { $set: { flatRate, freeShippingThreshold, updatedBy: req.user._id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    await recordAuditEvent(req, {
      action: "shipping.settings_updated",
      targetType: "store_settings",
      targetId: settings?._id,
      summary: "Shipping fee settings updated",
      metadata: {
        before: {
          flatRate: previousSettings.flatRate,
          freeShippingThreshold: previousSettings.freeShippingThreshold,
          currency,
        },
        after: { flatRate, freeShippingThreshold, currency },
        changes: {
          flatRate: { before: previousSettings.flatRate, after: flatRate },
          freeShippingThreshold: { before: previousSettings.freeShippingThreshold, after: freeShippingThreshold },
        },
      },
    });
    return res.json({ ...settings, currency: getCurrency() });
  } catch (error) {
    console.error("Error updating shipping settings", error.message);
    return res.status(500).json({ message: "Unable to update shipping settings" });
  }
};

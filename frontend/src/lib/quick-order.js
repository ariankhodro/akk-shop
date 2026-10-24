import { normalizeDigits } from "./normalize-digits.js";

export const QUICK_ORDER_MAX_LINES = 50;

// Same rule as backend/lib/persian-search.js compactPartNumber: separators are ignored.
export const compactPartNumber = (value) => normalizeDigits(value).toLowerCase().replace(/[^a-z0-9]/g, "");

// "T11-3501080 12" / "T11-3501080, 12" / "T11-3501080\t12" -> [{ code, key, quantity }]
// Lines naming the same part (with or without separators) are merged.
export const parseQuickOrder = (text) => {
  const lines = String(text || "").split(/\r?\n/).map((line) => normalizeDigits(line).trim()).filter(Boolean);
  const merged = new Map();
  for (const line of lines.slice(0, QUICK_ORDER_MAX_LINES)) {
    const match = /^(.+?)(?:[\s,،;\t]+(\d{1,4}))?$/.exec(line);
    if (!match) continue;
    const code = match[1].replace(/[,،;]+$/, "").trim().toUpperCase();
    const key = compactPartNumber(code);
    if (key.length < 3) continue;
    const quantity = match[2] ? Math.max(1, Number(match[2])) : 1;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: existing.quantity + quantity } : { code, key, quantity });
  }
  return [...merged.values()];
};

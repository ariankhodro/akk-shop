import { create } from "zustand";
import toast from "react-hot-toast";

const STORAGE_KEY = "miba-saved-products";

const readSavedProducts = () => {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((product) => product && typeof product._id === "string")
      : [];
  } catch {
    return [];
  }
};

const persistSavedProducts = (items) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    toast.error("ذخیره علاقه‌مندی‌ها در این مرورگر امکان‌پذیر نیست");
  }
};

export const useWishlistStore = create((set, get) => ({
  items: readSavedProducts(),

  isSaved: (productId) => get().items.some((product) => product._id === productId),

  toggleSaved: (product) => {
    if (!product || typeof product._id !== "string") return false;
    const wasSaved = get().items.some((item) => item._id === product._id);
    const items = wasSaved
      ? get().items.filter((item) => item._id !== product._id)
      : [product, ...get().items];

    persistSavedProducts(items);
    set({ items });
    toast.success(wasSaved ? "از علاقه‌مندی‌ها حذف شد" : "به علاقه‌مندی‌ها اضافه شد");
    return !wasSaved;
  },

  removeSaved: (productId) => {
    const items = get().items.filter((product) => product._id !== productId);
    persistSavedProducts(items);
    set({ items });
  },

  clearSaved: () => {
    persistSavedProducts([]);
    set({ items: [] });
  },
}));

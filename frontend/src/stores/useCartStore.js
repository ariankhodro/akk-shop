import { create } from "zustand";
import axios from "../lib/axios";
import { toast } from "react-hot-toast";

const GUEST_CART_KEY = "tik-boutique-guest-cart";
const getErrorMessage = (error, fallback = "خطایی رخ داد") =>
  error.response?.data?.message || error.message || fallback;

export const cartItemKey = (item) => item.cartItemId ||
  String(item._id || "") + "::" + encodeURIComponent(item.selectedSize || item.size || "") +
  "::" + encodeURIComponent(item.selectedColor || item.color || "");

const readGuestCart = () => {
  try {
    const raw = window.localStorage.getItem(GUEST_CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item._id === "string" && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)
      .map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        selectedSize: item.selectedSize || item.size || "",
        selectedColor: item.selectedColor || item.color || "",
        guestOnly: Boolean(item.guestOnly),
        cartItemId: cartItemKey(item),
      }));
  } catch {
    return [];
  }
};

const writeGuestCart = (items) => {
  try {
    if (!items.length) window.localStorage.removeItem(GUEST_CART_KEY);
    else window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items.map((item) => ({
      ...item,
      selectedSize: item.selectedSize || "",
      selectedColor: item.selectedColor || "",
      cartItemId: cartItemKey(item),
    }))));
  } catch {
    toast.error("ذخیره سبد خرید در این مرورگر امکان‌پذیر نیست");
  }
};

const findVariant = (product, size, color) => (product.variants || []).find((variant) =>
  (variant.size || "") === (size || "") && (variant.color || "") === (color || "")
);

const stockFor = (item) => {
  const variant = findVariant(item, item.selectedSize || "", item.selectedColor || "");
  return variant ? variant.stock : item.stock;
};

const mergeCartLines = (cart, incomingItem) => {
  const incomingKey = cartItemKey(incomingItem);
  const existing = cart.find((item) => cartItemKey(item) === incomingKey);
  if (!existing) return [...cart, incomingItem];
  return cart.map((item) => cartItemKey(item) === incomingKey
    ? { ...item, quantity: item.quantity + incomingItem.quantity }
    : item);
};

const totalsFor = (cart, coupon) => {
  const subtotal = (Array.isArray(cart) ? cart : []).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0
  );
  const meetsMinimum = coupon && subtotal >= Number(coupon.minOrderAmount || 0);
  const rawDiscount = meetsMinimum ? Math.round(subtotal * Number(coupon.discountPercentage || 0) / 100) : 0;
  const maximumDiscount = coupon?.maxDiscountAmount == null ? Number.MAX_SAFE_INTEGER : Number(coupon.maxDiscountAmount);
  const discountAmount = Math.min(Math.max(0, rawDiscount), Number.isSafeInteger(maximumDiscount) ? maximumDiscount : Number.MAX_SAFE_INTEGER, subtotal);
  const total = Math.max(0, subtotal - discountAmount);
  return { subtotal, total, discountAmount };
};

export const useCartStore = create((set, get) => ({
  cart: [],
  coupon: null,
  total: 0,
  subtotal: 0,
  isCouponApplied: false,
  authenticated: false,
  isMergingGuestCart: false,

  setAuthenticated: (authenticated) => set({ authenticated: Boolean(authenticated) }),

  initializeGuestCart: () => {
    if (get().authenticated) return;
    const cart = readGuestCart().map((item) => ({ ...item, guestOnly: false, cartItemId: cartItemKey(item) }));
    writeGuestCart(cart);
    set({ cart, coupon: null, isCouponApplied: false, isMergingGuestCart: false, ...totalsFor(cart, null) });
  },

  applyCoupon: async (code) => {
    if (!get().authenticated) {
      toast.error("برای استفاده از کد تخفیف، هنگام ادامه خرید وارد حساب شوید");
      return;
    }
    try {
      const response = await axios.post("/coupons/validate", { code });
      set({ coupon: response.data, isCouponApplied: true });
      get().calculateTotals();
      toast.success("کد تخفیف با موفقیت اعمال شد");
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, "اعمال کد تخفیف ناموفق بود"));
      return false;
    }
  },

  removeCoupon: () => {
    set({ coupon: null, isCouponApplied: false });
    get().calculateTotals();
    toast.success("کد تخفیف حذف شد");
  },

  getCartItems: async () => {
    if (!get().authenticated) {
      get().initializeGuestCart();
      return;
    }
    try {
      const response = await axios.get("/cart");
      if (!Array.isArray(response.data)) throw new Error("پاسخ سبد خرید نامعتبر است");
      const cart = response.data.map((item) => ({
        ...item,
        selectedSize: item.selectedSize || "",
        selectedColor: item.selectedColor || "",
        cartItemId: cartItemKey(item),
      }));
      set({ cart, ...totalsFor(cart, get().coupon) });
    } catch (error) {
      console.error("دریافت سبد خرید ناموفق بود:", error);
      toast.error(getErrorMessage(error, "دریافت سبد خرید ناموفق بود"));
    }
  },

  mergeGuestCart: async () => {
    if (!get().authenticated) {
      get().initializeGuestCart();
      return;
    }
    if (get().isMergingGuestCart) return;
    set({ isMergingGuestCart: true });
    const guestItems = readGuestCart().filter((item) => !item.guestOnly);
    try {
      let skippedItems = readGuestCart().filter((item) => item.guestOnly);
      if (guestItems.length) {
        const response = await axios.post("/cart/merge", {
          items: guestItems.map((item) => ({
            productId: item._id,
            quantity: item.quantity,
            size: item.selectedSize || "",
            color: item.selectedColor || "",
          })),
        });
        const skippedKeys = new Set(response.data.skippedKeys || []);
        skippedItems = [
          ...skippedItems,
          ...guestItems.filter((item) => skippedKeys.has(cartItemKey(item))).map((item) => ({ ...item, guestOnly: true })),
        ];
        writeGuestCart(skippedItems);
        if (skippedItems.length) {
          toast.error("بعضی گزینه‌ها موجودی کافی ندارند؛ آن‌ها را در سبد بررسی کنید.");
        } else if (guestItems.length) {
          toast.success("سبد خرید مهمان با حساب شما ادغام شد");
        }
      }

      const response = await axios.get("/cart");
      if (!Array.isArray(response.data)) throw new Error("پاسخ سبد خرید نامعتبر است");
      const accountCart = response.data.map((item) => ({
        ...item,
        selectedSize: item.selectedSize || "",
        selectedColor: item.selectedColor || "",
        cartItemId: cartItemKey(item),
      }));
      const cart = skippedItems.reduce((current, item) => mergeCartLines(current, item), accountCart);
      set({ cart, isMergingGuestCart: false, ...totalsFor(cart, get().coupon) });
    } catch (error) {
      console.error("ادغام سبد خرید مهمان ناموفق بود:", error);
      const remainingGuestItems = readGuestCart().map((item) => ({ ...item, guestOnly: true }));
      try {
        const response = await axios.get("/cart");
        const accountCart = Array.isArray(response.data) ? response.data.map((item) => ({
          ...item, selectedSize: item.selectedSize || "", selectedColor: item.selectedColor || "", cartItemId: cartItemKey(item),
        })) : [];
        const cart = remainingGuestItems.reduce((current, item) => mergeCartLines(current, item), accountCart);
        set({ cart, isMergingGuestCart: false, ...totalsFor(cart, get().coupon) });
      } catch {
        set({ cart: remainingGuestItems, isMergingGuestCart: false, ...totalsFor(remainingGuestItems, get().coupon) });
      }
      toast.error("سبد خرید مهمان هنوز کامل ادغام نشده است؛ گزینه‌های آن حفظ شده‌اند.");
    }
  },

  clearCart: async () => {
    writeGuestCart([]);
    set({ cart: [], coupon: null, total: 0, subtotal: 0, isCouponApplied: false });
  },

  addToCart: async (product, selection = {}) => {
    const size = selection.size || "";
    const color = selection.color || "";
    const key = cartItemKey({ _id: product._id, selectedSize: size, selectedColor: color });
    const state = get();
    const existing = state.cart.find((item) => cartItemKey(item) === key);
    const nextQuantity = Number(existing?.quantity || 0) + 1;
    const variant = findVariant(product, size, color);
    const trackedStock = variant ? variant.stock : product.stock;
    if (Array.isArray(product.variants) && product.variants.length && !variant) {
      toast.error("لطفاً سایز و رنگ معتبر محصول را انتخاب کنید");
      return false;
    }
    if (typeof trackedStock === "number" && nextQuantity > trackedStock) {
      toast.error(trackedStock === 0 ? "این گزینه موجود نیست" : "تعداد درخواستی بیشتر از موجودی این گزینه است");
      return false;
    }

    if (state.authenticated && !existing?.guestOnly) {
      try {
        await axios.post("/cart", { productId: product._id, size, color });
        const item = {
          ...product, selectedSize: size, selectedColor: color,
          cartItemId: key, quantity: 1,
        };
        const cart = mergeCartLines(get().cart.filter((line) => !line.guestOnly), item);
        const guestOnly = get().cart.filter((line) => line.guestOnly);
        const nextCart = [...cart, ...guestOnly];
        set({ cart: nextCart, ...totalsFor(nextCart, get().coupon) });
        toast.success("محصول به سبد خرید اضافه شد");
        return true;
      } catch (error) {
        toast.error(getErrorMessage(error));
        return false;
      }
    }

    const item = {
      ...product, selectedSize: size, selectedColor: color,
      cartItemId: key, quantity: 1, ...(state.authenticated ? { guestOnly: true } : {}),
    };
    const cart = mergeCartLines(state.cart, item);
    if (!state.authenticated) writeGuestCart(cart);
    else writeGuestCart(cart.filter((line) => line.guestOnly));
    set({ cart, ...totalsFor(cart, get().coupon) });
    toast.success("محصول به سبد خرید اضافه شد");
    return true;
  },

  removeFromCart: async (itemOrId) => {
    const isItem = itemOrId && typeof itemOrId === "object";
    const productId = isItem ? itemOrId._id : itemOrId;
    const key = isItem ? cartItemKey(itemOrId) : "";
    const state = get();
    const removeLocal = !state.authenticated || itemOrId?.guestOnly;
    if (removeLocal) {
      const cart = state.cart.filter((item) => isItem ? cartItemKey(item) !== key : item._id !== productId);
      if (!state.authenticated) writeGuestCart(cart);
      else writeGuestCart(cart.filter((item) => item.guestOnly));
      set({ cart, ...totalsFor(cart, state.coupon) });
      return;
    }
    const size = itemOrId.selectedSize || "";
    const color = itemOrId.selectedColor || "";
    try {
      await axios.delete("/cart", { data: { productId, size, color } });
      const cart = state.cart.filter((item) => cartItemKey(item) !== key);
      writeGuestCart(cart.filter((item) => item.guestOnly));
      set({ cart, ...totalsFor(cart, get().coupon) });
    } catch (error) {
      toast.error(getErrorMessage(error, "حذف کالا ناموفق بود"));
    }
  },

  updateQuantity: async (itemOrId, quantity) => {
    const isItem = itemOrId && typeof itemOrId === "object";
    const productId = isItem ? itemOrId._id : itemOrId;
    const state = get();
    const existingItem = isItem ? itemOrId : state.cart.find((item) => item._id === productId);
    if (!existingItem) return;
    if (quantity === 0) {
      await get().removeFromCart(existingItem);
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      toast.error("تعداد باید بین ۱ تا ۱۰۰ باشد");
      return;
    }
    const trackedStock = stockFor(existingItem);
    if (typeof trackedStock === "number" && quantity > trackedStock) {
      toast.error("تعداد درخواستی بیشتر از موجودی این گزینه است");
      return;
    }

    if (!state.authenticated || existingItem.guestOnly) {
      const cart = state.cart.map((item) => cartItemKey(item) === cartItemKey(existingItem) ? { ...item, quantity } : item);
      if (!state.authenticated) writeGuestCart(cart);
      else writeGuestCart(cart.filter((item) => item.guestOnly));
      set({ cart, ...totalsFor(cart, state.coupon) });
      return;
    }

    try {
      await axios.put("/cart/" + productId, {
        quantity, size: existingItem.selectedSize || "", color: existingItem.selectedColor || "",
      });
      const cart = state.cart.map((item) => cartItemKey(item) === cartItemKey(existingItem) ? { ...item, quantity } : item);
      writeGuestCart(cart.filter((item) => item.guestOnly));
      set({ cart, ...totalsFor(cart, get().coupon) });
    } catch (error) {
      toast.error(getErrorMessage(error, "به‌روزرسانی تعداد ناموفق بود"));
    }
  },

  calculateTotals: () => {
    const { cart, coupon } = get();
    set(totalsFor(Array.isArray(cart) ? cart : [], coupon));
  },
}));

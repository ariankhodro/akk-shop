import Product from "../models/product.model.js";

const getCartProductId = (item) => item.product?.toString() || item._id?.toString();
const normalizedOption = (value) => typeof value === "string" ? value.trim() : "";
const sameVariant = (item, size, color) =>
  normalizedOption(item.size) === size && normalizedOption(item.color) === color;
const variantFor = (product, size, color) =>
  (product.variants || []).find((variant) => normalizedOption(variant.size) === size && normalizedOption(variant.color) === color);
const isStockTracked = (product) => typeof product.stock === "number" && Number.isFinite(product.stock);
const cartItemKey = (id, size, color) =>
  id + "::" + encodeURIComponent(size) + "::" + encodeURIComponent(color);

export const getCartProducts = async (req, res) => {
  try {
    const cartItems = req.user.cartItems || [];
    const productIds = cartItems.map(getCartProductId).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds }, isActive: { $ne: false } }).lean();
    const productsById = new Map(products.map((product) => [product._id.toString(), product]));
    return res.json(cartItems.map((item) => {
      const id = getCartProductId(item);
      const product = id && productsById.get(id);
      if (!product) return null;
      const size = normalizedOption(item.size);
      const color = normalizedOption(item.color);
      const selectedVariant = (product.variants || []).length ? variantFor(product, size, color) : null;
      return {
        ...product,
        quantity: item.quantity,
        selectedSize: size,
        selectedColor: color,
        cartItemId: cartItemKey(id, size, color),
        ...(selectedVariant ? { selectedVariantStock: selectedVariant.stock } : {}),
      };
    }).filter(Boolean));
  } catch (error) {
    console.error("Error in getCartProducts controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const mergeGuestCart = async (req, res) => {
  try {
    const inputItems = Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : [];
    if (!inputItems.length) return res.json({ mergedCount: 0, skippedKeys: [] });

    const normalizedItems = inputItems.map((item) => ({
      productId: typeof item?.productId === "string" ? item.productId : "",
      size: normalizedOption(item?.size),
      color: normalizedOption(item?.color),
      quantity: Number(item?.quantity),
    }));
    const productIds = [...new Set(normalizedItems.map((item) => item.productId).filter(Boolean))];
    const products = await Product.find({ _id: { $in: productIds }, isActive: { $ne: false } }).lean();
    const productsById = new Map(products.map((product) => [product._id.toString(), product]));
    const skippedKeys = [];
    const accepted = [];
    const pendingQuantity = new Map();

    for (const item of normalizedItems) {
      const product = productsById.get(item.productId);
      const key = cartItemKey(item.productId, item.size, item.color);
      if (!product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        skippedKeys.push(key);
        continue;
      }
      const hasVariants = (product.variants || []).length > 0;
      const selectedVariant = hasVariants ? variantFor(product, item.size, item.color) : null;
      if ((hasVariants && !selectedVariant) || (!hasVariants && (item.size || item.color))) {
        skippedKeys.push(key);
        continue;
      }

      const existingItem = req.user.cartItems.find((cartItem) =>
        getCartProductId(cartItem) === item.productId && sameVariant(cartItem, item.size, item.color)
      );
      const alreadyInCart = Number(existingItem?.quantity || 0) + Number(pendingQuantity.get(key) || 0);
      const stock = selectedVariant ? selectedVariant.stock : product.stock;
      if (alreadyInCart + item.quantity > 100 ||
          (typeof stock === "number" && alreadyInCart + item.quantity > stock)) {
        skippedKeys.push(key);
        continue;
      }

      accepted.push({ ...item, key, existingItem });
      pendingQuantity.set(key, Number(pendingQuantity.get(key) || 0) + item.quantity);
    }

    for (const item of accepted) {
      const existingItem = req.user.cartItems.find((cartItem) =>
        getCartProductId(cartItem) === item.productId && sameVariant(cartItem, item.size, item.color)
      );
      if (existingItem) existingItem.quantity += item.quantity;
      else req.user.cartItems.push({
        product: item.productId,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
      });
    }
    if (accepted.length) await req.user.save();

    return res.json({ mergedCount: accepted.length, skippedKeys: [...new Set(skippedKeys)] });
  } catch (error) {
    console.error("Error merging guest cart", error.message);
    return res.status(500).json({ message: "Unable to merge guest cart" });
  }
};

export const addToCart = async (req, res) => {
  try {
    const { productId } = req.body;
    const size = normalizedOption(req.body.size);
    const color = normalizedOption(req.body.color);
    if (!productId || typeof productId !== "string") {
      return res.status(400).json({ message: "Product ID is required" });
    }
    const product = await Product.findOne({ _id: productId, isActive: { $ne: false } }).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });

    let selectedVariant = null;
    if ((product.variants || []).length) {
      selectedVariant = variantFor(product, size, color);
      if (!selectedVariant) return res.status(400).json({ message: "لطفاً سایز و رنگ معتبر محصول را انتخاب کنید" });
    } else if (size || color) {
      return res.status(400).json({ message: "این محصول گزینه سایز یا رنگ ندارد" });
    }

    const user = req.user;
    const existingItem = user.cartItems.find((item) =>
      getCartProductId(item) === productId && sameVariant(item, size, color)
    );
    const nextQuantity = (existingItem?.quantity || 0) + 1;
    const trackedStock = selectedVariant ? selectedVariant.stock : product.stock;
    if (nextQuantity > 100) {
      return res.status(409).json({ message: "تعداد هر گزینه نمی‌تواند بیشتر از ۱۰۰ عدد باشد" });
    }
    if (typeof trackedStock === "number" && nextQuantity > trackedStock) {
      return res.status(409).json({ message: trackedStock === 0 ? "این گزینه موجود نیست" : "تعداد درخواستی بیشتر از موجودی این گزینه است" });
    }

    if (existingItem) existingItem.quantity = nextQuantity;
    else user.cartItems.push({ product: productId, quantity: 1, size, color });
    await user.save();
    return res.json({ success: true, cartItems: user.cartItems });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid product ID" });
    console.error("Error in addToCart controller", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const removeAllFromCart = async (req, res) => {
  try {
    const { productId } = req.body;
    const user = req.user;
    if (!productId) {
      user.cartItems = [];
    } else {
      const hasVariantSelection = Object.prototype.hasOwnProperty.call(req.body, "size") ||
        Object.prototype.hasOwnProperty.call(req.body, "color");
      const size = normalizedOption(req.body.size);
      const color = normalizedOption(req.body.color);
      user.cartItems = user.cartItems.filter((item) => {
        if (getCartProductId(item) !== productId) return true;
        return hasVariantSelection && !sameVariant(item, size, color);
      });
    }
    await user.save();
    return res.json(user.cartItems);
  } catch (error) {
    console.error("Error removing cart items", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateQuantity = async (req, res) => {
  try {
    const { id: productId } = req.params;
    const quantity = Number(req.body.quantity);
    const size = normalizedOption(req.body.size);
    const color = normalizedOption(req.body.color);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100) {
      return res.status(400).json({ message: "Quantity must be an integer between 0 and 100" });
    }

    const user = req.user;
    const existingItem = user.cartItems.find((item) =>
      getCartProductId(item) === productId && sameVariant(item, size, color)
    );
    if (!existingItem) return res.status(404).json({ message: "Product variant not found in cart" });

    if (quantity > 0) {
      const product = await Product.findOne({ _id: productId, isActive: { $ne: false } }).lean();
      if (!product) return res.status(404).json({ message: "Product not found" });
      const selectedVariant = (product.variants || []).length ? variantFor(product, size, color) : null;
      if ((product.variants || []).length && !selectedVariant) {
        return res.status(409).json({ message: "گزینه انتخاب‌شده دیگر در دسترس نیست" });
      }
      const trackedStock = selectedVariant ? selectedVariant.stock : product.stock;
      if (typeof trackedStock === "number" && quantity > trackedStock) {
        return res.status(409).json({ message: "تعداد درخواستی بیشتر از موجودی این گزینه است" });
      }
    }

    if (quantity === 0) {
      user.cartItems = user.cartItems.filter((item) => !(getCartProductId(item) === productId && sameVariant(item, size, color)));
    } else {
      existingItem.quantity = quantity;
    }
    await user.save();
    return res.json(user.cartItems);
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "Invalid product ID" });
    console.error("Error updating cart quantity", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

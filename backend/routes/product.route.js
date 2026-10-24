import express from "express";
import {
  createProduct, deleteProduct, getAllProducts, getBestsellingProducts, getFeaturedProducts, getNewestProducts,
  getProductById, getProductsByCategory, getProductPriceBounds, getRecommendedProducts, getSearchedProducts,
  toggleFeaturedProduct, updateProduct, setProductActive, updateProductStock, updateProductVariantStock,
} from "../controllers/product.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

// Specific paths must be registered before /:id.
router.get("/price-bounds", getProductPriceBounds);
router.get("/search", getSearchedProducts);
router.get("/bestsellers", getBestsellingProducts);
router.get("/newest", getNewestProducts);
router.get("/featured", getFeaturedProducts);
router.get("/category/:category", getProductsByCategory);
router.get("/recommendations", getRecommendedProducts);
router.get("/", protectRoute, adminRoute, getAllProducts);
router.get("/:id", getProductById);
router.post("/", protectRoute, adminRoute, createProduct);
router.patch("/:id/stock", protectRoute, adminRoute, updateProductStock);
router.put("/:id", protectRoute, adminRoute, updateProduct);
router.patch("/:id/active", protectRoute, adminRoute, setProductActive);
router.patch("/:id/variant-stock", protectRoute, adminRoute, updateProductVariantStock);
router.patch("/:id", protectRoute, adminRoute, toggleFeaturedProduct);
router.delete("/:id", protectRoute, adminRoute, deleteProduct);

export default router;

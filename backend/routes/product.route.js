import express from "express";
import {
  createProduct, deleteProduct, getAllProducts, getBestsellingProducts, getFeaturedProducts, getNewestProducts,
  getProductById, getProductsByCategory, getProductPriceBounds, getRecommendedProducts, getSearchedProducts,
  toggleFeaturedProduct, updateProduct, setProductActive, updateProductStock, updateProductVariantStock,
  getVehicleCatalog, lookupPartNumbers,
} from "../controllers/product.controller.js";
import { adminRoute, optionalAuth, privateWhenPersonalised, protectRoute } from "../middleware/auth.middleware.js";
import { largeJsonBody } from "../middleware/body-parsers.middleware.js";

const router = express.Router();

// Specific paths must be registered before /:id.
// Public reads are priced for the viewer: wholesale customers see their own
// prices, everyone else sees retail. Personalised responses are never cached.
const viewer = [optionalAuth, privateWhenPersonalised];
router.get("/price-bounds", getProductPriceBounds);
router.get("/vehicles", getVehicleCatalog);
router.get("/lookup", ...viewer, lookupPartNumbers);
router.get("/search", ...viewer, getSearchedProducts);
router.get("/bestsellers", ...viewer, getBestsellingProducts);
router.get("/newest", ...viewer, getNewestProducts);
router.get("/featured", ...viewer, getFeaturedProducts);
router.get("/category/:category", ...viewer, getProductsByCategory);
router.get("/recommendations", ...viewer, getRecommendedProducts);
router.get("/", protectRoute, adminRoute, getAllProducts);
router.get("/:id", ...viewer, getProductById);
router.post("/", protectRoute, adminRoute, largeJsonBody, createProduct);
router.patch("/:id/stock", protectRoute, adminRoute, updateProductStock);
router.put("/:id", protectRoute, adminRoute, largeJsonBody, updateProduct);
router.patch("/:id/active", protectRoute, adminRoute, setProductActive);
router.patch("/:id/variant-stock", protectRoute, adminRoute, updateProductVariantStock);
router.patch("/:id", protectRoute, adminRoute, toggleFeaturedProduct);
router.delete("/:id", protectRoute, adminRoute, deleteProduct);

export default router;

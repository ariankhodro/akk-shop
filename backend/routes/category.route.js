import express from "express";
import {
  createCategory,
  deleteCategory,
  getAdminCategories,
  getCategoryBySlug,
  getPublicCategories,
  updateCategory,
} from "../controllers/category.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { largeJsonBody } from "../middleware/body-parsers.middleware.js";

const router = express.Router();

router.get("/", getPublicCategories);
router.get("/admin", protectRoute, adminRoute, getAdminCategories);
router.post("/", protectRoute, adminRoute, largeJsonBody, createCategory);
router.patch("/:id", protectRoute, adminRoute, largeJsonBody, updateCategory);
router.delete("/:id", protectRoute, adminRoute, deleteCategory);
router.get("/:slug", getCategoryBySlug);

export default router;

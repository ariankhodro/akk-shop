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

const router = express.Router();

router.get("/", getPublicCategories);
router.get("/admin", protectRoute, adminRoute, getAdminCategories);
router.post("/", protectRoute, adminRoute, createCategory);
router.patch("/:id", protectRoute, adminRoute, updateCategory);
router.delete("/:id", protectRoute, adminRoute, deleteCategory);
router.get("/:slug", getCategoryBySlug);

export default router;

import express from "express";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import {
  createCoupon,
  deleteCoupon,
  getAdminCoupons,
  updateCoupon,
  validateCoupon,
} from "../controllers/coupon.controller.js";

const router = express.Router();

router.get("/admin", protectRoute, adminRoute, getAdminCoupons);
router.post("/validate", protectRoute, validateCoupon);
router.post("/", protectRoute, adminRoute, createCoupon);
router.patch("/:id", protectRoute, adminRoute, updateCoupon);
router.delete("/:id", protectRoute, adminRoute, deleteCoupon);

export default router;

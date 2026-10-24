import express from "express";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { getShippingQuote, updateShippingSettings } from "../controllers/shipping.controller.js";

const router = express.Router();
router.get("/", getShippingQuote);
router.put("/", protectRoute, adminRoute, updateShippingSettings);
export default router;

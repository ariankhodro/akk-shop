import express from "express";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { getAdminOrders, getMyOrders, updateShipment } from "../controllers/order.controller.js";

const router = express.Router();
router.get("/mine", protectRoute, getMyOrders);
router.get("/admin", protectRoute, adminRoute, getAdminOrders);
router.patch("/:id/shipment", protectRoute, adminRoute, updateShipment);
export default router;

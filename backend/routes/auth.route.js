import express from "express";
import {
 login, logout, signup, refreshToken, getProfile, forgotPassword, resetPassword, saveDefaultAddress,
 updateProfile, createShippingAddress, updateShippingAddress, setDefaultShippingAddress, deleteShippingAddress,
} from "../controllers/auth.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { authRateLimit, refreshTokenRateLimit } from "../middleware/rate-limit.middleware.js";

const router = express.Router();
router.post("/signup", authRateLimit, signup);
router.post("/login", authRateLimit, login);
router.post("/forgot-password", authRateLimit, forgotPassword);
router.post("/reset-password", authRateLimit, resetPassword);
router.post("/logout", logout);
router.post("/refresh-token", refreshTokenRateLimit, refreshToken);
router.get("/profile", protectRoute, getProfile);
router.patch("/profile", protectRoute, updateProfile);
router.patch("/profile/default-address", protectRoute, saveDefaultAddress);
router.post("/profile/addresses", protectRoute, createShippingAddress);
router.patch("/profile/addresses/:addressId", protectRoute, updateShippingAddress);
router.patch("/profile/addresses/:addressId/default", protectRoute, setDefaultShippingAddress);
router.delete("/profile/addresses/:addressId", protectRoute, deleteShippingAddress);
export default router;

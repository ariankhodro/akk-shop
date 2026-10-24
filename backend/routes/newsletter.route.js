import express from "express";
import { getNewsletterSubscribers, subscribeToNewsletter, unsubscribeFromNewsletter } from "../controllers/newsletter.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { newsletterRateLimit } from "../middleware/rate-limit.middleware.js";

const router = express.Router();
router.get("/admin", protectRoute, adminRoute, getNewsletterSubscribers);
router.post("/subscribe", newsletterRateLimit, subscribeToNewsletter);
router.post("/unsubscribe", newsletterRateLimit, unsubscribeFromNewsletter);
export default router;

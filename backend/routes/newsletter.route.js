import express from "express";
import {
  confirmNewsletterSubscription,
  getNewsletterSubscribers,
  showNewsletterConfirmation,
  showNewsletterUnsubscribe,
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
} from "../controllers/newsletter.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { newsletterRateLimit } from "../middleware/rate-limit.middleware.js";

const router = express.Router();
router.get("/admin", protectRoute, adminRoute, getNewsletterSubscribers);
router.post("/subscribe", newsletterRateLimit, subscribeToNewsletter);
// Double opt-in: the emailed link opens a confirmation page (GET, no state
// change); the POST performs the change.
router.get("/confirm", newsletterRateLimit, showNewsletterConfirmation);
router.post("/confirm", newsletterRateLimit, confirmNewsletterSubscription);
router.get("/unsubscribe", newsletterRateLimit, showNewsletterUnsubscribe);
router.post("/unsubscribe", newsletterRateLimit, unsubscribeFromNewsletter);
export default router;

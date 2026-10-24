import express from "express";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { largeJsonBody } from "../middleware/body-parsers.middleware.js";
import { apiRateLimit } from "../middleware/rate-limit.middleware.js";
import {
  createCampaign,
  deleteCampaign,
  getActiveCampaigns,
  getAllCampaigns,
  getCampaignById,
  trackCampaignClick,
  trackCampaignView,
  updateCampaign,
} from "../controllers/campaign.controller.js";

const router = express.Router();
router.get("/", getActiveCampaigns);
router.get("/admin", protectRoute, adminRoute, getAllCampaigns);
router.get("/:id", getCampaignById);
router.post("/:id/click", apiRateLimit, trackCampaignClick);
router.post("/:id/view", apiRateLimit, trackCampaignView);
router.post("/", protectRoute, adminRoute, largeJsonBody, createCampaign);
router.patch("/:id", protectRoute, adminRoute, largeJsonBody, updateCampaign);
router.delete("/:id", protectRoute, adminRoute, deleteCampaign);
export default router;

import express from "express";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { getAnalyticsData, getDailySalesData, exportSalesCsv } from "../controllers/analytics.controller.js";

const router = express.Router();
const allowedRanges = new Set([7, 30, 90, 365]);

router.get("/export", protectRoute, adminRoute, exportSalesCsv);

router.get("/", protectRoute, adminRoute, async (req, res) => {
  try {
    const requestedDays = Number(req.query.days);
    const days = allowedRanges.has(requestedDays) ? requestedDays : 7;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const [analyticsData, dailySalesData] = await Promise.all([
      getAnalyticsData(startDate, endDate),
      getDailySalesData(startDate, endDate),
    ]);
    return res.json({ analyticsData, dailySalesData, range: { days, startDate, endDate } });
  } catch (error) {
    console.error("Error in analytics route", error.message);
    return res.status(500).json({ message: "دریافت گزارش آمار ناموفق بود." });
  }
});

export default router;

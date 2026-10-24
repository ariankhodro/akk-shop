import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { createServiceCase, getMyServiceCases } from "../controllers/service-case.controller.js";

const router = express.Router();
router.use(protectRoute);
router.get("/", getMyServiceCases);
router.post("/", createServiceCase);
export default router;

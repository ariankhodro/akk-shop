import express from "express";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { createCustomerAccount, setCustomerPassword, updateWholesaleTerms } from "../controllers/customer-accounts.controller.js";
import { getAuditLogs, getOperationsDashboard, getCustomers, updateCustomerAccess, getInventoryAlerts, getAdminServiceCases, updateAdminServiceCase } from "../controllers/admin.controller.js";

const router = express.Router();
router.get("/audit-logs", protectRoute, adminRoute, getAuditLogs);
router.get("/customers", protectRoute, adminRoute, getCustomers);
router.patch("/customers/:id/access", protectRoute, adminRoute, updateCustomerAccess);
router.post("/customers", protectRoute, adminRoute, createCustomerAccount);
router.patch("/customers/:id/wholesale", protectRoute, adminRoute, updateWholesaleTerms);
router.post("/customers/:id/password", protectRoute, adminRoute, setCustomerPassword);
router.get("/inventory", protectRoute, adminRoute, getInventoryAlerts);
router.get("/service-cases", protectRoute, adminRoute, getAdminServiceCases);
router.patch("/service-cases/:id", protectRoute, adminRoute, updateAdminServiceCase);
router.get("/operations", protectRoute, adminRoute, getOperationsDashboard);
export default router;

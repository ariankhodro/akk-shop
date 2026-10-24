import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { getReadinessStatus } from "./lib/readiness.js";
import { redis } from "./lib/redis.js";
import { connectDB } from "./lib/db.js";

import authRoutes from "./routes/auth.route.js";
import productRoutes from "./routes/product.route.js";
import categoryRoutes from "./routes/category.route.js";
import cartRoutes from "./routes/cart.route.js";
import couponRoutes from "./routes/coupon.route.js";
import paymentRoutes from "./routes/payment.route.js";
import analyticsRoutes from "./routes/analytics.route.js";
import campaignRoutes from "./routes/campaign.route.js";
import shippingRoutes from "./routes/shipping.route.js";
import newsletterRoutes from "./routes/newsletter.route.js";
import orderRoutes from "./routes/order.route.js";
import adminRoutes from "./routes/admin.route.js";
import serviceCaseRoutes from "./routes/service-case.route.js";
import { apiRateLimit } from "./middleware/rate-limit.middleware.js";
import { browserOriginAndCors, securityHeaders } from "./middleware/security.middleware.js";

const app = express();

// Keep connection diagnostics useful without ever logging connection strings.
const safeErrorMetadata = (error) => ({
  name: error?.name || "Error",
  code: typeof error?.code === "number" || typeof error?.code === "string" ? error.code : undefined,
  codeName: typeof error?.codeName === "string" ? error.codeName : undefined,
  labels: Array.isArray(error?.errorLabels)
    ? error.errorLabels.filter((label) => typeof label === "string").slice(0, 5)
    : undefined,
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(browserOriginAndCors);

// Rate-limit before readiness/database middleware can trigger connection attempts.
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  return apiRateLimit(req, res, next);
});

app.get("/api/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Readiness must actively establish/re-establish MongoDB connectivity instead
// of trusting the state left by a previous serverless invocation.
app.get("/api/ready", async (_req, res) => {
  try {
    await connectDB();
  } catch (error) {
    // Deliberately omit error.message and connection details from logs.
    console.error("Database readiness check failed", safeErrorMetadata(error));
  }

  // Read the live MongoDB state after the asynchronous Redis probe. A connection
  // that recovers during that probe must not produce "not_ready" with both
  // dependencies reported as connected.
  const readiness = await getReadinessStatus({
    databaseReady: () => mongoose.connection.readyState === 1,
    redisClient: redis,
  });
  return res.status(readiness.status === "ready" ? 200 : 503).json(readiness);
});

// Some Vercel execution paths invoke the Express app directly rather than
// through the API wrapper. Protect database-backed routes in either case.
app.use("/api", async (req, res, next) => {
  if (req.path === "/health" || req.path === "/ready") return next();

  try {
    await connectDB();
    return next();
  } catch (error) {
    console.error("Database connection unavailable for API request", safeErrorMetadata(error));
    return res.status(503).json({ message: "Service temporarily unavailable" });
  }
});

// Request bodies are parsed only after rate limiting and database availability checks.
// Keep ordinary JSON payloads small. Only content-management endpoints that may
// carry image data URLs receive the larger, still bounded 10 MB parser.
const largeJsonRequest = (req) => {
  const path = req.path;
  if (req.method === "POST" && ["/products", "/categories", "/campaigns"].includes(path)) return true;
  if ([ "PUT", "PATCH" ].includes(req.method) &&
      [/^\/products\/[a-f\d]{24}$/i, /^\/categories\/[a-f\d]{24}$/i, /^\/campaigns\/[a-f\d]{24}$/i].some((pattern) => pattern.test(path))) return true;
  return false;
};
app.use("/api", express.json({ limit: "10mb", type: largeJsonRequest }));
app.use("/api", express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/service-cases", serviceCaseRoutes);

app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found" }));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.status === 413 || error?.statusCode === 413) {
    return res.status(413).json({ message: "Request body is too large" });
  }
  if (error instanceof SyntaxError && (error.status === 400 || error.statusCode === 400) && "body" in error) {
    return res.status(400).json({ message: "Invalid JSON request body" });
  }
  console.error("Unhandled API error:", error?.message || error);
  return res.status(500).json({ message: "Internal server error" });
});

export default app;

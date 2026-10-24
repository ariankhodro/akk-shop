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
import { createReadyHandler } from "./lib/ready-handler.js";
import { globalJsonBody } from "./middleware/body-parsers.middleware.js";
import { browserOriginAndCors, securityHeaders } from "./middleware/security.middleware.js";
import { requestContext } from "./middleware/request-context.middleware.js";
import { trustProxyHops } from "./lib/config.js";
import { createFrontendServer } from "./middleware/serve-frontend.middleware.js";
import { logger, errorFields } from "./lib/logger.js";

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
// Number of trusted reverse-proxy hops (TRUST_PROXY_HOPS, default 1). Too many hops
// lets clients spoof req.ip; zero hops ignores X-Forwarded-For entirely.
app.set("trust proxy", trustProxyHops());
app.use(requestContext);
app.use(securityHeaders);
app.use(browserOriginAndCors);

// Rate-limit before readiness/database middleware can trigger connection attempts.
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  return apiRateLimit(req, res, next);
});

app.get("/api/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Readiness must actively establish/re-establish MongoDB connectivity instead
// of trusting the state left by a previous serverless invocation. Dependency
// detail is only returned to callers presenting READINESS_TOKEN (SEC-11).
app.get("/api/ready", createReadyHandler({
  connectDB,
  getReadinessStatus,
  isDatabaseReady: () => mongoose.connection.readyState === 1,
  redisClient: redis,
  // Deliberately omit error.message and connection details from logs.
  logError: (error) => console.error("Database readiness check failed", safeErrorMetadata(error)),
}));

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

// Request bodies are parsed only after rate limiting and database availability
// checks. The global parser is deliberately small; content-management routes
// that carry image data URLs mount the 10 MB parser themselves after
// protectRoute/adminRoute (SEC-4), and the global parser skips those routes.
app.use("/api", globalJsonBody);
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
// Optional: serve the built storefront from this process (single-command deployments).
if (process.env.SERVE_FRONTEND === "true") app.use(await createFrontendServer());

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.status === 413 || error?.statusCode === 413) {
    return res.status(413).json({ message: "Request body is too large" });
  }
  if (error instanceof SyntaxError && (error.status === 400 || error.statusCode === 400) && "body" in error) {
    return res.status(400).json({ message: "Invalid JSON request body" });
  }
  logger.error("unhandled_api_error", { requestId: _req.id, method: _req.method, path: _req.path, ...errorFields(error) });
  return res.status(500).json({ message: "Internal server error", requestId: _req.id });
});

export default app;

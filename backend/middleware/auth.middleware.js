import User from "../models/user.model.js";
import { verifyAccessToken, tokenVersionOf } from "../lib/auth-tokens.js";
import { hasPermission } from "../lib/rbac.js";

const TOKEN_ERRORS = new Set(["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"]);

export const protectRoute = async (req, res, next) => {
	const accessToken = req.cookies?.accessToken;
	if (typeof accessToken !== "string" || !accessToken) {
		return res.status(401).json({ message: "Unauthorized - No access token provided" });
	}

	let decoded;
	try {
		decoded = verifyAccessToken(accessToken);
	} catch (error) {
		if (error?.name === "TokenExpiredError") {
			return res.status(401).json({ message: "Unauthorized - Access token expired" });
		}
		if (TOKEN_ERRORS.has(error?.name)) {
			return res.status(401).json({ message: "Unauthorized - Invalid access token" });
		}
		// Misconfiguration (for example a missing secret) is a server fault, not a client one.
		console.error("Access token verification failed", { name: error?.name, message: error?.message });
		return res.status(500).json({ message: "Authentication service unavailable" });
	}

	try {
		const user = await User.findById(decoded.userId).select("-password");
		// The user record is reloaded on every request, so role, permission and
		// deactivation changes apply immediately; tokenVersion revokes tokens issued
		// before a password reset, deactivation or access change.
		if (!user || user.isActive === false || tokenVersionOf(user) !== decoded.tv) {
			return res.status(401).json({ message: "Authentication required" });
		}
		req.user = user;
		return next();
	} catch (error) {
		// A database failure must not look like a bad credential: the client would
		// otherwise discard a valid session.
		console.error("Error in protectRoute middleware", { name: error?.name, message: error?.message });
		return res.status(503).json({ message: "Authentication service temporarily unavailable" });
	}
};

// Public routes that price products for the viewer. A valid session attaches
// req.user; a missing, expired or invalid token simply means "anonymous". It
// never rejects the request and never reveals why a token was not accepted.
export const optionalAuth = async (req, _res, next) => {
	const accessToken = req.cookies?.accessToken;
	if (typeof accessToken !== "string" || !accessToken) return next();
	try {
		const decoded = verifyAccessToken(accessToken);
		const user = await User.findById(decoded.userId).select("_id role accountType wholesaleProfile isActive tokenVersion").lean();
		if (user && user.isActive !== false && tokenVersionOf(user) === decoded.tv) req.user = user;
	} catch {
		// Anonymous pricing is always safe to fall back to.
	}
	return next();
};

// Responses that depend on who is asking must never be stored by shared caches.
export const privateWhenPersonalised = (req, res, next) => {
	if (req.cookies?.accessToken) res.set("Cache-Control", "private, no-store");
	res.vary("Cookie");
	return next();
};

// Route -> permission table. Every route mounted behind `adminRoute` must have
// exactly one rule; unmapped routes are denied for everyone, owners included.
// A rule's `permission` is a single permission or an array meaning "any of".
export const ADMIN_PERMISSION_RULES = [
  { base: "/api/analytics", method: "GET", path: "/", permission: "reports.view" },
  { base: "/api/analytics", method: "GET", path: "/export", permission: "reports.export" },
  { base: "/api/orders", method: "GET", path: "/admin", permission: "orders.manage" },
  { base: "/api/orders", method: "PATCH", path: "/:id/shipment", permission: "orders.manage" },

  // Only admin-protected catalog routes appear here; public reads are not passed through adminRoute.
  { base: "/api/products", method: "GET", path: "/", permission: ["catalogue.manage", "marketing.manage"] },
  { base: "/api/products", method: "POST", path: "/", permission: "catalogue.manage" },
  { base: "/api/products", method: "PATCH", path: "/:id/stock", permission: ["catalogue.manage", "inventory.manage"] },
  { base: "/api/products", method: "PUT", path: "/:id", permission: "catalogue.manage" },
  { base: "/api/products", method: "PATCH", path: "/:id/active", permission: "catalogue.manage" },
  { base: "/api/products", method: "PATCH", path: "/:id/variant-stock", permission: ["catalogue.manage", "inventory.manage"] },
  { base: "/api/products", method: "PATCH", path: "/:id", permission: "catalogue.manage" },
  { base: "/api/products", method: "DELETE", path: "/:id", permission: "catalogue.manage" },
  { base: "/api/categories", method: "GET", path: "/admin", permission: "catalogue.manage" },
  { base: "/api/categories", method: "POST", path: "/", permission: "catalogue.manage" },
  { base: "/api/categories", method: "PATCH", path: "/:id", permission: "catalogue.manage" },
  { base: "/api/categories", method: "DELETE", path: "/:id", permission: "catalogue.manage" },

  { base: "/api/campaigns", method: "GET", path: "/admin", permission: "marketing.manage" },
  { base: "/api/campaigns", method: "POST", path: "/", permission: "marketing.manage" },
  { base: "/api/campaigns", method: "PATCH", path: "/:id", permission: "marketing.manage" },
  { base: "/api/campaigns", method: "DELETE", path: "/:id", permission: "marketing.manage" },
  { base: "/api/coupons", method: "GET", path: "/admin", permission: "marketing.manage" },
  { base: "/api/coupons", method: "POST", path: "/", permission: "marketing.manage" },
  { base: "/api/coupons", method: "PATCH", path: "/:id", permission: "marketing.manage" },
  { base: "/api/coupons", method: "DELETE", path: "/:id", permission: "marketing.manage" },
  { base: "/api/newsletter", method: "GET", path: "/admin", permission: "marketing.manage" },
  { base: "/api/shipping", method: "PUT", path: "/", permission: "settings.manage" },

  {
    base: "/api/admin", method: "GET", path: "/customers",
    permission: ({ userPermissions }) =>
      Array.isArray(userPermissions) && userPermissions.includes("roles.manage")
        ? "roles.manage"
        : "customers.manage",
  },
  { base: "/api/admin", method: "PATCH", path: "/customers/:id/access", permission: "roles.manage" },
  { base: "/api/admin", method: "POST", path: "/customers", permission: "wholesale.manage" },
  { base: "/api/admin", method: "PATCH", path: "/customers/:id/wholesale", permission: "wholesale.manage" },
  { base: "/api/admin", method: "POST", path: "/customers/:id/password", permission: "wholesale.manage" },
  { base: "/api/admin", method: "GET", path: "/service-cases", permission: "support.manage" },
  { base: "/api/admin", method: "PATCH", path: "/service-cases/:id", permission: ["support.manage", "refunds.manage"] },
  { base: "/api/admin", method: "GET", path: "/inventory", permission: "inventory.manage" },
  { base: "/api/admin", method: "GET", path: "/audit-logs", permission: "audit.view" },
  { base: "/api/admin", method: "GET", path: "/operations", permission: "system.view" },
];

const normalizeRoutePath = (value) => {
  if (typeof value !== "string" || !value) return "/";
  const normalized = value.replace(/\/+$/, "");
  return normalized || "/";
};

const matchesRouteTemplate = (template, requestedPath) => {
  const expectedSegments = normalizeRoutePath(template).split("/").filter(Boolean);
  const requestedSegments = normalizeRoutePath(requestedPath).split("/").filter(Boolean);
  return expectedSegments.length === requestedSegments.length &&
    expectedSegments.every((segment, index) =>
      segment.startsWith(":")
        ? requestedSegments[index].length > 0
        : segment === requestedSegments[index]
    );
};

export const resolveAdminPermission = ({ baseUrl, method, path, userPermissions } = {}) => {
  const base = normalizeRoutePath(baseUrl);
  const normalizedMethod = typeof method === "string" ? method.toUpperCase() : "";
  const rule = ADMIN_PERMISSION_RULES.find((candidate) =>
    candidate.base === base &&
    candidate.method === normalizedMethod &&
    matchesRouteTemplate(candidate.path, path)
  );
  if (!rule) return null;
  return typeof rule.permission === "function"
    ? rule.permission({ userPermissions })
    : rule.permission;
};

export const adminRoute = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ message: "Access denied" });

  const required = resolveAdminPermission({
    baseUrl: req.baseUrl,
    method: req.method,
    path: req.path,
    userPermissions: req.user.permissions,
  });

  // Unknown routes/methods fail closed for everyone, including owners.
  // Add an explicit permission rule whenever a new protected admin endpoint is introduced.
  if (!required) return res.status(403).json({ message: "Access denied" });

  // Deny by default: only an owner or an explicit, known permission passes. A
  // missing, malformed or legacy-wildcard permission list grants nothing.
  if (hasPermission(req.user, required)) return next();
  return res.status(403).json({ message: "You do not have permission to perform this action" });
};

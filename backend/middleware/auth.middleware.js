import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

export const protectRoute = async (req, res, next) => {
	try {
		const accessToken = req.cookies.accessToken;

		if (!accessToken) {
			return res.status(401).json({ message: "Unauthorized - No access token provided" });
		}

		try {
			const decoded = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);
			const user = await User.findById(decoded.userId).select("-password");

			if (!user || user.isActive === false) {
				return res.status(401).json({ message: "Authentication required" });
			}

			req.user = user;

			next();
		} catch (error) {
			if (error.name === "TokenExpiredError") {
				return res.status(401).json({ message: "Unauthorized - Access token expired" });
			}
			throw error;
		}
	} catch (error) {
		console.log("Error in protectRoute middleware", error.message);
		return res.status(401).json({ message: "Unauthorized - Invalid access token" });
	}
};

const ADMIN_PERMISSION_RULES = [
  { base: "/api/analytics", method: "GET", path: "/", permission: "reports.view" },
  { base: "/api/analytics", method: "GET", path: "/export", permission: "reports.view" },
  { base: "/api/orders", method: "GET", path: "/admin", permission: "orders.manage" },
  { base: "/api/orders", method: "PATCH", path: "/:id/shipment", permission: "orders.manage" },

  // Only admin-protected catalog routes appear here; public reads are not passed through adminRoute.
  { base: "/api/products", method: "GET", path: "/", permission: "catalogue.manage" },
  { base: "/api/products", method: "POST", path: "/", permission: "catalogue.manage" },
  { base: "/api/products", method: "PATCH", path: "/:id/stock", permission: "catalogue.manage" },
  { base: "/api/products", method: "PUT", path: "/:id", permission: "catalogue.manage" },
  { base: "/api/products", method: "PATCH", path: "/:id/active", permission: "catalogue.manage" },
  { base: "/api/products", method: "PATCH", path: "/:id/variant-stock", permission: "catalogue.manage" },
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
  { base: "/api/admin", method: "GET", path: "/service-cases", permission: "support.manage" },
  { base: "/api/admin", method: "PATCH", path: "/service-cases/:id", permission: "support.manage" },
  { base: "/api/admin", method: "GET", path: "/inventory", permission: "inventory.manage" },
  { base: "/api/admin", method: "GET", path: "/audit-logs", permission: "audit.view" },
  { base: "/api/admin", method: "GET", path: "/operations", permission: "system.view" },
];

const normalizeRoutePath = (value) => {
  if (typeof value !== "string" || !value) return "/";
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
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

  // Unknown routes/methods fail closed, including for legacy and wildcard admins.
  // Add an explicit permission rule whenever a new protected admin endpoint is introduced.
  if (!required) return res.status(403).json({ message: "Access denied" });

  const granted = req.user.permissions;
  // Legacy access is preserved only for recognized routes until permissions are configured.
  if (!Array.isArray(granted)) return next();
  if (granted.includes("*") || granted.includes(required)) return next();
  return res.status(403).json({ message: "You do not have permission to perform this action" });
};

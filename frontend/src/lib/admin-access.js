// UI hints only. The server enforces every permission (backend/lib/rbac.js and
// ADMIN_PERMISSION_RULES); this map decides which tabs to *offer*. Keep it in
// sync with the rules table. Values are "any of" lists.
export const TAB_PERMISSIONS = Object.freeze({
  dashboard: ["reports.view", "orders.manage", "catalogue.manage", "system.view"],
  create: ["catalogue.manage"],
  products: ["catalogue.manage"],
  categories: ["catalogue.manage"],
  orders: ["orders.manage"],
  "service-cases": ["support.manage", "refunds.manage"],
  customers: ["customers.manage", "roles.manage", "wholesale.manage"],
  inventory: ["inventory.manage"],
  shipping: ["settings.manage"],
  campaigns: ["marketing.manage"],
  coupons: ["marketing.manage"],
  newsletter: ["marketing.manage"],
  analytics: ["reports.view"],
  audit: ["audit.view"],
  operations: ["system.view"],
});

export const hasAnyPermission = (permissions, required) =>
  Array.isArray(permissions) && [].concat(required).some((permission) => permissions.includes(permission));

export const canOpenTab = (permissions, tabId) =>
  Object.hasOwn(TAB_PERMISSIONS, tabId) && hasAnyPermission(permissions, TAB_PERMISSIONS[tabId]);

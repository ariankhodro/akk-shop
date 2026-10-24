// Role-based access control model.
//
// Security model (deny by default):
//   * Customers have no administrative permission.
//   * Administrators hold an explicit list of permissions. A missing, malformed
//     or empty list grants nothing.
//   * The "owner" tier is an explicit `isOwner` flag. It can only be set through
//     the operator-run bootstrap script (scripts/bootstrap-owner.mjs) or by an
//     existing owner. Owners hold every permission; nobody else can hold the
//     wildcard.
//   * Role presets are server-side templates that expand to explicit permission
//     lists. The preset name is informational; the permission list is what is
//     enforced.

export const PERMISSIONS = Object.freeze([
  "catalogue.manage",
  "inventory.manage",
  "orders.manage",
  "customers.manage",
  "support.manage",
  "refunds.manage",
  "marketing.manage",
  "reports.view",
  "reports.export",
  "settings.manage",
  "audit.view",
  "system.view",
  "roles.manage",
]);

// Permissions that only an owner may grant, revoke or hold when delegating.
export const OWNER_ONLY_GRANTS = Object.freeze(["roles.manage"]);

export const LEGACY_WILDCARD = "*";

export const ROLE_PRESETS = Object.freeze({
  owner: Object.freeze([...PERMISSIONS]),
  manager: Object.freeze(PERMISSIONS.filter((permission) => permission !== "roles.manage")),
  catalogue_editor: Object.freeze(["catalogue.manage", "inventory.manage"]),
  fulfillment: Object.freeze(["orders.manage", "inventory.manage"]),
  support: Object.freeze(["support.manage", "customers.manage"]),
  marketing: Object.freeze(["marketing.manage"]),
  analyst: Object.freeze(["reports.view"]),
});

export const ROLE_PRESET_NAMES = Object.freeze(Object.keys(ROLE_PRESETS));

const permissionSet = new Set(PERMISSIONS);

export const isKnownPermission = (value) => typeof value === "string" && permissionSet.has(value);

export const isOwner = (user) =>
  Boolean(user) && user.role === "admin" && user.isActive !== false && user.isOwner === true;

// Normalised, de-duplicated permission list that can actually be exercised.
export const explicitPermissions = (user) => {
  if (!user || user.role !== "admin" || user.isActive === false) return [];
  if (!Array.isArray(user.permissions)) return [];
  return [...new Set(user.permissions.filter(isKnownPermission))];
};

export const effectivePermissions = (user) => {
  if (!user || user.role !== "admin" || user.isActive === false) return [];
  if (isOwner(user)) return [...PERMISSIONS];
  return explicitPermissions(user);
};

export const hasPermission = (user, required) => {
  const anyOf = Array.isArray(required) ? required : [required];
  if (anyOf.length === 0) return false;
  const granted = new Set(effectivePermissions(user));
  return anyOf.some((permission) => isKnownPermission(permission) && granted.has(permission));
};

export const presetPermissions = (name) =>
  Object.hasOwn(ROLE_PRESETS, name) && name !== "owner" ? [...ROLE_PRESETS[name]] : null;

// Counts accounts that can still administer access. Only active owners count:
// delegated roles.manage holders are intentionally not enough to prevent lockout.
export const isActiveOwnerRecord = (record) =>
  Boolean(record) && record.role === "admin" && record.isActive !== false && record.isOwner === true;

export class AccessChangeError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "AccessChangeError";
    this.status = status;
    this.code = code;
  }
}

// Decide whether `actor` may change `target` into `next`. Throws AccessChangeError
// when the change is not allowed. Pure function: callers supply already-loaded
// records and the count of other active owners.
export const assertAccessChangeAllowed = ({ actor, target, next, otherActiveOwners }) => {
  const actorIsOwner = isOwner(actor);
  const targetIsOwner = target.isOwner === true;
  const nextIsAdmin = next.role === "admin";
  const nextPermissions = Array.isArray(next.permissions) ? next.permissions : [];

  if (!actorIsOwner && !hasPermission(actor, "roles.manage")) {
    throw new AccessChangeError(403, "You do not have permission to perform this action", "ROLES_MANAGE_REQUIRED");
  }

  const isSelf = String(actor._id) === String(target._id);
  if (isSelf && !actorIsOwner) {
    throw new AccessChangeError(409, "You cannot change your own administrator access", "SELF_CHANGE");
  }

  if (nextIsAdmin) {
    if (!Array.isArray(next.permissions)) {
      throw new AccessChangeError(400, "Administrator permissions must be provided explicitly", "PERMISSIONS_REQUIRED");
    }
    if (nextPermissions.some((permission) => permission === LEGACY_WILDCARD)) {
      throw new AccessChangeError(400, "The wildcard permission is no longer assignable; use the owner tier", "WILDCARD_REMOVED");
    }
    if (nextPermissions.some((permission) => !isKnownPermission(permission))) {
      throw new AccessChangeError(400, "Invalid administrator permissions", "UNKNOWN_PERMISSION");
    }
  }

  // Owner tier changes are owner-only.
  if (next.isOwner !== targetIsOwner && !actorIsOwner) {
    throw new AccessChangeError(403, "Only an owner can change the owner tier", "OWNER_TIER_OWNER_ONLY");
  }
  if (next.isOwner === true && !nextIsAdmin) {
    throw new AccessChangeError(400, "An owner must be an administrator", "OWNER_MUST_BE_ADMIN");
  }

  if (!actorIsOwner) {
    // Delegated administrators may not touch owners or other access managers.
    if (targetIsOwner) {
      throw new AccessChangeError(403, "Only an owner can modify an owner", "TARGET_IS_OWNER");
    }
    if (target.role === "admin" && explicitPermissions(target).some((permission) => OWNER_ONLY_GRANTS.includes(permission))) {
      throw new AccessChangeError(403, "Only an owner can modify an administrator who manages access", "TARGET_MANAGES_ACCESS");
    }
    if (nextIsAdmin && nextPermissions.some((permission) => OWNER_ONLY_GRANTS.includes(permission))) {
      throw new AccessChangeError(403, "Only an owner can grant access-management permission", "GRANT_OWNER_ONLY");
    }
    // Least privilege: a delegate may only grant what they hold themselves.
    const actorHolds = new Set(effectivePermissions(actor));
    if (nextIsAdmin && nextPermissions.some((permission) => !actorHolds.has(permission))) {
      throw new AccessChangeError(403, "You cannot grant permissions you do not hold", "GRANT_EXCEEDS_ACTOR");
    }
  }

  // Never lose the last active owner.
  const targetWasActiveOwner = isActiveOwnerRecord(target);
  const targetRemainsActiveOwner = isActiveOwnerRecord({
    role: next.role, isActive: next.isActive, isOwner: next.isOwner,
  });
  if (targetWasActiveOwner && !targetRemainsActiveOwner && otherActiveOwners < 1) {
    throw new AccessChangeError(409, "At least one active owner must remain", "LAST_OWNER");
  }
};

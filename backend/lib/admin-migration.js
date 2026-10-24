import { PERMISSIONS, LEGACY_WILDCARD, ROLE_PRESETS, isKnownPermission } from "./rbac.js";

// Plans (does not apply) the conversion of pre-RBAC administrator records.
//
//   permissions missing/malformed -> [] (no access). They are NEVER promoted to
//       owner or "everything"; an owner must assign a role explicitly.
//   permissions containing "*"    -> the `manager` preset plus any other explicit
//       known permissions (so nothing is silently widened to roles.manage / owner).
//   explicit known lists          -> unchanged (unknown values removed).
//
// `assignments` maps lower-cased emails to role-preset names chosen by the
// operator running the script; it is the only way a legacy admin gains access.
export const planAdminMigration = (admins, assignments = {}) => {
  const changes = [];
  for (const admin of admins) {
    if (admin.role !== "admin") continue;
    const email = String(admin.email || "").toLowerCase();
    const current = admin.permissions;
    let next;
    let reason;

    if (Object.hasOwn(assignments, email)) {
      const preset = assignments[email];
      if (!Object.hasOwn(ROLE_PRESETS, preset) || preset === "owner") {
        throw new Error(`Unknown or non-assignable role preset "${preset}" for ${email}`);
      }
      next = { permissions: [...ROLE_PRESETS[preset]], adminRole: preset };
      reason = `explicit assignment: ${preset}`;
    } else if (!Array.isArray(current)) {
      next = { permissions: [], adminRole: undefined };
      reason = "legacy administrator without explicit permissions: access removed until an owner assigns a role";
    } else if (current.includes(LEGACY_WILDCARD)) {
      const explicit = current.filter((value) => value !== LEGACY_WILDCARD && isKnownPermission(value));
      next = { permissions: [...new Set([...ROLE_PRESETS.manager, ...explicit])], adminRole: undefined };
      reason = "wildcard permission converted to the manager preset (no owner tier granted)";
    } else {
      const known = [...new Set(current.filter(isKnownPermission))];
      if (known.length === current.length) continue;
      next = { permissions: known, adminRole: admin.adminRole };
      reason = "unknown permission values removed";
    }

    const same = Array.isArray(current) && current.length === next.permissions.length &&
      current.every((value) => next.permissions.includes(value)) && (next.adminRole ?? null) === (admin.adminRole ?? null);
    if (same) continue;
    changes.push({ userId: admin._id, email, before: Array.isArray(current) ? [...current] : null, after: next, reason });
  }
  return changes;
};

export const applyAdminMigration = async (UserModel, changes) => {
  let applied = 0;
  for (const change of changes) {
    const filter = { _id: change.userId, role: "admin" };
    const update = {
      $set: { permissions: change.after.permissions },
      $inc: { tokenVersion: 1 },
      ...(change.after.adminRole ? {} : { $unset: { adminRole: "" } }),
    };
    if (change.after.adminRole) update.$set.adminRole = change.after.adminRole;
    const result = await UserModel.updateOne(filter, update);
    applied += result.modifiedCount || 0;
  }
  return applied;
};

export const countActiveOwners = (UserModel) =>
  UserModel.countDocuments({ role: "admin", isActive: { $ne: false }, isOwner: true });

export { PERMISSIONS };

// Converts pre-RBAC administrators to explicit permissions. Dry-run by default.
//
//   node scripts/migrate-admin-permissions.mjs                       # report only
//   node scripts/migrate-admin-permissions.mjs --assign a@x.com=manager --assign b@x.com=fulfillment
//   BACKUP_CONFIRMED=yes node scripts/migrate-admin-permissions.mjs --apply [--assign ...]
//
// Legacy administrators (no explicit permissions) lose access until an owner
// assigns a role; nobody becomes owner here. Create the first owner with
// scripts/bootstrap-owner.mjs. The script is idempotent: a second run reports
// nothing to do. Before TOKEN revocation matters: tokenVersion is incremented for
// every changed administrator so their sessions must be re-established.
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../backend/models/user.model.js";
import { applyAdminMigration, countActiveOwners, planAdminMigration } from "../backend/lib/admin-migration.js";

dotenv.config();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const assignments = {};
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== "--assign") continue;
  const [email, preset] = String(args[index + 1] || "").split("=");
  if (!email || !preset) { console.error("--assign expects email=preset"); process.exit(2); }
  assignments[email.trim().toLowerCase()] = preset.trim();
}

if (!process.env.MONGO_URI) { console.error("MONGO_URI must be configured."); process.exit(1); }
if (apply && process.env.BACKUP_CONFIRMED !== "yes") {
  console.error("Refusing to modify data: set BACKUP_CONFIRMED=yes after taking a verified backup.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI);
  const admins = await User.find({ role: "admin" }).select("email role permissions adminRole isActive isOwner").lean();
  const changes = planAdminMigration(admins, assignments);
  console.log(`Administrators found: ${admins.length}; needing change: ${changes.length}`);
  for (const change of changes) {
    console.log(`- ${change.email}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after.permissions)} (${change.reason})`);
  }
  if (apply && changes.length) {
    const applied = await applyAdminMigration(User, changes);
    console.log(`Applied: ${applied}`);
  } else if (!apply) {
    console.log("Dry run only. Re-run with --apply (and BACKUP_CONFIRMED=yes) to write changes.");
  }
  const owners = await countActiveOwners(User);
  if (owners === 0) {
    console.warn("WARNING: no active owner exists. Run scripts/bootstrap-owner.mjs --email <address> --apply, otherwise nobody can manage administrator access.");
  }
} catch (error) {
  console.error("Administrator permission migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

// Securely bootstraps the owner tier. Only someone with database/shell access to
// the deployment (i.e. the operator) can run this; there is no HTTP path to it.
//
//   node scripts/bootstrap-owner.mjs --email owner@example.com            # dry run
//   BACKUP_CONFIRMED=yes node scripts/bootstrap-owner.mjs --email owner@example.com --apply
//
// The account must already exist (register it through the storefront first). A
// second owner is refused unless --allow-additional is passed.
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../backend/models/user.model.js";
import AuditLog from "../backend/models/audit-log.model.js";
import { countActiveOwners } from "../backend/lib/admin-migration.js";

dotenv.config();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allowAdditional = args.includes("--allow-additional");
const emailIndex = args.indexOf("--email");
const email = emailIndex >= 0 ? String(args[emailIndex + 1] || "").trim().toLowerCase() : "";

if (!email) { console.error("Usage: bootstrap-owner.mjs --email <address> [--apply] [--allow-additional]"); process.exit(2); }
if (!process.env.MONGO_URI) { console.error("MONGO_URI must be configured."); process.exit(1); }
if (apply && process.env.BACKUP_CONFIRMED !== "yes") {
  console.error("Refusing to modify data: set BACKUP_CONFIRMED=yes after taking a verified backup.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email }).select("email role isActive isOwner");
  if (!user) { console.error("No account with that email exists."); process.exitCode = 1; }
  else if (user.isActive === false) { console.error("The account is deactivated."); process.exitCode = 1; }
  else if (user.role === "admin" && user.isOwner === true) { console.log("Already an owner; nothing to do."); }
  else {
    const owners = await countActiveOwners(User);
    if (owners > 0 && !allowAdditional) {
      console.error(`${owners} active owner(s) already exist. Use the admin panel, or pass --allow-additional.`);
      process.exitCode = 1;
    } else if (!apply) {
      console.log(`Dry run: would make ${email} an owner (currently role=${user.role}). Re-run with --apply.`);
    } else {
      await User.updateOne({ _id: user._id }, {
        $set: { role: "admin", isOwner: true, adminRole: "owner", permissions: [] },
        $inc: { tokenVersion: 1 },
      });
      await AuditLog.create({
        actorName: "system:bootstrap-owner", actorRole: "system", action: "owner.bootstrapped",
        targetType: "user", targetId: String(user._id), summary: "Owner tier bootstrapped by operator script",
        metadata: { email, previousRole: user.role },
      });
      console.log(`${email} is now an owner. Existing sessions for that account were revoked; sign in again.`);
    }
  }
} catch (error) {
  console.error("Owner bootstrap failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

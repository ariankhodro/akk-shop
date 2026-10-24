// Regenerates the route table and role/permission grid of docs/security/permission-matrix.md
// from the code (ADMIN_PERMISSION_RULES and ROLE_PRESETS), so the document cannot drift.
//   node scripts/generate-permission-matrix.mjs > /tmp/matrix.md
import { ADMIN_PERMISSION_RULES } from "../backend/middleware/auth.middleware.js";
import { PERMISSIONS, ROLE_PRESETS } from "../backend/lib/rbac.js";

const label = (permission) => (typeof permission === "function" ? "roles.manage (if held) else customers.manage" : [].concat(permission).join(" **or** "));
const lines = ["### Route to permission table (generated)", "", "| Method | Route | Required permission |", "|---|---|---|"];
for (const rule of ADMIN_PERMISSION_RULES) lines.push(`| ${rule.method} | \`${rule.base}${rule.path === "/" ? "" : rule.path}\` | ${label(rule.permission)} |`);
lines.push("", "### Role presets (generated)", "", `| Permission | ${Object.keys(ROLE_PRESETS).join(" | ")} |`, `|---|${Object.keys(ROLE_PRESETS).map(() => "---").join("|")}|`);
for (const permission of PERMISSIONS) lines.push(`| \`${permission}\` | ${Object.values(ROLE_PRESETS).map((set) => (set.includes(permission) ? "yes" : "")).join(" | ")} |`);
console.log(lines.join("\n"));

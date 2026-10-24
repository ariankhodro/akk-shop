// One command: build the storefront if needed, then start the API serving it.
//   npm run start:all            (build only when frontend/dist is missing)
//   npm run start:all -- --build (always rebuild)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "frontend/dist/index.html");
if (process.argv.includes("--build") || !existsSync(dist)) {
  console.log("Building the frontend...");
  if (!existsSync(path.join(root, "frontend/node_modules"))) {
    const install = spawnSync("npm", ["ci", "--prefix", "frontend"], { cwd: root, stdio: "inherit" });
    if (install.status !== 0) process.exit(install.status ?? 1);
  }
  const build = spawnSync("npm", ["run", "build", "--prefix", "frontend"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
process.env.SERVE_FRONTEND = "true";
await import("../backend/server.js");

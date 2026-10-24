// One command for development: API (nodemon) + Vite dev server with hot reload.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [
  spawn("npx", ["nodemon", "backend/server.js"], { cwd: root, stdio: "inherit" }),
  spawn("npm", ["run", "dev", "--prefix", "frontend", "--", "--host"], { cwd: root, stdio: "inherit" }),
];
const stop = () => children.forEach((child) => child.kill("SIGTERM"));
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => { stop(); process.exitCode = process.exitCode || code || 0; });

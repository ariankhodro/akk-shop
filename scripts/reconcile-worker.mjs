// Long-running payment reconciliation scheduler for self-hosted (Docker) deployments.
// It replaces the GitHub Actions cron (.github/workflows/reconcile-payments.yml):
// every RECONCILE_INTERVAL_SECONDS it calls the protected reconciliation endpoint
// on the internal network. The endpoint itself holds a Redis lease, so running
// this next to an external scheduler is safe (overlapping runs are skipped).
//
//   RECONCILE_API_URL=http://app:5000 CRON_SECRET=... node scripts/reconcile-worker.mjs
const apiOrigin = (process.env.RECONCILE_API_URL || process.env.API_URL || "").replace(/\/+$/, "");
const cronSecret = process.env.CRON_SECRET || "";
const intervalSeconds = (() => {
  const value = Number(process.env.RECONCILE_INTERVAL_SECONDS);
  return Number.isInteger(value) && value >= 60 && value <= 3600 ? value : 300;
})();

const log = (level, event, details = {}) =>
  console[level === "error" ? "error" : "log"](JSON.stringify({ level, event, time: new Date().toISOString(), ...details }));

let parsed;
try { parsed = new URL(apiOrigin); } catch { parsed = null; }
// Plain HTTP is only acceptable for a host on the private compose network.
if (!parsed || !(parsed.protocol === "https:" || (parsed.protocol === "http:" && !parsed.hostname.includes(".")))) {
  log("error", "reconcile_worker_config", { message: "RECONCILE_API_URL must be https://... or an internal http://<service>:<port> origin." });
  process.exit(1);
}
if (cronSecret.length < 32) {
  log("error", "reconcile_worker_config", { message: "CRON_SECRET must be configured with at least 32 characters." });
  process.exit(1);
}

let stopping = false;
let timer = null;
const stop = (signal) => { stopping = true; if (timer) clearTimeout(timer); log("info", "reconcile_worker_stopping", { signal }); process.exit(0); };
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

const runOnce = async () => {
  try {
    const response = await fetch(`${apiOrigin}/api/payments/reconcile-pending`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" },
      signal: AbortSignal.timeout(58_000),
    });
    const body = await response.text();
    if (!response.ok) log("error", "reconcile_failed", { status: response.status, body: body.slice(0, 600) });
    else log("info", "reconcile_completed", { body: body.slice(0, 600) });
  } catch (error) {
    log("error", "reconcile_request_failed", { message: error.message });
  }
};

const loop = async () => {
  await runOnce();
  if (!stopping) timer = setTimeout(loop, intervalSeconds * 1000);
};

log("info", "reconcile_worker_started", { intervalSeconds, target: parsed.origin });
// Give the API a moment after container start before the first run.
timer = setTimeout(loop, 15_000);

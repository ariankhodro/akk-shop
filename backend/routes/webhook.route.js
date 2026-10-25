import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

let syncTimeout = null;
let isSyncRunning = false;
let pendingSync = false;

function triggerDebouncedSync(delayMs = 1500) {
  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(() => {
    if (isSyncRunning) {
      pendingSync = true;
      return;
    }

    isSyncRunning = true;
    console.log("[Webhook] Triggering real-time incremental sync from Tadarok...");

    const child = spawn(process.execPath || "node", ["scripts/sync-tadarok.mjs"], {
      cwd: rootDir,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      isSyncRunning = false;
      console.log(`[Webhook] Real-time sync completed with code ${code}`);
      if (pendingSync) {
        pendingSync = false;
        triggerDebouncedSync(500);
      }
    });

    child.on("error", (err) => {
      isSyncRunning = false;
      console.error("[Webhook] Failed to run sync-tadarok.mjs:", err.message);
    });
  }, delayMs);
}

function verifySignature(header, rawBody, secret, toleranceSec = 300) {
  if (!secret) return true; // If no secret configured, accept
  if (!header || !rawBody) return false;

  try {
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
    const t = Number(parts.t);
    const given = parts.v1;

    if (!Number.isFinite(t) || !given) return false;
    if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;

    const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
    const hmac = createHmac("sha256", secret);
    hmac.update(`${t}.`);
    hmac.update(payloadBuffer);
    const expected = hmac.digest("hex");

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(given, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

router.get("/tadarok", (_req, res) => {
  res.status(200).json({
    status: "active",
    endpoint: "/api/webhooks/tadarok",
    hasSecret: Boolean(process.env.TADAROK_WEBHOOK_SECRET),
  });
});

router.post("/tadarok", (req, res) => {
  const secret = process.env.TADAROK_WEBHOOK_SECRET;
  const sigHeader = req.headers["x-tadarok-signature"] || req.headers["x-signature"];

  // Verify HMAC signature if secret is set
  if (secret) {
    if (!req.rawBody || !verifySignature(sigHeader, req.rawBody, secret)) {
      console.warn("[Webhook] Invalid or missing HMAC signature on /api/webhooks/tadarok");
      return res.status(401).json({ error: "invalid_signature" });
    }
  }

  const payload = req.body || {};
  const eventType = payload.type || req.headers["x-tadarok-event"] || "unknown";
  const dataset = payload.data?.dataset;

  console.log(`[Webhook] Received Tadarok webhook event: ${eventType} (dataset: ${dataset || "any"})`);

  // Respond immediately within SLA (Tadarok expects 2xx within 10s)
  res.status(200).json({
    ok: true,
    received: true,
    event: eventType,
    dataset: dataset || null,
    timestamp: new Date().toISOString(),
  });

  // Acknowledge ping or test events without triggering full sync
  if (eventType === "webhook.test" || eventType === "ping") {
    console.log("[Webhook] Test event acknowledged successfully.");
    return;
  }

  // Trigger incremental sync in background
  triggerDebouncedSync();
});

export default router;

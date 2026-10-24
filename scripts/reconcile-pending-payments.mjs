const apiOrigin = (process.env.API_URL || "").replace(/\/+$/, "");
const cronSecret = process.env.CRON_SECRET || "";

if (!/^https:\/\//i.test(apiOrigin)) {
  console.error("API_URL must be the public HTTPS backend origin without /api.");
  process.exit(1);
}
if (cronSecret.length < 32) {
  console.error("CRON_SECRET must be configured with at least 32 characters.");
  process.exit(1);
}

try {
  const response = await fetch(`${apiOrigin}/api/payments/reconcile-pending`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`Payment reconciliation failed with HTTP ${response.status}: ${body.slice(0, 600)}`);
    process.exit(1);
  }
  console.log(body);
} catch (error) {
  console.error("Payment reconciliation request failed:", error.message);
  process.exit(1);
}

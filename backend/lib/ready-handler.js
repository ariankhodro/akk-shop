import { timingSafeEqual } from "node:crypto";

// SEC-11: /api/ready does real work (reconnects MongoDB, probes Redis for up to
// 6 s) and reports dependency state. When READINESS_TOKEN is configured the
// caller must present it (X-Readiness-Token or Authorization: Bearer). Without
// a configured token anonymous callers only get {status}, never dependency
// detail.

const constantTimeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

const presentedToken = (req) => {
  const header = req.get?.("x-readiness-token") ?? req.headers?.["x-readiness-token"];
  if (typeof header === "string" && header) return header;
  const authorization = req.get?.("authorization") ?? req.headers?.authorization;
  const match = typeof authorization === "string" ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
  return match ? match[1] : "";
};

export const createReadyHandler = ({ connectDB, getReadinessStatus, isDatabaseReady, redisClient, logError = () => {} }) =>
  async (req, res) => {
    const expected = process.env.READINESS_TOKEN || "";
    const authorized = Boolean(expected) && constantTimeEqual(presentedToken(req), expected);
    if (expected && !authorized) {
      res.set("Cache-Control", "no-store");
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      await connectDB();
    } catch (error) {
      logError(error);
    }

    // Read the live MongoDB state after the asynchronous Redis probe. A
    // connection that recovers during that probe must not produce "not_ready"
    // with both dependencies reported as connected.
    const readiness = await getReadinessStatus({ databaseReady: isDatabaseReady, redisClient });
    res.set("Cache-Control", "no-store");
    const code = readiness.status === "ready" ? 200 : 503;
    return res.status(code).json(authorized ? readiness : { status: readiness.status });
  };

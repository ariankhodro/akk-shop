import AuditLog from "../models/audit-log.model.js";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const comparableValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toHexString === "function") return value.toHexString();
  if (Array.isArray(value)) return value.map(comparableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, comparableValue(value[key])])
    );
  }
  return value;
};

const sameValue = (left, right) =>
  JSON.stringify(comparableValue(left)) === JSON.stringify(comparableValue(right));

const buildChangeSet = (metadata) => {
  const before = isRecord(metadata.before) ? metadata.before : {};
  const after = isRecord(metadata.after) ? metadata.after : {};
  const hasSnapshots = isRecord(metadata.before) || isRecord(metadata.after);
  const supplied = isRecord(metadata.changes) ? metadata.changes : null;
  if (!hasSnapshots && !supplied) return null;

  const candidates = supplied || Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => [
      key,
      { before: before[key] ?? null, after: after[key] ?? null },
    ])
  );
  return Object.fromEntries(Object.entries(candidates).filter(([, delta]) =>
    !sameValue(delta?.before ?? null, delta?.after ?? null)
  ));
};

const safeOrigin = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin.slice(0, 200) : "";
  } catch {
    return "";
  }
};

const safeRefererPath = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    // Keep path context but deliberately discard query strings/fragments that may contain tokens.
    return (parsed.origin + parsed.pathname).slice(0, 300);
  } catch {
    return "";
  }
};

const headerValue = (req, name, maxLength) => {
  if (typeof req.get !== "function") return "";
  return String(req.get(name) || "").replace(/[\r\n]/g, "").slice(0, maxLength);
};

// `strict` makes a failed audit write throw so security-critical changes can be
// failed (or rolled back with `session`) instead of silently going unrecorded.
export const recordAuditEvent = async (req, event, { session, strict = false } = {}) => {
  try {
    const metadataInput = isRecord(event.metadata) ? event.metadata : {};
    const metadata = { ...metadataInput };
    const changes = buildChangeSet(metadata);
    if (changes) {
      metadata.changes = changes;
      metadata.changedFields = Object.keys(changes);
      metadata.changeCount = Object.keys(changes).length;
    }

    const referer = headerValue(req, "referer", 1000);
    const origin = headerValue(req, "origin", 300);
    const requestId = headerValue(req, "x-request-id", 160)
      || headerValue(req, "x-vercel-id", 160)
      || String(req.id || "").slice(0, 160);

    const document = {
      actor: req.user?._id || null,
      actorName: typeof req.user?.name === "string" ? req.user.name.slice(0, 120) : "Admin",
      actorRole: typeof req.user?.role === "string" ? req.user.role.slice(0, 40) : "",
      action: String(event.action || "unknown").slice(0, 120),
      targetType: String(event.targetType || "unknown").slice(0, 80),
      targetId: event.targetId == null ? "" : String(event.targetId).slice(0, 80),
      summary: String(event.summary || event.action || "Admin action").slice(0, 500),
      metadata,
      ip: typeof req.ip === "string" ? req.ip.slice(0, 64) : "",
      userAgent: headerValue(req, "user-agent", 256),
      requestMethod: typeof req.method === "string" ? req.method.slice(0, 12) : "",
      requestPath: typeof req.path === "string" ? String(req.baseUrl || "") + req.path : "",
      requestId,
      requestHost: headerValue(req, "host", 200),
      requestOrigin: safeOrigin(origin),
      refererPath: safeRefererPath(referer),
    };
    if (session) await AuditLog.create([document], { session });
    else await AuditLog.create(document);
  } catch (error) {
    console.error("Failed to record admin audit event:", { action: event?.action, name: error?.name, message: error?.message });
    if (strict) throw error;
  }
};

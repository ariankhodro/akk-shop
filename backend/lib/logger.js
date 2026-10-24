// Minimal structured (JSON-lines) logger. One line per event, no secrets: callers
// pass identifiers and error metadata, never request bodies, cookies or tokens.
const emit = (level, event, fields = {}) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
};

export const logger = {
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields),
};

export const errorFields = (error) => ({
  errorName: error?.name || "Error",
  errorCode: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : undefined,
  errorMessage: typeof error?.message === "string" ? error.message.slice(0, 300) : undefined,
});

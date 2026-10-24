// A non-sensitive flag telling the app that this browser probably has a session
// cookie. It never holds tokens or user data; it only lets anonymous visitors
// skip the /auth/profile -> /auth/refresh-token -> /auth/logout failure chain.
const KEY = "session-hint";

const storage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const hasSessionHint = () => {
  try {
    return storage()?.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export const setSessionHint = () => {
  try {
    storage()?.setItem(KEY, "1");
  } catch {
    // Storage may be blocked (private mode); the app still works without it.
  }
};

export const clearSessionHint = () => {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // See setSessionHint.
  }
};

import http from "node:http";

export const testSecrets = {
  ACCESS_TOKEN_SECRET: "test-access-secret-0123456789abcdef0123456789",
  REFRESH_TOKEN_SECRET: "test-refresh-secret-fedcba9876543210fedcba9876",
};

export const dbNameOf = (uri) => {
  try { return new URL(uri).pathname.replace(/^\//, "").split("?")[0]; } catch { return ""; }
};

export const assertDisposableDatabase = (uri) => {
  if (uri && !/(^|[_-])test($|[_-])/i.test(dbNameOf(uri))) {
    throw new Error("MONGO_TEST_URI must point to a dedicated disposable database whose name includes 'test'.");
  }
};

// Starts an Express app on an ephemeral port and returns a tiny cookie-aware client.
export const startApp = async (app) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const client = ({ cookies = {}, headers = {} } = {}) => {
    const jar = new Map(Object.entries(cookies));
    const request = async (method, path, body, extraHeaders = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...headers, ...extraHeaders,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const setCookies = response.headers.getSetCookie();
      for (const line of setCookies) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name); else jar.set(name, value);
      }
      let json = null;
      const text = await response.text();
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
      return { status: response.status, json, text, headers: response.headers, setCookies };
    };
    return {
      jar,
      get: (path, h) => request("GET", path, undefined, h),
      post: (path, body, h) => request("POST", path, body, h),
      patch: (path, body, h) => request("PATCH", path, body, h),
      put: (path, body, h) => request("PUT", path, body, h),
      del: (path, h) => request("DELETE", path, undefined, h),
    };
  };
  return { base, client, close: () => new Promise((resolve) => server.close(resolve)) };
};

// Each integration file gets its own database so files can run concurrently
// (node --test runs files in parallel) without dropping each other's data.
export const withDatabase = (uri, name) => {
  const url = new URL(uri);
  url.pathname = `/${name}`;
  return url.toString();
};

export const withRedisDb = (url, index) => {
  const parsed = new URL(url);
  parsed.pathname = `/${index}`;
  return parsed.toString();
};

// Loaded with `node --import` into the backend under test. Intercepts outbound
// Zarinpal calls (never contacts the real gateway) and answers with the constructed
// fixtures from backend/tests/fixtures/zarinpal. Behaviour is selected per merchant
// request via /tmp-free in-process state exposed on globalThis for the e2e driver.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../backend/tests/fixtures/zarinpal");
const fixture = (name) => JSON.parse(readFileSync(path.join(fixtures, name + ".json"), "utf8"));
const realFetch = globalThis.fetch;
let counter = 0;

globalThis.fetch = async (input, init) => {
  const url = String(input?.url || input);
  if (!/zarinpal\.com/.test(url)) return realFetch(input, init);
  const respond = ({ http = 200, body }) => new Response(JSON.stringify(body), { status: http, headers: { "content-type": "application/json" } });
  if (url.endsWith("/request.json")) {
    const response = fixture("request-success");
    counter += 1;
    response.body.data.authority = "A" + String(counter).padStart(35, "0");
    return respond(response);
  }
  if (url.endsWith("/verify.json")) return respond(fixture(process.env.E2E_VERIFY_FIXTURE || "verify-success-100"));
  return respond({ http: 404, body: { data: [], errors: { code: -1, message: "unmocked" } } });
};

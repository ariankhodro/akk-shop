import {
  getCanonicalOrigin,
  getRequestOrigin,
} from "../seo/server-utils.js";

export default function handler(req, res) {
  const method = req.method || "GET";
  if (!["GET", "HEAD"].includes(method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  let requestOrigin;
  try {
    requestOrigin = getRequestOrigin(req);
  } catch {
    return res.status(400).send("Invalid request");
  }
  const siteOrigin = getCanonicalOrigin(requestOrigin);
  const lines = [
    "User-agent: *",
    "Allow: /",
  ];
  if (siteOrigin) lines.push("Sitemap: " + siteOrigin + "/sitemap.xml");
  const body = lines.join("\n") + "\n";

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).send(method === "HEAD" ? "" : body);
}

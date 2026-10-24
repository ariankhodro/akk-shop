import app from "../app.js";

// Let Express apply its rate limiter before database-backed middleware tries to connect.
export default function handler(req, res) {
  return app(req, res);
}

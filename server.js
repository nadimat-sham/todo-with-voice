require("dotenv").config({ quiet: true });
const express = require("express");
const path = require("path");
const pool = require("./src/config/db");
const { assertAuthConfigured } = require("./src/utils/auth");
const { requireLogin } = require("./src/middleware/auth");

assertAuthConfigured();

const app = express();
// Behind a reverse proxy in production, set TRUST_PROXY to that proxy's
// address so login throttling sees each visitor's real address without
// accepting spoofed forwarded headers from direct connections.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
app.use(express.json());

// Login/logout/session-check are mounted before the gate below, so they
// always work whether or not the caller is signed in.
app.use("/api/auth", require("./src/routes/auth"));

// Every other API route needs a signed-in session. (Pages and images stay
// public — they contain no data; the app sends anyone without a session to
// /login.html as soon as its first API call comes back 401.)
app.use("/api", (req, res, next) => (req.path === "/health" ? next() : requireLogin(req, res, next)));

// Mount routes (feature routes go here)
app.use("/api/todos", require("./src/routes/todos"));

// Quick check: hits the database and confirms it responds
app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 + 1 AS result");
    res.json({ status: "ok", dbConnected: rows[0].result === 2 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Unknown /api paths get a JSON 404 instead of falling through to the pages
app.use("/api", (req, res) => res.status(404).json({ success: false, message: "Not found" }));

// In production (after `npm run build`) Express serves the built frontend
// itself; in development Vite serves it and proxies /api here instead.
app.use(express.static(path.join(__dirname, "dist")));

const PORT = Number(process.env.PORT) || 3004;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () =>
  console.log(`Server running on http://${HOST}:${PORT}`),
);

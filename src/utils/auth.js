const crypto = require("crypto");
const pool = require("../config/db");

// Accounts sign in with their own email + password (accounts table). A
// signed cookie names the account and its session_version; every password
// change bumps that version, which signs out every older session.
// Secrets in .env (never in code or git):
//   SESSION_SECRET=<long random string>      signs the session cookie
//   SMTP_*                                    the system mailbox one-time passwords are sent from

const COOKIE_NAME = "vtodo_session";
const SESSION_DAYS = 7;

// "scrypt:<salt>:<hash>" for a plain password. ":" (not "$") as separator so
// the value needs no quoting anywhere.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

// Constant-time check of a plain password against a stored hash.
function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// A one-time password to email out: 10 characters with no look-alikes
// (no 0/O, 1/l/I) so it can be typed from the mail without mistakes.
function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
}

// Session cookie value: <base64url JSON payload>.<HMAC signature>.
function createSessionToken(account) {
  const payload = Buffer.from(JSON.stringify({
    aid: account.account_id,
    sv: account.session_version,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// { aid, sv } from a genuine, unexpired token, else null
function readSessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now() || !Number.isInteger(data.aid)) return null;
    return data;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// The signed-in account (account_id, email, must_change_password,
// session_version), or null if there's no valid session — including one
// issued before the account's last password change.
async function sessionAccount(req) {
  const token = readSessionToken(readCookie(req, COOKIE_NAME));
  if (!token) return null;
  const [rows] = await pool.query(
    "SELECT account_id, email, must_change_password, session_version FROM accounts WHERE account_id = ?",
    [token.aid],
  );
  const account = rows[0];
  if (!account || account.session_version !== token.sv) return null;
  account.must_change_password = Boolean(account.must_change_password);
  return account;
}

function setSessionCookie(req, res, account) {
  // Secure only when the browser reached us over HTTPS (e.g. through the
  // production proxy) — over plain-HTTP LAN access it would never be sent back.
  const https = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie(COOKIE_NAME, createSessionToken(account), {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

// Refuses to start the server without its secrets, rather than running
// half-configured.
function assertAuthConfigured() {
  const missing = ["SESSION_SECRET", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]
    .filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")} in .env (see .env.example). Refusing to start.`);
    process.exit(1);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTemporaryPassword,
  sessionAccount,
  setSessionCookie,
  clearSessionCookie,
  assertAuthConfigured,
};

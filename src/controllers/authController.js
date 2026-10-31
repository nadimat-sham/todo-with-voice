const pool = require("../config/db");
const systemMailer = require("../config/mailer");
const {
  hashPassword, verifyPassword, generateTemporaryPassword, sessionAccount, setSessionCookie, clearSessionCookie,
} = require("../utils/auth");
const { checkGoogleMail, EmailCheckError } = require("../utils/email");

const MIN_PASSWORD_LENGTH = 8;
const OTP_MINUTES = 30;          // how long an emailed one-time password works
const OTP_COOLDOWN_SECONDS = 60; // at most one one-time password mail per account per minute
// Checked against when the email has no account, so a wrong email takes as
// long as a wrong password and the two can't be told apart by timing.
const DUMMY_HASH = hashPassword(require("crypto").randomBytes(16).toString("hex"));

// ---------- Throttling (per client address, in memory) ----------
// Wrong passwords: after MAX_FAILURES within WINDOW_MS, further attempts are
// refused until the window passes.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // address → { count, since }

function blockedFor(address) {
  const entry = failures.get(address);
  if (!entry) return 0;
  const remaining = entry.since + WINDOW_MS - Date.now();
  if (remaining <= 0) {
    failures.delete(address);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? remaining : 0;
}

function recordFailure(address) {
  const entry = failures.get(address);
  if (!entry || entry.since + WINDOW_MS < Date.now()) {
    failures.set(address, { count: 1, since: Date.now() });
  } else {
    entry.count += 1;
  }
}

const tooManyAttempts = (res, wait) => res.status(429).json({
  success: false,
  message: `Too many failed attempts — try again in ${Math.ceil(wait / 60000)} minute(s)`,
});

// Sign-up / forgot-password requests: at most MAX_OTP_REQUESTS per address
// per window, so nobody can use this server to flood inboxes.
const MAX_OTP_REQUESTS = 10;
const otpRequests = new Map(); // address → { count, since }

function otpLimited(address) {
  const entry = otpRequests.get(address);
  if (!entry || entry.since + WINDOW_MS < Date.now()) {
    otpRequests.set(address, { count: 1, since: Date.now() });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_OTP_REQUESTS;
}

// ---------- One-time passwords ----------
// Puts a fresh one-time password on the account and mails it from the
// system mailbox. If the mail can't be sent, the account is put back
// exactly as it was (or removed, if it was only just created), so nobody is
// left locked out with a password that went nowhere.
async function issueOneTimePassword(account, { isNew, reason }) {
  const password = generateTemporaryPassword();
  await pool.query(
    `UPDATE accounts SET password_hash = ?, must_change_password = TRUE,
       temp_password_expires_at = NOW() + INTERVAL ${OTP_MINUTES} MINUTE,
       last_otp_sent_at = NOW(), session_version = session_version + 1
     WHERE account_id = ?`,
    [hashPassword(password), account.account_id],
  );
  const link = process.env.APP_URL ? `\n\nSign in here: ${process.env.APP_URL.replace(/\/$/, "")}/login.html` : "";
  try {
    await systemMailer.sendMail({
      from: process.env.SMTP_FROM,
      to: account.email,
      subject: "Your one-time password — Voice Todo",
      text:
        `${reason}\n\n` +
        `Your one-time password is: ${password}\n\n` +
        `Sign in with your email and this password within ${OTP_MINUTES} minutes. ` +
        `You'll be asked to choose your own password straight away.${link}\n\n` +
        "If you didn't ask for this, ignore this email.",
    });
  } catch (err) {
    console.error("One-time password mail failed, rolling back:", err);
    if (isNew) {
      await pool.query("DELETE FROM accounts WHERE account_id = ?", [account.account_id]);
    } else {
      await pool.query(
        `UPDATE accounts SET password_hash = ?, must_change_password = ?, temp_password_expires_at = ?,
           last_otp_sent_at = ?, session_version = ? WHERE account_id = ?`,
        [account.password_hash, account.must_change_password, account.temp_password_expires_at,
          account.last_otp_sent_at, account.session_version, account.account_id],
      );
    }
    throw err;
  }
}

const ACCOUNT_COLUMNS = `account_id, email, password_hash, must_change_password, temp_password_expires_at,
  last_otp_sent_at, session_version, last_login_at,
  TIMESTAMPDIFF(SECOND, last_otp_sent_at, NOW()) AS otp_age_seconds`;

async function findAccount(email) {
  const [rows] = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email = ?`, [email]);
  return rows[0];
}

const coolingDown = (account) => account.otp_age_seconds !== null && account.otp_age_seconds < OTP_COOLDOWN_SECONDS;

// POST /api/auth/signup — { email }. Creates the account and mails it a
// one-time password. Only Google addresses can sign up. An email that started signing up but never signed in can sign
// up again (a fresh password is sent); a used one is refused.
exports.signup = async (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!email) return res.status(400).json({ success: false, message: "Email address is required" });
  if (otpLimited(req.ip)) {
    return res.status(429).json({ success: false, message: "Too many requests — try again in a few minutes" });
  }

  try {
    await checkGoogleMail(email);
    let account = await findAccount(email);
    if (account && account.last_login_at) {
      return res.status(409).json({
        success: false,
        message: "An account already exists for this email — sign in, or use Forgot password",
      });
    }
    if (account && coolingDown(account)) {
      return res.status(429).json({
        success: false,
        message: `A one-time password was just sent — check your inbox, or try again in ${OTP_COOLDOWN_SECONDS - account.otp_age_seconds} seconds`,
      });
    }
    const isNew = !account;
    if (isNew) {
      // Unusable until the one-time password replaces it
      const [result] = await pool.query(
        "INSERT INTO accounts (email, password_hash) VALUES (?, ?)",
        [email, DUMMY_HASH],
      );
      account = await findAccount(email);
      account.account_id = result.insertId;
    }
    await issueOneTimePassword(account, { isNew, reason: "Welcome to Voice Todo!" });
    res.status(201).json({
      success: true,
      message: `A one-time password has been sent to ${email}. Sign in with it within ${OTP_MINUTES} minutes.`,
    });
  } catch (err) {
    if (err instanceof EmailCheckError) return res.status(err.status).json({ success: false, message: err.message });
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "An account already exists for this email — sign in, or use Forgot password" });
    }
    console.error(err);
    res.status(502).json({ success: false, message: "Couldn't send the email right now — try again in a moment" });
  }
};

// POST /api/auth/forgot-password — { email }. Mails a fresh one-time
// password. The reply is the same whether or not the account exists, so this
// can't be used to find out who has signed up.
exports.forgotPassword = async (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!email) return res.status(400).json({ success: false, message: "Email address is required" });
  if (otpLimited(req.ip)) {
    return res.status(429).json({ success: false, message: "Too many requests — try again in a few minutes" });
  }
  const message = `If an account exists for ${email}, a one-time password has been sent to it. It works for ${OTP_MINUTES} minutes.`;

  try {
    const account = await findAccount(email);
    // Unknown, or one was sent moments ago (that mail is still good)
    if (!account || coolingDown(account)) return res.json({ success: true, message });
    await issueOneTimePassword(account, { isNew: false, reason: "A new password was requested for your account." });
    res.json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(502).json({ success: false, message: "Couldn't send the email right now — try again in a moment" });
  }
};

// POST /api/auth/login — { email, password }
exports.login = async (req, res) => {
  const address = req.ip;
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }
  // Checked before the password, so a locked-out address learns nothing —
  // otherwise a right guess (200) would still stand out from wrong ones (429).
  const wait = blockedFor(address);
  if (wait) return tooManyAttempts(res, wait);

  try {
    const account = await findAccount(email);
    // Always run the (slow) password check, so a wrong email and a wrong
    // password take the same time.
    const matches = verifyPassword(password, account ? account.password_hash : DUMMY_HASH);

    // Correct credentials (before any lockout) clear earlier typing mistakes.
    if (account && matches) {
      const [[{ expired }]] = await pool.query(
        "SELECT temp_password_expires_at IS NOT NULL AND temp_password_expires_at < NOW() AS expired FROM accounts WHERE account_id = ?",
        [account.account_id],
      );
      if (account.must_change_password && expired) {
        return res.status(401).json({
          success: false,
          message: "That one-time password has expired — use Forgot password to get a new one",
        });
      }
      failures.delete(address);
      await pool.query("UPDATE accounts SET last_login_at = NOW() WHERE account_id = ?", [account.account_id]);
      setSessionCookie(req, res, account);
      return res.json({
        success: true,
        data: { email: account.email, mustChangePassword: Boolean(account.must_change_password) },
      });
    }

    recordFailure(address);
    // A likelier explanation than a typo right after a reset/sign-up: they're
    // typing an old password instead of the one in their inbox.
    if (account && account.must_change_password) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password — sign in with the one-time password from your email",
      });
    }
    res.status(401).json({ success: false, message: "Incorrect email or password" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/change-password — { current_password?, new_password }.
// Right after signing in with a one-time password the current one isn't
// asked for again (signing in just proved it). Signs out every other
// browser; this one gets a fresh cookie and stays signed in.
exports.changePassword = async (req, res) => {
  const address = req.ip;
  try {
    const account = await sessionAccount(req);
    if (!account) return res.status(401).json({ success: false, message: "Not logged in" });
    const current = String(req.body?.current_password || "");
    const next = String(req.body?.new_password || "");

    const wait = blockedFor(address);
    if (wait) return tooManyAttempts(res, wait);
    if (next.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ success: false, message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (next.length > 200) return res.status(400).json({ success: false, message: "New password can be at most 200 characters" });

    const [[{ password_hash: storedHash }]] = await pool.query(
      "SELECT password_hash FROM accounts WHERE account_id = ?",
      [account.account_id],
    );
    if (!account.must_change_password) {
      if (!current) return res.status(400).json({ success: false, message: "Current password is required" });
      if (!verifyPassword(current, storedHash)) {
        recordFailure(address);
        return res.status(400).json({ success: false, message: "Current password is incorrect" });
      }
    }
    if (verifyPassword(next, storedHash)) {
      return res.status(400).json({ success: false, message: "New password must be different from the current one" });
    }

    failures.delete(address);
    await pool.query(
      `UPDATE accounts SET password_hash = ?, must_change_password = FALSE, temp_password_expires_at = NULL,
         session_version = session_version + 1 WHERE account_id = ?`,
      [hashPassword(next), account.account_id],
    );
    account.session_version += 1;
    setSessionCookie(req, res, account);
    res.json({ success: true, message: "Password changed — other browsers have been signed out" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/logout
exports.logout = (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true, message: "Logged out" });
};

// GET /api/auth/session — who is signed in (401 if nobody) and whether they
// still have to choose a password
exports.session = async (req, res) => {
  try {
    const account = await sessionAccount(req);
    if (!account) return res.status(401).json({ success: false, message: "Not logged in" });
    res.json({
      success: true,
      data: { email: account.email, mustChangePassword: account.must_change_password },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

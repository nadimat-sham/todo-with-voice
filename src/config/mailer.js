require("dotenv").config({ quiet: true });
const nodemailer = require("nodemailer");

// The system mailbox: sends sign-up and forgot-password one-time passwords
// (SMTP_* in .env, a Google account + App Password — see DEPLOYMENT.md).
const transporter = nodemailer.createTransport({
  // Reuse one signed-in connection across a whole batch instead of logging
  // in again for every recipient
  pool: true,
  maxConnections: 1,
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  // true = TLS from the first byte (port 465); false = STARTTLS (port 587)
  secure: process.env.SMTP_SECURE !== "false",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

module.exports = transporter;

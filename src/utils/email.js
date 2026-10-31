const { Resolver } = require("dns").promises;

// One "@", something before it, and a dotted domain after it with no spaces —
// strict enough to catch typos, loose enough for every real address.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

const resolver = new Resolver({ timeout: 4000, tries: 2 });

// Thrown when the address can't be accepted; `status` is the HTTP code to send.
class EmailCheckError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Resolves (to its MX records) if the address is well-formed and its domain can receive mail
// (has an MX record that isn't a "null MX" — RFC 7505). Domains with only an
// A record are refused on purpose: nearly every real mail domain publishes MX,
// and look-alike typo domains (gmial.com) usually don't. This can't prove the
// mailbox itself exists — only sending to it can.
async function checkDeliverable(email) {
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new EmailCheckError(400, `"${email}" is not a valid email address`);
  }
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  let records;
  try {
    records = await resolver.resolveMx(domain);
  } catch (err) {
    if (err.code === "ENOTFOUND") {
      throw new EmailCheckError(400, `The domain "${domain}" doesn't exist — check the address for typos`);
    }
    if (err.code === "ENODATA") {
      throw new EmailCheckError(400, `"${domain}" has no mail server, so it can't receive email — check the address for typos`);
    }
    // Timeouts, DNS server failures: say so rather than blaming the address
    console.error(err);
    throw new EmailCheckError(503, `Couldn't check "${domain}" right now (DNS lookup failed) — try again in a moment`);
  }
  if (!records.some((r) => r.exchange && r.exchange !== ".")) {
    throw new EmailCheckError(400, `"${domain}" doesn't accept email`);
  }
  return records;
}

// Resolves if the address can receive mail AND its mail is handled by
// Google — Gmail itself, or a Google Workspace domain. Only those can sign up.
async function checkGoogleMail(email) {
  const records = await checkDeliverable(email);
  const google = records.some((r) => /(^|\.)(google|googlemail)\.com\.?$/i.test(r.exchange));
  if (!google) {
    throw new EmailCheckError(400, "Only Google email addresses (Gmail or Google Workspace) can be used to sign up");
  }
}

module.exports = { checkDeliverable, checkGoogleMail, EmailCheckError };

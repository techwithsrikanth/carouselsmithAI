/**
 * Signup-time address checks. Verification by emailed code is the real gate; these rules just
 * reject addresses that can never represent a real user, before a code is ever sent.
 */

// Throwaway inbox providers. Not exhaustive by design: the OTP is what actually enforces
// ownership, this only avoids burning sends on addresses that are disposable by definition.
const disposableDomains = new Set([
  "0-mail.com",
  "10minutemail.com",
  "20minutemail.com",
  "33mail.com",
  "anonbox.net",
  "dispostable.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "inboxbear.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
  "yopmail.net"
]);

// Deliberately conservative: one @, no whitespace, a dotted domain with a real TLD.
const emailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

export function emailDomain(value = "") {
  return normalizeEmail(value).split("@")[1] || "";
}

export function isDisposableEmail(value = "") {
  return disposableDomains.has(emailDomain(value));
}

/**
 * Returns { ok } or { ok: false, reason } with a message safe to show the user.
 */
export function validateSignupEmail(value = "") {
  const email = normalizeEmail(value);
  if (!email) return { ok: false, reason: "Enter your email address." };
  if (email.length > 254) return { ok: false, reason: "That email address is too long." };
  if (!emailPattern.test(email)) return { ok: false, reason: "Enter a valid email address." };
  if (isDisposableEmail(email)) {
    return { ok: false, reason: "Disposable email addresses are not accepted. Use a permanent address." };
  }
  return { ok: true, email };
}

export function validatePassword(value = "") {
  const password = String(value || "");
  if (password.length < 8) return { ok: false, reason: "Use a password with at least 8 characters." };
  if (password.length > 200) return { ok: false, reason: "That password is too long." };
  return { ok: true, password };
}

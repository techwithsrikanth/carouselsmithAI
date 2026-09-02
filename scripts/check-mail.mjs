/**
 * Verifies SMTP credentials without going through a signup.
 *
 *   npm run mail:check                 # connect and authenticate only
 *   npm run mail:check you@example.com # also send a real test email
 */
import { getConfig } from "../src/server/config.js";
import { createMailer } from "../src/server/email/mailer.js";

const config = getConfig();
const recipient = process.argv[2];

if (!config.smtp.host) {
  console.log("SMTP_HOST is not set, so codes are printed to the server console instead of emailed.");
  console.log("Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM in .env to send real email.");
  process.exit(1);
}

console.log(`host   : ${config.smtp.host}:${config.smtp.port}`);
console.log(`user   : ${config.smtp.user || "(none)"}`);
console.log(`from   : ${config.mailFrom || "(unset)"}`);
console.log(`secure : ${config.smtp.secure ?? config.smtp.port === 465}`);

const mailer = await createMailer(config);

try {
  await mailer.verify?.();
  console.log("\nconnection + authentication: OK");
} catch (error) {
  console.error("\nconnection + authentication: FAILED");
  console.error(error.message);
  if (/invalid login|username and password not accepted|535/i.test(error.message)) {
    console.error("\nGmail rejects normal account passwords. Use a 16-character App Password from");
    console.error("https://myaccount.google.com/apppasswords (2-Step Verification must be on).");
  }
  process.exit(1);
}

if (!recipient) {
  console.log("\nPass an address to also send a test message: npm run mail:check you@example.com");
  process.exit(0);
}

const delivery = await mailer.sendOtp({ to: recipient, code: "123456", ttlMs: 10 * 60 * 1000 });
console.log(`test email sent to ${recipient} (transport: ${delivery.transport})`);
console.log("If it does not arrive, check the spam folder and that MAIL_FROM matches SMTP_USER.");

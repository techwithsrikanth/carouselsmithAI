/**
 * Email delivery. Uses SMTP when it is configured; otherwise falls back to a console
 * transport so local development and tests work without credentials. The fallback logs the
 * code to the server output and is refused in production, where a silently undelivered
 * verification code would lock every new user out.
 */

function otpEmail({ code, minutes, appName }) {
  const subject = `${code} is your ${appName} verification code`;
  const text = [
    `Your ${appName} verification code is ${code}.`,
    "",
    `It expires in ${minutes} minutes and can be used once.`,
    "If you did not request this, you can ignore this email."
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111315">
  <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7b7064">${appName}</p>
  <h1 style="margin:0 0 20px;font-size:22px;font-weight:800">Confirm your email</h1>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Enter this code to finish creating your account.</p>
  <p style="margin:0 0 20px;font-size:34px;font-weight:800;letter-spacing:.28em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</p>
  <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6459">It expires in ${minutes} minutes and can be used once.<br/>If you did not request this, you can ignore this email.</p>
</div>`;
  return { subject, text, html };
}

function createConsoleTransport({ isProduction }) {
  if (isProduction) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD and MAIL_FROM, otherwise verification codes cannot be delivered."
    );
  }
  return {
    kind: "console",
    async send({ to, subject, text }) {
      console.log(`\n[email:console] to=${to}\n[email:console] ${subject}\n${text}\n`);
      return { delivered: false, transport: "console" };
    }
  };
}

async function createSmtpTransport(config) {
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // Port 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: config.smtp.secure ?? config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined
  });
  return {
    kind: "smtp",
    async send({ to, subject, text, html }) {
      await transporter.sendMail({ from: config.mailFrom, to, subject, text, html });
      return { delivered: true, transport: "smtp" };
    },
    async verify() {
      await transporter.verify();
    }
  };
}

export async function createMailer(config) {
  const transport = config.smtp?.host
    ? await createSmtpTransport(config)
    : createConsoleTransport({ isProduction: config.isProduction });
  return {
    kind: transport.kind,
    verify: transport.verify?.bind(transport),
    async sendOtp({ to, code, ttlMs }) {
      const message = otpEmail({
        code,
        minutes: Math.round(ttlMs / 60000),
        appName: config.appName || "Carouselsmith AI"
      });
      return transport.send({ to, ...message });
    }
  };
}

import crypto from "node:crypto";

export const OTP_PURPOSE = { SIGNUP: "signup" };

export const otpPolicy = {
  digits: 6,
  ttlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  // Throttling: one code per minute, and a hard ceiling per address per hour.
  resendCooldownMs: 60 * 1000,
  maxSendsPerHour: 5
};

export function generateCode(digits = otpPolicy.digits) {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
}

/**
 * Codes are never stored in readable form. The hash is peppered with the server secret and
 * bound to the address and purpose, so a stored hash cannot be replayed for another account.
 */
export function hashCode({ code, email, purpose, secret }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${String(email).toLowerCase()}:${purpose}:${code}`)
    .digest("base64url");
}

function equal(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createOtpService({ repos, secret, policy = otpPolicy, now = () => Date.now() }) {
  return {
    policy,

    /**
     * Issues a fresh code, invalidating any earlier unused code for the same address and
     * purpose so only one code is ever live. Returns the plain code for delivery only.
     */
    async issue({ email, purpose }) {
      const address = String(email).toLowerCase().trim();
      const issuedAt = now();
      const recent = await repos.emailOtps.recentFor(address, purpose, issuedAt - 60 * 60 * 1000);
      const lastSentAt = recent[0]?.created_at_ms ?? 0;
      if (issuedAt - lastSentAt < policy.resendCooldownMs) {
        const waitSeconds = Math.ceil((policy.resendCooldownMs - (issuedAt - lastSentAt)) / 1000);
        const error = new Error(`Please wait ${waitSeconds}s before requesting another code.`);
        error.status = 429;
        throw error;
      }
      if (recent.length >= policy.maxSendsPerHour) {
        const error = new Error("Too many codes requested for this email. Try again later.");
        error.status = 429;
        throw error;
      }
      const code = generateCode(policy.digits);
      await repos.emailOtps.invalidateActive(address, purpose, issuedAt);
      await repos.emailOtps.create({
        email: address,
        purpose,
        codeHash: hashCode({ code, email: address, purpose, secret }),
        createdAtMs: issuedAt,
        expiresAtMs: issuedAt + policy.ttlMs
      });
      return { code, expiresAtMs: issuedAt + policy.ttlMs };
    },

    /**
     * Consumes a code. Every failure path burns an attempt so a code cannot be brute forced,
     * and a used code can never be replayed.
     */
    async verify({ email, purpose, code }) {
      const address = String(email).toLowerCase().trim();
      const submitted = String(code || "").trim();
      const checkedAt = now();
      const record = await repos.emailOtps.findActive(address, purpose);
      if (!record) return { ok: false, reason: "No active code. Request a new one." };
      if (record.expires_at_ms <= checkedAt) {
        await repos.emailOtps.consume(record.id, checkedAt);
        return { ok: false, reason: "That code has expired. Request a new one." };
      }
      if (record.attempts >= policy.maxAttempts) {
        await repos.emailOtps.consume(record.id, checkedAt);
        return { ok: false, reason: "Too many incorrect attempts. Request a new code." };
      }
      if (!equal(record.code_hash, hashCode({ code: submitted, email: address, purpose, secret }))) {
        await repos.emailOtps.recordAttempt(record.id);
        const left = policy.maxAttempts - (record.attempts + 1);
        return { ok: false, reason: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Request a new code." };
      }
      await repos.emailOtps.consume(record.id, checkedAt);
      return { ok: true };
    }
  };
}

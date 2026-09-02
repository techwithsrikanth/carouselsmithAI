import crypto from "node:crypto";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)));
  });
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const [, salt, expected] = stored.split("$");
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => (error ? reject(error) : resolve(derivedKey.toString("base64url"))));
  });
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function issueToken(user, secret, now = Date.now()) {
  const payload = b64url(JSON.stringify({ sub: user.id, email: user.email, exp: now + TOKEN_TTL_MS }));
  return `${payload}.${signPayload(secret, payload)}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || signPayload(secret, payload) !== signature) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data.exp || data.exp < now) return null;
  return data;
}

export function authMiddleware(repos, secret) {
  return async (req, res, next) => {
    try {
      const header = req.get("authorization") || "";
      const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
      const payload = verifyToken(token, secret);
      if (!payload) return res.status(401).json({ error: "Authentication required" });
      const user = await repos.users.findById(payload.sub);
      if (!user) return res.status(401).json({ error: "Authentication required" });
      // Defence in depth: tokens are only issued after verification, but a token minted
      // before that rule existed must not keep an unverified account alive.
      if (!user.email_verified) {
        return res.status(403).json({ error: "Confirm your email address to continue.", status: "verification_required", email: user.email });
      }
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

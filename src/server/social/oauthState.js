import crypto from "node:crypto";

function hmac(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signOAuthState(data, secret) {
  const payload = Buffer.from(JSON.stringify({ ...data, nonce: crypto.randomUUID() })).toString("base64url");
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifyOAuthState(state, secret) {
  const [payload, signature] = String(state || "").split(".");
  if (!payload || hmac(secret, payload) !== signature) return null;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

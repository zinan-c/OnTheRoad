// @ts-nocheck
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function randomValue(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function signPayload(payload, key) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key.secret)
    .update(`${key.id}.${encoded}`)
    .digest("base64url");
  return `${key.id}.${encoded}.${signature}`;
}

export function verifyPayload(token, keys) {
  const [keyId, encoded, suppliedSignature, extra] = token.split(".");
  if (!keyId || !encoded || !suppliedSignature || extra) return undefined;
  const key = keys.find((candidate) => candidate?.id === keyId);
  if (!key) return undefined;
  const expected = createHmac("sha256", key.secret)
    .update(`${key.id}.${encoded}`)
    .digest();
  let supplied;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return undefined;
  }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** @param {unknown} key @param {string} field */
function validateKey(key, field) {
  const candidate = key && typeof key === "object" && !Array.isArray(key)
    ? /** @type {Record<string, unknown>} */ (key)
    : {};
  if (
    typeof candidate.id !== "string"
    || !candidate.id.trim()
    || typeof candidate.secret !== "string"
    || candidate.secret.length < 32
  ) {
    throw new TypeError(`${field} must contain an id and a secret of at least 32 characters`);
  }
  return { id: candidate.id.trim(), secret: candidate.secret };
}

/** @param {string} secret */
function keyBytes(secret) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export class ItineraryCipher {
  /** @param {{activeKey: unknown, previousKeys?: unknown[]}} options */
  constructor({ activeKey, previousKeys = [] }) {
    this.activeKey = validateKey(activeKey, "activeKey");
    /** @type {Map<string, {id: string, secret: string}>} */
    this.keys = new Map([
      [this.activeKey.id, this.activeKey],
      ...previousKeys.map((key) => {
        const validated = validateKey(key, "previousKey");
        return /** @type {[string, {id: string, secret: string}]} */ (
          [validated.id, validated]
        );
      }),
    ]);
  }

  /** @param {unknown} value @param {string} context */
  encrypt(value, context) {
    if (value === undefined || value === null) {
      return { ciphertext: null, keyVersion: null };
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      keyBytes(this.activeKey.secret),
      nonce,
    );
    cipher.setAAD(Buffer.from(context, "utf8"));
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([nonce, tag, encrypted]).toString("base64"),
      keyVersion: this.activeKey.id,
    };
  }

  /** @param {string | null | undefined} ciphertext @param {string} keyVersion @param {string} context */
  decrypt(ciphertext, keyVersion, context) {
    if (ciphertext === undefined || ciphertext === null) return null;
    const key = this.keys.get(keyVersion);
    if (!key) {
      throw new Error(`Unknown itinerary encryption key version: ${keyVersion}`);
    }
    const payload = Buffer.from(ciphertext, "base64");
    if (payload.length < 29) throw new Error("Invalid itinerary ciphertext");
    const nonce = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(key.secret), nonce);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext);
  }
}

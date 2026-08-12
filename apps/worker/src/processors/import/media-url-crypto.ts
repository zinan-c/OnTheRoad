import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(secret: string): Buffer {
  if (secret.trim().length < 16) {
    throw new TypeError("Import media encryption secret is too short");
  }
  return createHash("sha256").update(secret).digest();
}

export type EncryptedImportMediaUrl = Readonly<{
  ciphertext: Buffer;
  keyVersion: string;
}>;

export function encryptImportMediaUrl(
  value: string,
  secret: string,
  keyVersion = "runtime-v1",
): EncryptedImportMediaUrl {
  if (!/^https?:\/\//iu.test(value)) {
    throw new TypeError("Import media URL must use http or https");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
    keyVersion,
  };
}

export function decryptImportMediaUrl(value: Uint8Array, secret: string): string {
  const payload = Buffer.from(value);
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new TypeError("Import media URL ciphertext is invalid");
  }
  const decipher = createDecipheriv(ALGORITHM, key(secret), payload.subarray(0, IV_BYTES));
  decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

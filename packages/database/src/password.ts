import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

/**
 * Encoded scrypt password hashes are self-describing so future parameter
 * changes can be introduced without making old accounts unverifiable.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 10) {
    throw new Error("Password must contain at least 10 characters.");
  }
  const salt = randomBytes(16);
  const derived = await derive(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const cost = parsePositiveInteger(parts[1]);
  const blockSize = parsePositiveInteger(parts[2]);
  const parallelization = parsePositiveInteger(parts[3]);
  if (!cost || !blockSize || !parallelization) return false;
  try {
    const salt = Buffer.from(parts[4] ?? "", "base64url");
    const expected = Buffer.from(parts[5] ?? "", "base64url");
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, salt, cost, blockSize, parallelization);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelization, maxmem: MAX_MEMORY },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

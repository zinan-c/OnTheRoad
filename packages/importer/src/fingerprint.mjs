import { createHash } from "node:crypto";

/** @param {unknown} value @returns {any} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const object = /** @type {Record<string, unknown>} */ (value);
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonical(object[key])]));
}

/** @param {unknown} value */
export function stableJson(value) {
  return JSON.stringify(canonical(value));
}

/** @param {unknown} value */
export function stableHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/** @param {Record<string, unknown>} mapping */
export function mappingHash(mapping) {
  return stableHash(mapping);
}

/** @param {string} sheetName @param {number} rowNumber */
export function stableSourceRowKey(sheetName, rowNumber) {
  if (!sheetName.trim() || !Number.isInteger(rowNumber) || rowNumber < 1) {
    throw new RangeError("sheetName and a positive integer rowNumber are required");
  }
  return `${sheetName.trim()}:${rowNumber}`;
}

/** @param {Record<string, unknown>} normalized */
export function stableFingerprint(normalized) {
  return stableHash(normalized);
}

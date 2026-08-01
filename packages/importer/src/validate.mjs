import { currencies, costCategories, transportModes } from "@on-the-road/config/reference-data";

const currencyCodes = new Set(currencies.map(({ code }) => code));
const categoryCodes = new Set(costCategories.map(({ code }) => code));
const modeCodes = new Set(transportModes.map(({ code }) => code));

/** @typedef {{code: string, field: string, message: string}} ImportIssue */
/** @typedef {{target: string|null, description: string|null, day: number|null, durationMinutes: number|null, cost: number|null, currency: string|null, costCategory: string|null, mode: string|null, latitude: number|null, longitude: number|null, imageUrls: string[]}} NormalizedRow */

/** @param {NormalizedRow} row @returns {ImportIssue[]} */
export function validateNormalizedRow(row) {
  /** @type {ImportIssue[]} */
  const issues = [];
  if (!row.target && !row.description) issues.push({ code: "TARGET_REQUIRED", field: "target", message: "target or description is required" });
  if (row.day !== null && (!Number.isInteger(row.day) || row.day < 1)) issues.push({ code: "DAY_INVALID", field: "day", message: "day must be a positive integer" });
  if (row.durationMinutes !== null && (row.durationMinutes < 0 || !Number.isFinite(row.durationMinutes))) issues.push({ code: "DURATION_INVALID", field: "durationMinutes", message: "duration must be non-negative" });
  if (row.cost !== null && (row.cost < 0 || !Number.isFinite(row.cost))) issues.push({ code: "COST_INVALID", field: "cost", message: "cost must be non-negative" });
  if (row.cost !== null && !row.currency) issues.push({ code: "CURRENCY_REQUIRED", field: "currency", message: "currency is required when cost is present" });
  if (row.currency && !currencyCodes.has(row.currency)) issues.push({ code: "CURRENCY_UNSUPPORTED", field: "currency", message: "currency is not in reference data" });
  if (row.costCategory && !categoryCodes.has(row.costCategory)) issues.push({ code: "COST_CATEGORY_UNSUPPORTED", field: "costCategory", message: "cost category is not in reference data" });
  if (row.mode && !modeCodes.has(row.mode)) issues.push({ code: "MODE_UNSUPPORTED", field: "mode", message: "transport mode is not in reference data" });
  if (row.latitude !== null && (row.latitude < -90 || row.latitude > 90)) issues.push({ code: "LATITUDE_INVALID", field: "latitude", message: "latitude must be between -90 and 90" });
  if (row.longitude !== null && (row.longitude < -180 || row.longitude > 180)) issues.push({ code: "LONGITUDE_INVALID", field: "longitude", message: "longitude must be between -180 and 180" });
  if ((row.latitude === null) !== (row.longitude === null)) issues.push({ code: "COORDINATES_INCOMPLETE", field: "latitude", message: "latitude and longitude must be provided together" });
  for (const url of row.imageUrls ?? []) {
    if (!/^https?:\/\//iu.test(url)) issues.push({ code: "IMAGE_URL_INVALID", field: "imageUrls", message: "image URL must use http or https" });
  }
  return issues;
}

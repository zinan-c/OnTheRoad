import {
  costCategories,
  currencies,
  transportModes,
} from "@on-the-road/config/reference-data";
import {
  canonicalColumn,
  normalizeCurrencyAlias,
  safeSpreadsheetText,
} from "./aliases.mjs";

export const IMPORT_RULE_VERSION = "1.0.0";

const currencyCodes = new Set(currencies.map(({ code }) => code));
const categoryCodes = new Set(costCategories.map(({ code }) => code));
const modeAliases = new Map(transportModes.flatMap((/** @type {any} */ mode) => [
  [mode.code.toLocaleLowerCase("en-US"), mode.code],
  ...mode.aliases.map((/** @type {string} */ alias) => [alias.toLocaleLowerCase("en-US"), mode.code]),
]));

/** @param {unknown} value */
function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

/** @param {unknown} value */
function number(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const result = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(result) ? result : null;
}

/** @param {unknown} value */
function date(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const result = text(value);
  if (!result) return null;
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u.exec(result);
  return match ? `${match[1] ?? ""}-${(match[2] ?? "").padStart(2, "0")}-${(match[3] ?? "").padStart(2, "0")}` : result;
}

/** @param {Record<string, unknown>} raw @param {Record<string, string>} mapping @param {string} column */
function mappedValue(raw, mapping, column) {
  const source = mapping?.[column] ?? column;
  if (raw[source] !== undefined) return raw[source];
  const matchingKey = Object.keys(raw).find((key) => canonicalColumn(key) === column);
  return matchingKey === undefined ? undefined : raw[matchingKey];
}

/** @param {Record<string, unknown>} raw @param {Record<string, string>} [mapping] @returns {Record<string, any>} */
export function normalizeImportRow(raw, mapping = {}) {
  const imageValue = text(mappedValue(raw, mapping, "ImageURLs"));
  const modeValue = text(mappedValue(raw, mapping, "Mode"));
  const currencyValue = String(normalizeCurrencyAlias(text(mappedValue(raw, mapping, "Currency")) ?? ""));
  const categoryValue = text(mappedValue(raw, mapping, "CostCategory"));
  const normalized = {
    day: number(mappedValue(raw, mapping, "Day")),
    date: date(mappedValue(raw, mapping, "Date")),
    dayOfWeek: text(mappedValue(raw, mapping, "DayOfWeek")),
    isWorkday: text(mappedValue(raw, mapping, "IsWorkday")),
    place: text(mappedValue(raw, mapping, "Place")),
    time: text(mappedValue(raw, mapping, "Time")),
    target: text(mappedValue(raw, mapping, "Target")),
    externalSource: text(mappedValue(raw, mapping, "ExternalSource")),
    externalId: text(mappedValue(raw, mapping, "ExternalId")),
    description: text(mappedValue(raw, mapping, "Desc")),
    hotel: text(mappedValue(raw, mapping, "Hotel")),
    dining: text(mappedValue(raw, mapping, "Dining")),
    durationMinutes: number(mappedValue(raw, mapping, "Duration")),
    mode: modeAliases.get(modeValue?.toLocaleLowerCase("en-US")) ?? modeValue,
    startLocation: text(mappedValue(raw, mapping, "StartLocation")),
    endLocation: text(mappedValue(raw, mapping, "EndLocation")),
    cost: number(mappedValue(raw, mapping, "Cost")),
    currency: currencyCodes.has(currencyValue) ? currencyValue : currencyValue || null,
    costCategory: categoryCodes.has(categoryValue ?? "") ? categoryValue : categoryValue || null,
    remark: text(mappedValue(raw, mapping, "Remark")),
    address: text(mappedValue(raw, mapping, "Address")),
    latitude: number(mappedValue(raw, mapping, "Latitude")),
    longitude: number(mappedValue(raw, mapping, "Longitude")),
    imageUrls: imageValue ? imageValue.split(/[\n,;]/u).map((value) => value.trim()).filter(Boolean) : [],
    ruleVersion: IMPORT_RULE_VERSION,
  };
  return JSON.parse(JSON.stringify(normalized, (_, value) => typeof value === "string" ? safeSpreadsheetText(value) : value));
}

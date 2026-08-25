import { createHash } from "node:crypto";
import { currencies, normalizeCurrencyCode } from "@on-the-road/config/reference-data";

export * from "./date-range.mjs";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/u;
const MAP_PROFILES = new Set(["cn_primary", "international_primary", "hybrid"]);
const TRIP_CREATE_STATUSES = new Set(["draft", "active"]);

export class TripValidationError extends Error {
  /** @param {string} field @param {string} message */
  constructor(field, message) {
    super(message);
    this.name = "TripValidationError";
    this.code = "TRIP_VALIDATION_FAILED";
    this.status = 422;
    this.field = field;
  }
}

export class TripNotFoundError extends Error {
  constructor() {
    super("Trip not found");
    this.name = "TripNotFoundError";
    this.code = "TRIP_NOT_FOUND";
    this.status = 404;
  }
}

export class TripVersionConflictError extends Error {
  constructor() {
    super("Trip version does not match If-Match");
    this.name = "TripVersionConflictError";
    this.code = "VERSION_CONFLICT";
    this.status = 409;
  }
}

export class TripTransitionError extends Error {
  constructor() {
    super("Trip lifecycle transition is not allowed");
    this.name = "TripTransitionError";
    this.code = "INVALID_TRIP_TRANSITION";
    this.status = 409;
  }
}

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super("Idempotency key was already used for a different request");
    this.name = "IdempotencyKeyReusedError";
    this.code = "IDEMPOTENCY_KEY_REUSED";
    this.status = 409;
  }
}

/** @param {unknown} value @param {string} field @param {number} maxLength */
function requiredString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new TripValidationError(field, `${field} must contain 1 to ${maxLength} characters`);
  }
  return value.trim();
}

/** @param {unknown} value @param {string} field @param {number} maxLength */
function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field, maxLength);
}

/** @param {unknown} value @param {string} field */
function localDate(value, field) {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) {
    throw new TripValidationError(field, `${field} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TripValidationError(field, `${field} is not a calendar date`);
  }
  return value;
}

/** @param {unknown} value */
function timezone(value) {
  const normalized = requiredString(value, "timezone", 255);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new TripValidationError("timezone", "timezone must be a supported IANA time zone");
  }
  return normalized;
}

/** @param {unknown} value */
function budget(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !MONEY_PATTERN.test(value)) {
    throw new TripValidationError("budget", "budget must be a non-negative decimal with at most 2 places");
  }
  return `${value.includes(".") ? value.padEnd(value.indexOf(".") + 3, "0") : `${value}.00`}`;
}

/** @param {unknown} value */
function destinations(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TripValidationError("destinations", "destinations must contain 1 to 100 entries");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TripValidationError(`destinations.${index}`, "destination must be an object");
    }
    const candidate = /** @type {Record<string, unknown>} */ (entry);
    const countryCode = optionalString(candidate.countryCode, `destinations.${index}.countryCode`, 2);
    if (countryCode && !COUNTRY_PATTERN.test(countryCode)) {
      throw new TripValidationError(
        `destinations.${index}.countryCode`,
        "countryCode must be two uppercase letters",
      );
    }
    return {
      name: requiredString(candidate.name, `destinations.${index}.name`, 160),
      ...(countryCode ? { countryCode } : {}),
      ...(optionalString(candidate.city, `destinations.${index}.city`, 160)
        ? { city: optionalString(candidate.city, `destinations.${index}.city`, 160) }
        : {}),
      ...(optionalString(candidate.region, `destinations.${index}.region`, 160)
        ? { region: optionalString(candidate.region, `destinations.${index}.region`, 160) }
        : {}),
    };
  });
}

/** @param {unknown} input */
export function normalizeTripInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TripValidationError("body", "trip input must be an object");
  }
  const candidate = /** @type {Record<string, unknown>} */ (input);
  const startDate = localDate(candidate.startDate, "startDate");
  const endDate = localDate(candidate.endDate, "endDate");
  if (endDate < startDate) {
    throw new TripValidationError("endDate", "endDate must be on or after startDate");
  }
  if (
    typeof candidate.travelers !== "number"
    || !Number.isInteger(candidate.travelers)
    || candidate.travelers < 1
    || candidate.travelers > 999
  ) {
    throw new TripValidationError("travelers", "travelers must be an integer from 1 to 999");
  }
  const defaultCurrency = normalizeCurrencyCode(
    requiredString(candidate.defaultCurrency, "defaultCurrency", 3),
  );
  if (!currencies.some(({ code }) => code === defaultCurrency)) {
    throw new TripValidationError("defaultCurrency", "defaultCurrency is unsupported");
  }
  const mapProfile = requiredString(candidate.mapProfile, "mapProfile", 64);
  if (!MAP_PROFILES.has(mapProfile)) {
    throw new TripValidationError("mapProfile", "mapProfile is unsupported");
  }
  const status = candidate.status ?? "active";
  if (typeof status !== "string" || !TRIP_CREATE_STATUSES.has(status)) {
    throw new TripValidationError("status", "status must be draft or active");
  }
  return {
    name: requiredString(candidate.name, "name", 160),
    startDate,
    endDate,
    travelers: candidate.travelers,
    defaultCurrency,
    ...(budget(candidate.budget) ? { budget: budget(candidate.budget) } : {}),
    timezone: timezone(candidate.timezone),
    mapProfile,
    status,
    ...(optionalString(candidate.description, "description", 5000)
      ? { description: optionalString(candidate.description, "description", 5000) }
      : {}),
    destinations: destinations(candidate.destinations),
  };
}

/** @param {unknown} patch */
export function normalizeTripPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TripValidationError("body", "trip patch must be an object");
  }
  const allowed = new Set([
    "name", "startDate", "endDate", "travelers", "defaultCurrency",
    "budget", "timezone", "mapProfile", "description", "destinations",
  ]);
  const candidate = /** @type {Record<string, unknown>} */ (patch);
  const unexpected = Object.keys(candidate).filter((key) => !allowed.has(key));
  if (unexpected.length || Object.keys(candidate).length === 0) {
    throw new TripValidationError("body", "trip patch is empty or contains unsupported fields");
  }
  /** @type {Record<string, unknown>} */
  const normalized = {};
  if ("name" in candidate) normalized.name = requiredString(candidate.name, "name", 160);
  if ("startDate" in candidate) normalized.startDate = localDate(candidate.startDate, "startDate");
  if ("endDate" in candidate) normalized.endDate = localDate(candidate.endDate, "endDate");
  if ("travelers" in candidate) {
    if (
      typeof candidate.travelers !== "number"
      || !Number.isInteger(candidate.travelers)
      || candidate.travelers < 1
      || candidate.travelers > 999
    ) {
      throw new TripValidationError("travelers", "travelers must be an integer from 1 to 999");
    }
    normalized.travelers = candidate.travelers;
  }
  if ("defaultCurrency" in candidate) {
    normalized.defaultCurrency = normalizeCurrencyCode(
      requiredString(candidate.defaultCurrency, "defaultCurrency", 3),
    );
  }
  if ("budget" in candidate) normalized.budget = budget(candidate.budget) ?? "";
  if ("timezone" in candidate) normalized.timezone = timezone(candidate.timezone);
  if ("mapProfile" in candidate) {
    const profile = requiredString(candidate.mapProfile, "mapProfile", 64);
    if (!MAP_PROFILES.has(profile)) {
      throw new TripValidationError("mapProfile", "mapProfile is unsupported");
    }
    normalized.mapProfile = profile;
  }
  if ("description" in candidate) normalized.description = optionalString(candidate.description, "description", 5000) ?? "";
  if ("destinations" in candidate) normalized.destinations = destinations(candidate.destinations);
  if (
    typeof normalized.startDate === "string"
    && typeof normalized.endDate === "string"
    && normalized.endDate < normalized.startDate
  ) {
    throw new TripValidationError("endDate", "endDate must be on or after startDate");
  }
  return normalized;
}

/** @param {unknown} ownerId */
export function assertOwnerId(ownerId) {
  return requiredString(ownerId, "ownerId", 255);
}

/** @param {unknown} version */
export function assertVersion(version) {
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new TripValidationError("If-Match", "If-Match must contain a positive version");
  }
  return version;
}

/** @param {unknown} key */
export function assertIdempotencyKey(key) {
  return requiredString(key, "Idempotency-Key", 255);
}

/** @param {unknown} input */
export function tripRequestHash(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

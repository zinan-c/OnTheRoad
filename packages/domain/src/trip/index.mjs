// @ts-nocheck
import { createHash } from "node:crypto";
import { currencies, normalizeCurrencyCode } from "../../../config/src/reference-data.mjs";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/u;
const MAP_PROFILES = new Set(["cn_primary", "international_primary", "hybrid"]);

export class TripValidationError extends Error {
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

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super("Idempotency key was already used for a different request");
    this.name = "IdempotencyKeyReusedError";
    this.code = "IDEMPOTENCY_KEY_REUSED";
    this.status = 409;
  }
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new TripValidationError(field, `${field} must contain 1 to ${maxLength} characters`);
  }
  return value.trim();
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field, maxLength);
}

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

function timezone(value) {
  const normalized = requiredString(value, "timezone", 255);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new TripValidationError("timezone", "timezone must be a supported IANA time zone");
  }
  return normalized;
}

function budget(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !MONEY_PATTERN.test(value)) {
    throw new TripValidationError("budget", "budget must be a non-negative decimal with at most 2 places");
  }
  return `${value.includes(".") ? value.padEnd(value.indexOf(".") + 3, "0") : `${value}.00`}`;
}

function destinations(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TripValidationError("destinations", "destinations must contain 1 to 100 entries");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TripValidationError(`destinations.${index}`, "destination must be an object");
    }
    const countryCode = optionalString(entry.countryCode, `destinations.${index}.countryCode`, 2);
    if (countryCode && !COUNTRY_PATTERN.test(countryCode)) {
      throw new TripValidationError(
        `destinations.${index}.countryCode`,
        "countryCode must be two uppercase letters",
      );
    }
    return {
      name: requiredString(entry.name, `destinations.${index}.name`, 160),
      ...(countryCode ? { countryCode } : {}),
      ...(optionalString(entry.city, `destinations.${index}.city`, 160)
        ? { city: optionalString(entry.city, `destinations.${index}.city`, 160) }
        : {}),
      ...(optionalString(entry.region, `destinations.${index}.region`, 160)
        ? { region: optionalString(entry.region, `destinations.${index}.region`, 160) }
        : {}),
    };
  });
}

export function normalizeTripInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TripValidationError("body", "trip input must be an object");
  }
  const startDate = localDate(input.startDate, "startDate");
  const endDate = localDate(input.endDate, "endDate");
  if (endDate < startDate) {
    throw new TripValidationError("endDate", "endDate must be on or after startDate");
  }
  if (!Number.isInteger(input.travelers) || input.travelers < 1 || input.travelers > 999) {
    throw new TripValidationError("travelers", "travelers must be an integer from 1 to 999");
  }
  const defaultCurrency = normalizeCurrencyCode(
    requiredString(input.defaultCurrency, "defaultCurrency", 3),
  );
  if (!currencies.some(({ code }) => code === defaultCurrency)) {
    throw new TripValidationError("defaultCurrency", "defaultCurrency is unsupported");
  }
  const mapProfile = requiredString(input.mapProfile, "mapProfile", 64);
  if (!MAP_PROFILES.has(mapProfile)) {
    throw new TripValidationError("mapProfile", "mapProfile is unsupported");
  }
  return {
    name: requiredString(input.name, "name", 160),
    startDate,
    endDate,
    travelers: input.travelers,
    defaultCurrency,
    ...(budget(input.budget) ? { budget: budget(input.budget) } : {}),
    timezone: timezone(input.timezone),
    mapProfile,
    ...(optionalString(input.description, "description", 5000)
      ? { description: optionalString(input.description, "description", 5000) }
      : {}),
    destinations: destinations(input.destinations),
  };
}

export function normalizeTripPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TripValidationError("body", "trip patch must be an object");
  }
  const allowed = new Set([
    "name", "startDate", "endDate", "travelers", "defaultCurrency",
    "budget", "timezone", "mapProfile", "description", "destinations",
  ]);
  const unexpected = Object.keys(patch).filter((key) => !allowed.has(key));
  if (unexpected.length || Object.keys(patch).length === 0) {
    throw new TripValidationError("body", "trip patch is empty or contains unsupported fields");
  }
  const normalized = {};
  if ("name" in patch) normalized.name = requiredString(patch.name, "name", 160);
  if ("startDate" in patch) normalized.startDate = localDate(patch.startDate, "startDate");
  if ("endDate" in patch) normalized.endDate = localDate(patch.endDate, "endDate");
  if ("travelers" in patch) {
    if (!Number.isInteger(patch.travelers) || patch.travelers < 1 || patch.travelers > 999) {
      throw new TripValidationError("travelers", "travelers must be an integer from 1 to 999");
    }
    normalized.travelers = patch.travelers;
  }
  if ("defaultCurrency" in patch) {
    normalized.defaultCurrency = normalizeCurrencyCode(
      requiredString(patch.defaultCurrency, "defaultCurrency", 3),
    );
  }
  if ("budget" in patch) normalized.budget = budget(patch.budget) ?? "";
  if ("timezone" in patch) normalized.timezone = timezone(patch.timezone);
  if ("mapProfile" in patch) {
    const profile = requiredString(patch.mapProfile, "mapProfile", 64);
    if (!MAP_PROFILES.has(profile)) {
      throw new TripValidationError("mapProfile", "mapProfile is unsupported");
    }
    normalized.mapProfile = profile;
  }
  if ("description" in patch) normalized.description = optionalString(patch.description, "description", 5000) ?? "";
  if ("destinations" in patch) normalized.destinations = destinations(patch.destinations);
  if (normalized.startDate && normalized.endDate && normalized.endDate < normalized.startDate) {
    throw new TripValidationError("endDate", "endDate must be on or after startDate");
  }
  return normalized;
}

export function assertOwnerId(ownerId) {
  return requiredString(ownerId, "ownerId", 255);
}

export function assertVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TripValidationError("If-Match", "If-Match must contain a positive version");
  }
  return version;
}

export function assertIdempotencyKey(key) {
  return requiredString(key, "Idempotency-Key", 255);
}

export function tripRequestHash(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

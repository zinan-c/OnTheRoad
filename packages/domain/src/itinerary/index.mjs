// @ts-nocheck
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u;
const ITEM_TYPES = new Set([
  "activity",
  "attraction",
  "dining",
  "hotel",
  "transport",
  "other",
]);
const TIME_KINDS = new Set(["clock", "range", "period", "unscheduled"]);
const TIME_PERIODS = new Set([
  "early_morning",
  "morning",
  "noon",
  "afternoon",
  "evening",
  "night",
  "late_night",
]);
const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack", "other"]);

export class ItineraryDomainError extends Error {
  constructor(code, message, status = 422, field) {
    super(message);
    this.name = "ItineraryDomainError";
    this.code = code;
    this.status = status;
    if (field) this.field = field;
  }
}

export class ItineraryNotFoundError extends ItineraryDomainError {
  constructor() {
    super("ITINERARY_NOT_FOUND", "Itinerary item was not found.", 404);
  }
}

export class ItineraryVersionConflictError extends ItineraryDomainError {
  constructor() {
    super("ITINERARY_VERSION_CONFLICT", "Itinerary item version does not match If-Match.", 409);
  }
}

function invalid(field, message) {
  throw new ItineraryDomainError(
    "ITINERARY_VALIDATION_FAILED",
    message,
    422,
    field,
  );
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(field, `${field} must be an object`);
  }
  return value;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    invalid(field, `${field} must contain 1 to ${maxLength} characters`);
  }
  return value.trim();
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, maxLength);
}

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid(field, `${field} must be a UUID`);
  }
  return value;
}

function requiredUuid(value, field) {
  const normalized = optionalUuid(value, field);
  if (!normalized) invalid(field, `${field} is required`);
  return normalized;
}

function optionalTime(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    invalid(field, `${field} must be HH:mm or HH:mm:ss`);
  }
  return value.slice(0, 5);
}

function optionalDateTime(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string"
    || !Number.isFinite(new Date(value).valueOf())
    || !/T/u.test(value)
  ) {
    invalid(field, `${field} must be an ISO date-time`);
  }
  return new Date(value).toISOString();
}

function optionalInteger(value, field, maximum = 525_600) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    invalid(field, `${field} must be an integer from 0 to ${maximum}`);
  }
  return value;
}

function sensitiveValue(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string"
    && (!value || typeof value !== "object" || Array.isArray(value))
  ) {
    invalid(field, `${field} must be a string or object`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 10_000) invalid(field, `${field} is too long`);
  return value;
}

function normalizeItemType(value) {
  const aliased = value === "accommodation" ? "hotel" : value;
  if (typeof aliased !== "string" || !ITEM_TYPES.has(aliased)) {
    invalid("itemType", "itemType is unsupported");
  }
  return aliased;
}

function normalizeSchedule(input) {
  const schedule = input.schedule && typeof input.schedule === "object"
    ? input.schedule
    : {};
  const startTime = optionalTime(input.startTime ?? schedule.startTime, "startTime");
  const endTime = optionalTime(input.endTime ?? schedule.endTime, "endTime");
  const endDayOffsetValue = input.endDayOffset
    ?? (schedule.crossesMidnight === true ? 1 : 0);
  if (endDayOffsetValue !== 0 && endDayOffsetValue !== 1) {
    invalid("endDayOffset", "endDayOffset must be 0 or 1");
  }
  const inferredKind = startTime && endTime
    ? "range"
    : startTime
      ? "clock"
      : (input.timePeriod ? "period" : "unscheduled");
  const timeKind = input.timeKind ?? inferredKind;
  if (!TIME_KINDS.has(timeKind)) invalid("timeKind", "timeKind is unsupported");
  const timePeriod = optionalString(input.timePeriod, "timePeriod", 64);
  if (timePeriod && !TIME_PERIODS.has(timePeriod)) {
    invalid("timePeriod", "timePeriod is unsupported");
  }
  if (timeKind === "clock" && !startTime) {
    invalid("startTime", "clock items require startTime");
  }
  if (timeKind === "range" && (!startTime || !endTime)) {
    invalid("endTime", "range items require startTime and endTime");
  }
  if (timeKind === "period" && !timePeriod) {
    invalid("timePeriod", "period items require timePeriod");
  }
  if (timeKind !== "range" && endDayOffsetValue !== 0) {
    invalid("endDayOffset", "endDayOffset is only valid for range items");
  }
  if (
    timeKind === "range"
    && endDayOffsetValue === 0
    && endTime < startTime
  ) {
    invalid("endTime", "endTime must not be before startTime unless endDayOffset is 1");
  }
  return {
    timeKind,
    startTime,
    endTime,
    endDayOffset: endDayOffsetValue,
    timePeriod,
    durationMinutes: optionalInteger(
      input.durationMinutes ?? schedule.durationMinutes,
      "durationMinutes",
    ),
  };
}

function normalizeSchedulePatch(rawPatch) {
  const normalized = {};
  const schedule = rawPatch.schedule && typeof rawPatch.schedule === "object"
    ? rawPatch.schedule
    : {};
  if ("timeKind" in rawPatch) {
    if (!TIME_KINDS.has(rawPatch.timeKind)) {
      invalid("timeKind", "timeKind is unsupported");
    }
    normalized.timeKind = rawPatch.timeKind;
  }
  if ("startTime" in rawPatch || "startTime" in schedule) {
    normalized.startTime = optionalTime(
      rawPatch.startTime ?? schedule.startTime,
      "startTime",
    );
  }
  if ("endTime" in rawPatch || "endTime" in schedule) {
    normalized.endTime = optionalTime(
      rawPatch.endTime ?? schedule.endTime,
      "endTime",
    );
  }
  if ("endDayOffset" in rawPatch || "crossesMidnight" in schedule) {
    const value = rawPatch.endDayOffset
      ?? (schedule.crossesMidnight === true ? 1 : 0);
    if (value !== 0 && value !== 1) {
      invalid("endDayOffset", "endDayOffset must be 0 or 1");
    }
    normalized.endDayOffset = value;
  }
  if ("timePeriod" in rawPatch) {
    const value = optionalString(rawPatch.timePeriod, "timePeriod", 64);
    if (value && !TIME_PERIODS.has(value)) {
      invalid("timePeriod", "timePeriod is unsupported");
    }
    normalized.timePeriod = value;
  }
  if ("durationMinutes" in rawPatch || "durationMinutes" in schedule) {
    normalized.durationMinutes = optionalInteger(
      rawPatch.durationMinutes ?? schedule.durationMinutes,
      "durationMinutes",
    );
  }
  return normalized;
}

function normalizeDining(value) {
  if (value === undefined || value === null) return null;
  const dining = object(value, "dining");
  const mealType = optionalString(dining.mealType, "dining.mealType", 64);
  if (mealType && !MEAL_TYPES.has(mealType)) {
    invalid("dining.mealType", "dining.mealType is unsupported");
  }
  return {
    name: requiredString(dining.name, "dining.name", 500),
    mealType,
    details: optionalString(dining.details, "dining.details", 5000),
    locationId: optionalUuid(dining.locationId, "dining.locationId"),
  };
}

function normalizeAccommodation(value) {
  if (value === undefined || value === null) return null;
  const accommodation = object(value, "accommodation");
  const checkInAt = optionalDateTime(
    accommodation.checkInAt
      ?? (accommodation.checkInDate ? `${accommodation.checkInDate}T00:00:00.000Z` : null),
    "accommodation.checkInAt",
  );
  const checkOutAt = optionalDateTime(
    accommodation.checkOutAt
      ?? (accommodation.checkOutDate ? `${accommodation.checkOutDate}T00:00:00.000Z` : null),
    "accommodation.checkOutAt",
  );
  if (checkInAt && checkOutAt && checkOutAt < checkInAt) {
    invalid("accommodation.checkOutAt", "checkOutAt must be after checkInAt");
  }
  return {
    name: requiredString(accommodation.name, "accommodation.name", 500),
    details: optionalString(accommodation.details, "accommodation.details", 5000),
    locationId: optionalUuid(accommodation.locationId, "accommodation.locationId"),
    checkInAt,
    checkOutAt,
    bookingInfo: sensitiveValue(accommodation.bookingInfo, "accommodation.bookingInfo"),
    contactInfo: sensitiveValue(accommodation.contactInfo, "accommodation.contactInfo"),
  };
}

function compatibilityShape(input) {
  const hospitality = input.hospitality && typeof input.hospitality === "object"
    ? input.hospitality
    : {};
  const location = input.location && typeof input.location === "object"
    ? input.location
    : {};
  const transport = input.transport && typeof input.transport === "object"
    ? input.transport
    : {};
  return {
    ...input,
    itemType: input.itemType ?? input.kind,
    locationId: input.locationId ?? location.locationId,
    transportModeCode: input.transportModeCode ?? transport.modeId,
    dining: input.dining ?? hospitality.dining,
    accommodation: input.accommodation ?? hospitality.accommodation,
    bookingInfo: input.bookingInfo
      ?? hospitality.bookingInfo
      ?? hospitality.reservationReference,
    contactInfo: input.contactInfo
      ?? hospitality.contactInfo
      ?? (
        hospitality.contactName || hospitality.contactPhone
          ? { name: hospitality.contactName, phone: hospitality.contactPhone }
          : undefined
      ),
    remark: input.remark ?? input.notes,
  };
}

export function normalizeItineraryCreate(rawInput) {
  const input = compatibilityShape(object(rawInput, "body"));
  const itemType = normalizeItemType(input.itemType);
  const target = optionalString(input.target, "target", 500);
  const description = optionalString(input.description, "description", 10_000);
  if (!target && !description) {
    invalid("target", "target or description is required");
  }
  const transportModeCode = optionalString(
    input.transportModeCode,
    "transportModeCode",
    100,
  )?.toUpperCase() ?? null;
  const externalSource = optionalString(input.externalSource, "externalSource", 255);
  const externalId = optionalString(input.externalId, "externalId", 500);
  if (Boolean(externalSource) !== Boolean(externalId)) {
    invalid("externalId", "externalSource and externalId must be provided together");
  }
  const dining = normalizeDining(input.dining);
  const accommodation = normalizeAccommodation(input.accommodation);
  if (dining && itemType !== "dining") {
    invalid("dining", "dining details require itemType dining");
  }
  if (accommodation && itemType !== "hotel") {
    invalid("accommodation", "accommodation details require itemType hotel");
  }
  return {
    tripDayId: requiredUuid(input.tripDayId, "tripDayId"),
    itemType,
    ...normalizeSchedule(input),
    timeZone: optionalString(input.timeZone, "timeZone", 255),
    target,
    description,
    destinationId: optionalUuid(input.destinationId, "destinationId"),
    locationId: optionalUuid(input.locationId, "locationId"),
    startLocationId: optionalUuid(input.startLocationId, "startLocationId"),
    endLocationId: optionalUuid(input.endLocationId, "endLocationId"),
    transportModeCode,
    bookingInfo: sensitiveValue(input.bookingInfo, "bookingInfo"),
    contactInfo: sensitiveValue(input.contactInfo, "contactInfo"),
    remark: optionalString(input.remark, "remark", 10_000),
    externalSource,
    externalId,
    dining,
    accommodation,
  };
}

export function normalizeItineraryPatch(rawPatch) {
  const patch = compatibilityShape(object(rawPatch, "body"));
  const rawHospitality = rawPatch.hospitality
    && typeof rawPatch.hospitality === "object"
    ? rawPatch.hospitality
    : {};
  const rawLocation = rawPatch.location && typeof rawPatch.location === "object"
    ? rawPatch.location
    : {};
  const rawTransport = rawPatch.transport && typeof rawPatch.transport === "object"
    ? rawPatch.transport
    : {};
  if (Object.keys(rawPatch).length === 0) invalid("body", "patch must not be empty");
  const allowed = new Set([
    "itemType", "kind", "timeKind", "startTime", "endTime", "endDayOffset",
    "timeZone", "timePeriod", "target", "description", "durationMinutes",
    "destinationId", "locationId", "startLocationId", "endLocationId",
    "transportModeCode", "bookingInfo", "contactInfo", "remark",
    "externalSource", "externalId", "dining", "accommodation", "schedule",
    "location", "transport", "hospitality", "notes",
  ]);
  const unexpected = Object.keys(rawPatch).filter((key) => !allowed.has(key));
  if (unexpected.length) invalid("body", `unsupported fields: ${unexpected.join(", ")}`);
  const normalized = {};
  if ("itemType" in rawPatch || "kind" in rawPatch) {
    normalized.itemType = normalizeItemType(patch.itemType);
  }
  const scheduleFields = [
    "timeKind", "startTime", "endTime", "endDayOffset",
    "timePeriod", "durationMinutes", "schedule",
  ];
  if (scheduleFields.some((field) => field in rawPatch)) {
    Object.assign(normalized, normalizeSchedulePatch(rawPatch));
  }
  const stringFields = [
    ["timeZone", 255],
    ["target", 500],
    ["description", 10_000],
    ["remark", 10_000],
    ["externalSource", 255],
    ["externalId", 500],
  ];
  for (const [field, maxLength] of stringFields) {
    if (field in rawPatch || (field === "remark" && "notes" in rawPatch)) {
      normalized[field] = optionalString(patch[field], field, maxLength);
    }
  }
  for (const field of [
    "destinationId", "locationId", "startLocationId", "endLocationId",
  ]) {
    if (
      field in rawPatch
      || (field === "locationId" && "locationId" in rawLocation)
    ) {
      normalized[field] = optionalUuid(patch[field], field);
    }
  }
  if ("transportModeCode" in rawPatch || "modeId" in rawTransport) {
    normalized.transportModeCode =
      optionalString(patch.transportModeCode, "transportModeCode", 100)?.toUpperCase()
      ?? null;
  }
  if (
    "bookingInfo" in rawPatch
    || "bookingInfo" in rawHospitality
    || "reservationReference" in rawHospitality
  ) {
    normalized.bookingInfo = sensitiveValue(patch.bookingInfo, "bookingInfo");
  }
  if (
    "contactInfo" in rawPatch
    || "contactInfo" in rawHospitality
    || "contactName" in rawHospitality
    || "contactPhone" in rawHospitality
  ) {
    normalized.contactInfo = sensitiveValue(patch.contactInfo, "contactInfo");
  }
  if ("dining" in rawPatch || "dining" in rawHospitality) {
    normalized.dining = normalizeDining(patch.dining);
  }
  if ("accommodation" in rawPatch || "accommodation" in rawHospitality) {
    normalized.accommodation = normalizeAccommodation(patch.accommodation);
  }
  return normalized;
}

export function assertItineraryOwner(ownerId) {
  return requiredString(ownerId, "ownerId", 255);
}

export function assertItineraryId(id, field = "itemId") {
  return requiredUuid(id, field);
}

export function assertItineraryVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1) {
    invalid("If-Match", "If-Match must contain a positive version");
  }
  return version;
}

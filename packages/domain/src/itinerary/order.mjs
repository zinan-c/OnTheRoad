// @ts-nocheck
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class ItineraryOrderError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ItineraryOrderError";
    this.code = code;
    this.status = status;
  }
}

export class ItineraryOrderVersionConflictError extends ItineraryOrderError {
  constructor() {
    super(
      "ITINERARY_ORDER_VERSION_CONFLICT",
      "TripDay version does not match baseVersion.",
      409,
    );
  }
}

export class ItineraryOrderDayNotFoundError extends ItineraryOrderError {
  constructor() {
    super(
      "ITINERARY_ORDER_DAY_NOT_FOUND",
      "TripDay was not found.",
      404,
    );
  }
}

function setMismatch(message) {
  throw new ItineraryOrderError(
    "ITINERARY_ORDER_SET_MISMATCH",
    message,
    422,
  );
}

function assertUuidArray(value, field) {
  if (!Array.isArray(value)) setMismatch(`${field} must be an array`);
  if (value.length === 0) setMismatch(`${field} must not be empty`);
  for (const id of value) {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      setMismatch(`${field} must contain only UUID values`);
    }
  }
}

export function assertCompleteDayOrder(currentIds, orderedIds) {
  assertUuidArray(currentIds, "currentIds");
  assertUuidArray(orderedIds, "orderedIds");
  const current = new Set(currentIds);
  const ordered = new Set(orderedIds);
  if (current.size !== currentIds.length) {
    setMismatch("current Day contains duplicate IDs");
  }
  if (
    ordered.size !== orderedIds.length
    || orderedIds.length !== currentIds.length
    || ordered.size !== current.size
    || orderedIds.some((id) => !current.has(id))
  ) {
    setMismatch("orderedIds must be the complete unique ID set for one Day");
  }
  return [...orderedIds];
}

export function assertBaseDayVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ItineraryOrderError(
      "ITINERARY_ORDER_VERSION_INVALID",
      "baseVersion must be a positive integer.",
      422,
    );
  }
  return value;
}

export function sparseOrderAssignments(orderedIds, step = 1024) {
  assertUuidArray(orderedIds, "orderedIds");
  if (!Number.isSafeInteger(step) || step < 2) {
    throw new RangeError("step must be an integer greater than 1");
  }
  return orderedIds.map((id, index) => ({
    id,
    sortOrder: (index + 1) * step,
  }));
}

export function moveOrderedId(orderedIds, activeId, overId) {
  const current = [...orderedIds];
  const from = current.indexOf(activeId);
  const to = current.indexOf(overId);
  if (from === -1 || to === -1) {
    setMismatch("activeId and overId must belong to the current Day");
  }
  if (from === to) return current;
  const [moved] = current.splice(from, 1);
  current.splice(to, 0, moved);
  return current;
}

export function moveOrderedIdByOffset(orderedIds, activeId, offset) {
  if (offset !== -1 && offset !== 1) {
    throw new RangeError("offset must be -1 or 1");
  }
  const index = orderedIds.indexOf(activeId);
  if (index === -1) setMismatch("activeId must belong to the current Day");
  const targetIndex = Math.max(
    0,
    Math.min(orderedIds.length - 1, index + offset),
  );
  return moveOrderedId(orderedIds, activeId, orderedIds[targetIndex]);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class ItineraryOrderError extends Error {
  /** @param {string} code @param {string} message @param {number} status */
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

/** @param {string} message @returns {never} */
function setMismatch(message) {
  throw new ItineraryOrderError(
    "ITINERARY_ORDER_SET_MISMATCH",
    message,
    422,
  );
}

/** @param {unknown} value @param {string} field @returns {string[]} */
function assertUuidArray(value, field) {
  if (!Array.isArray(value)) setMismatch(`${field} must be an array`);
  if (value.length === 0) setMismatch(`${field} must not be empty`);
  for (const id of value) {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      setMismatch(`${field} must contain only UUID values`);
    }
  }
  return value;
}

/** @param {unknown} currentIds @param {unknown} orderedIds */
export function assertCompleteDayOrder(currentIds, orderedIds) {
  const currentValues = assertUuidArray(currentIds, "currentIds");
  const orderedValues = assertUuidArray(orderedIds, "orderedIds");
  const current = new Set(currentValues);
  const ordered = new Set(orderedValues);
  if (current.size !== currentValues.length) {
    setMismatch("current Day contains duplicate IDs");
  }
  if (
    ordered.size !== orderedValues.length
    || orderedValues.length !== currentValues.length
    || ordered.size !== current.size
    || orderedValues.some((id) => !current.has(id))
  ) {
    setMismatch("orderedIds must be the complete unique ID set for one Day");
  }
  return [...orderedValues];
}

/** @param {unknown} value */
export function assertBaseDayVersion(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ItineraryOrderError(
      "ITINERARY_ORDER_VERSION_INVALID",
      "baseVersion must be a positive integer.",
      422,
    );
  }
  return value;
}

/** @param {unknown} orderedIds @param {number} [step] */
export function sparseOrderAssignments(orderedIds, step = 1024) {
  const values = assertUuidArray(orderedIds, "orderedIds");
  if (!Number.isSafeInteger(step) || step < 2) {
    throw new RangeError("step must be an integer greater than 1");
  }
  return values.map((id, index) => ({
    id,
    sortOrder: (index + 1) * step,
  }));
}

/** @param {readonly string[]} orderedIds @param {string} activeId @param {string} overId */
export function moveOrderedId(orderedIds, activeId, overId) {
  const current = [...orderedIds];
  const from = current.indexOf(activeId);
  const to = current.indexOf(overId);
  if (from === -1 || to === -1) {
    setMismatch("activeId and overId must belong to the current Day");
  }
  if (from === to) return current;
  const [moved] = current.splice(from, 1);
  if (moved !== undefined) current.splice(to, 0, moved);
  return current;
}

/** @param {readonly string[]} orderedIds @param {string} activeId @param {-1 | 1} offset */
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
  const target = orderedIds[targetIndex];
  if (target === undefined) setMismatch("target index must belong to the current Day");
  return moveOrderedId(orderedIds, activeId, target);
}

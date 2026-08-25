import { createHash } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

/** @typedef {{column: string, cast: string, expression: string}} TripSortDefinition */

/** @type {Record<string, TripSortDefinition>} */
export const TRIP_LIST_SORTS = Object.freeze({
  lastActivityAt: Object.freeze({
    column: "last_activity_at",
    cast: "timestamptz",
    expression: `to_char(t.last_activity_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }),
  createdAt: Object.freeze({
    column: "created_at",
    cast: "timestamptz",
    expression: `to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }),
  updatedAt: Object.freeze({
    column: "updated_at",
    cast: "timestamptz",
    expression: `to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }),
  startDate: Object.freeze({
    column: "start_date",
    cast: "date",
    expression: "to_char(t.start_date, 'YYYY-MM-DD')",
  }),
  name: Object.freeze({
    column: "name",
    cast: "text",
    expression: "t.name",
  }),
});

export const TRIP_LIST_ORDERS = Object.freeze(["asc", "desc"]);
export const TRIP_CURSOR_DIRECTIONS = Object.freeze(["next", "previous"]);

export class TripCursorError extends Error {
  /** @param {string} [message] */
  constructor(message = "The trip list cursor is invalid or expired.") {
    super(message);
    this.name = "TripCursorError";
    this.code = "TRIP_CURSOR_INVALID";
    this.status = 400;
  }
}

/** @param {unknown} value */
function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** @param {string} value */
function base64UrlDecode(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new TripCursorError();
  }
}

export function tripListQueryKey({ search = "", currency = "", status = "active", sort = "lastActivityAt", order = "desc" } = {}) {
  return createHash("sha256")
    .update(JSON.stringify({ search, currency, status, sort, order }))
    .digest("hex");
}

/** @param {{sort: string, order: string, direction?: string, value: string, id: string, queryKey: string}} cursor */
export function encodeTripCursor(cursor) {
  const direction = cursor.direction ?? "next";
  if (
    !TRIP_LIST_SORTS[cursor.sort]
    || !TRIP_LIST_ORDERS.includes(cursor.order)
    || !TRIP_CURSOR_DIRECTIONS.includes(direction)
  ) {
    throw new TripCursorError();
  }
  if (!UUID_PATTERN.test(cursor.id) || typeof cursor.value !== "string" || cursor.value.length === 0) {
    throw new TripCursorError();
  }
  return base64UrlEncode({
    v: 2,
    sort: cursor.sort,
    order: cursor.order,
    direction,
    value: cursor.value,
    id: cursor.id,
    queryKey: cursor.queryKey,
  });
}

/** @param {unknown} value */
export function decodeTripCursor(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 1024) {
    throw new TripCursorError();
  }
  const decoded = base64UrlDecode(value);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new TripCursorError();
  }
  /** @type {Record<string, unknown>} */
  const cursor = decoded;
  const sort = typeof cursor.sort === "string" ? cursor.sort : "";
  const order = typeof cursor.order === "string" ? cursor.order : "";
  const direction = cursor.v === 1
    ? "next"
    : typeof cursor.direction === "string" ? cursor.direction : "";
  const cursorValue = typeof cursor.value === "string" ? cursor.value : "";
  const id = typeof cursor.id === "string" ? cursor.id : "";
  const queryKey = typeof cursor.queryKey === "string" ? cursor.queryKey : "";
  if (
    ![1, 2].includes(Number(cursor.v))
    || !TRIP_LIST_SORTS[sort]
    || !TRIP_LIST_ORDERS.includes(order)
    || !TRIP_CURSOR_DIRECTIONS.includes(direction)
    || !UUID_PATTERN.test(id)
    || !/^[0-9a-f]{64}$/u.test(queryKey)
  ) {
    throw new TripCursorError();
  }
  if (sort === "name" && cursorValue.length > 160) throw new TripCursorError();
  if (sort === "startDate" && !DATE_PATTERN.test(cursorValue)) throw new TripCursorError();
  if (["lastActivityAt", "createdAt", "updatedAt"].includes(sort) && !TIMESTAMP_PATTERN.test(cursorValue)) {
    throw new TripCursorError();
  }
  return {
    sort,
    order,
    direction,
    value: cursorValue,
    id,
    queryKey,
  };
}

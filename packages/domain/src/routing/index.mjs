import { createHash } from "node:crypto";

export const ROUTE_SEGMENT_KINDS = Object.freeze({
  BETWEEN_ITEMS: "between_items",
  ITEM_TRANSPORT: "item_transport",
});

export const ROUTE_BLOCKERS = Object.freeze({
  LOCATION_MISSING: "LOCATION_MISSING",
  LOCATION_NOT_CONFIRMED: "LOCATION_NOT_CONFIRMED",
});

export const SYSTEM_OTHER_TRANSPORT_MODE = "OTHER";

export class RouteDomainError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "RouteDomainError";
    this.code = code;
  }
}

/** @param {any} location */
function pointOf(location) {
  return location?.point ?? null;
}

/** @param {any} location */
function confirmed(location) {
  return Boolean(location?.id && location?.version > 0 && pointOf(location)
    && location.geocodingStatus === "resolved");
}

/** @param {any} location */
function snapshot(location) {
  if (!location) return null;
  return {
    id: location.id,
    version: location.version,
    geocodingStatus: location.geocodingStatus,
    point: pointOf(location),
  };
}

/** @param {any} item @param {string} side */
function endpoint(item, side) {
  const explicit = side === "start" ? item.startLocation : item.endLocation;
  return explicit ?? item.location ?? null;
}

/** @param {any} value @returns {any} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

/** @param {any} source */
function sourceVersion(source) {
  return createHash("sha256").update(JSON.stringify(canonical(source))).digest("hex");
}

/** @param {Array<any>} items */
function orderedItems(items) {
  return [...items]
    .filter((item) => !item.deletedAt)
    .sort((a, b) => (a.dayNumber - b.dayNumber) || (a.sortOrder - b.sortOrder) || a.id.localeCompare(b.id));
}

/** @param {{kind: string, fromItem: any, toItem: any, from: any, to: any, mode: string|undefined, arrivalDayId: string, routeGenerations: Record<string, number>}} input */
function buildSegment({ kind, fromItem, toItem, from, to, mode, arrivalDayId, routeGenerations }) {
  const source = {
    kind,
    arrivalDayId,
    fromItem: fromItem ? { id: fromItem.id, version: fromItem.version, sortOrder: fromItem.sortOrder } : null,
    toItem: toItem ? { id: toItem.id, version: toItem.version, sortOrder: toItem.sortOrder } : null,
    fromLocation: from ? { id: from.id, version: from.version, point: from.point } : null,
    toLocation: to ? { id: to.id, version: to.version, point: to.point } : null,
    mode,
    routeGenerations,
  };
  const blockers = [];
  if (!from || !to) blockers.push(ROUTE_BLOCKERS.LOCATION_MISSING);
  else if (!confirmed(from) || !confirmed(to)) blockers.push(ROUTE_BLOCKERS.LOCATION_NOT_CONFIRMED);
  const samePoint = Boolean(from?.point && to?.point
    && from.point.longitude === to.point.longitude
    && from.point.latitude === to.point.latitude);
  if (samePoint) return null;
  return {
    kind,
    arrivalDayId,
    fromItineraryItemId: fromItem?.id ?? null,
    toItineraryItemId: toItem?.id ?? null,
    fromLocation: snapshot(from),
    toLocation: snapshot(to),
    transportModeCode: mode ?? SYSTEM_OTHER_TRANSPORT_MODE,
    status: blockers.length ? "pending" : "pending",
    blockers,
    sourceVersion: sourceVersion(source),
    sourceContext: {
      dayIds: [...new Set([fromItem?.tripDayId, toItem?.tripDayId].filter(Boolean))],
      routeGenerations,
    },
  };
}

/**
 * @param {{items: Array<object>, routeGenerations?: Record<string, number>}} input
 * @returns {Array<object>}
 */
export function generateRouteWindow({ items, routeGenerations = {} }) {
  const ordered = orderedItems(items);
  const segments = [];
  for (const item of ordered) {
    if (item.itemType === "transport") {
      const from = item.startLocation ?? null;
      const to = item.endLocation ?? null;
      const segment = buildSegment({
        kind: ROUTE_SEGMENT_KINDS.ITEM_TRANSPORT,
        fromItem: item,
        toItem: item,
        from,
        to,
        mode: item.transportModeCode,
        arrivalDayId: item.tripDayId,
        routeGenerations,
      });
      if (segment) segments.push(segment);
    }
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const fromItem = ordered[index - 1];
    const toItem = ordered[index];
    const segment = buildSegment({
      kind: ROUTE_SEGMENT_KINDS.BETWEEN_ITEMS,
      fromItem,
      toItem,
      from: endpoint(fromItem, "end"),
      to: endpoint(toItem, "start"),
      mode: toItem.transportModeCode,
      arrivalDayId: toItem.tripDayId,
      routeGenerations,
    });
    if (segment) segments.push(segment);
  }
  return segments;
}

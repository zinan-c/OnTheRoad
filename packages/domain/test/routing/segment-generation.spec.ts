import { describe, expect, test } from "vitest";

import {
  ROUTE_BLOCKERS,
  ROUTE_SEGMENT_KINDS,
  generateRouteWindow,
} from "../../src/routing/index.mjs";

const location = (id: string, longitude: number, latitude: number, resolved = true) => ({
  id,
  version: 1,
  geocodingStatus: resolved ? "resolved" : "unresolved",
  point: { longitude, latitude, crs: "WGS84" },
});

const item = (id: string, day: string, dayNumber: number, sortOrder: number, overrides = {}) => ({
  id,
  tripDayId: day,
  dayNumber,
  sortOrder,
  version: 1,
  itemType: "activity",
  location: location(`${id}-location`, sortOrder, dayNumber),
  ...overrides,
});

describe("TC-C07-01 route segment generation matrix", () => {
  test("orders adjacent items and uses the arrival day and destination mode", () => {
    const result = generateRouteWindow({
      items: [
        item("b", "day-2", 2, 1),
        item("a", "day-1", 1, 0),
      ],
      routeGenerations: { "day-1": 3, "day-2": 4 },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: ROUTE_SEGMENT_KINDS.BETWEEN_ITEMS,
      fromItineraryItemId: "a",
      toItineraryItemId: "b",
      arrivalDayId: "day-2",
      transportModeCode: "OTHER",
      blockers: [],
    });
    expect(result[0].sourceContext.routeGenerations).toEqual({ "day-1": 3, "day-2": 4 });
  });

  test("emits an explicit blocker and does not bridge across missing endpoints", () => {
    const result = generateRouteWindow({
      items: [
        item("a", "day-1", 1, 0, { location: null }),
        item("b", "day-1", 1, 1),
        item("c", "day-1", 1, 2),
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0].blockers).toEqual([ROUTE_BLOCKERS.LOCATION_MISSING]);
    expect(result[1].fromItineraryItemId).toBe("b");
  });

  test("keeps an unconfirmed endpoint pending", () => {
    const result = generateRouteWindow({
      items: [
        item("a", "day-1", 1, 0, { location: location("a-location", 0, 0, false) }),
        item("b", "day-1", 1, 1),
      ],
    });

    expect(result[0]).toMatchObject({ status: "pending", blockers: [ROUTE_BLOCKERS.LOCATION_NOT_CONFIRMED] });
  });

  test("creates an item transport segment only when both endpoints exist", () => {
    const result = generateRouteWindow({
      items: [item("transport", "day-1", 1, 0, {
        itemType: "transport",
        startLocation: location("from", 0, 0),
        endLocation: location("to", 1, 1),
        transportModeCode: "TRAIN",
      })],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: ROUTE_SEGMENT_KINDS.ITEM_TRANSPORT,
      fromItineraryItemId: "transport",
      toItineraryItemId: "transport",
      transportModeCode: "TRAIN",
      blockers: [],
    });
  });
});

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

  test("covers the cross-day transport matrix without duplicate or bridged connectors", () => {
    const shared = location("shared-c-d-start", 3, 2);
    const result = generateRouteWindow({
      items: [
        item("a", "day-1", 1, 1),
        item("b", "day-1", 1, 2, { transportModeCode: "WALK" }),
        item("c", "day-2", 2, 1, { location: shared, transportModeCode: "FLIGHT" }),
        item("d", "day-2", 2, 2, {
          itemType: "transport",
          location: null,
          startLocation: shared,
          endLocation: location("d-end", 4, 2),
          transportModeCode: "FERRY",
        }),
        item("e", "day-2", 2, 3, { transportModeCode: "TRANSIT" }),
        item("f", "day-2", 2, 4, {
          location: location("f-unconfirmed", 6, 2, false),
          transportModeCode: "CUSTOM",
        }),
        item("g", "day-2", 2, 5, { transportModeCode: undefined }),
      ],
      routeGenerations: { "day-1": 7, "day-2": 11 },
    });

    expect(result.filter(({ kind }) => kind === ROUTE_SEGMENT_KINDS.ITEM_TRANSPORT)).toHaveLength(1);
    expect(result).toContainEqual(expect.objectContaining({
      fromItineraryItemId: "b",
      toItineraryItemId: "c",
      arrivalDayId: "day-2",
      transportModeCode: "FLIGHT",
    }));
    expect(result).not.toContainEqual(expect.objectContaining({
      fromItineraryItemId: "c",
      toItineraryItemId: "d",
    }));
    expect(result).not.toContainEqual(expect.objectContaining({
      fromItineraryItemId: "e",
      toItineraryItemId: "g",
    }));
    expect(result).toContainEqual(expect.objectContaining({
      fromItineraryItemId: "e",
      toItineraryItemId: "f",
      blockers: [ROUTE_BLOCKERS.LOCATION_NOT_CONFIRMED],
    }));
    expect(result).toContainEqual(expect.objectContaining({
      fromItineraryItemId: "f",
      toItineraryItemId: "g",
      transportModeCode: "OTHER",
      blockers: [ROUTE_BLOCKERS.LOCATION_NOT_CONFIRMED],
    }));
  });

  test("changes sourceVersion after reorder or inbound mode changes", () => {
    const a = item("a", "day-1", 1, 1);
    const b = item("b", "day-1", 1, 2, { transportModeCode: "WALK" });
    const original = generateRouteWindow({ items: [a, b], routeGenerations: { "day-1": 1 } });
    const reordered = generateRouteWindow({
      items: [{ ...a, sortOrder: 2 }, { ...b, sortOrder: 1 }],
      routeGenerations: { "day-1": 2 },
    });
    const changedMode = generateRouteWindow({
      items: [a, { ...b, version: 2, transportModeCode: "FERRY" }],
      routeGenerations: { "day-1": 2 },
    });

    expect(reordered[0]?.sourceVersion).not.toBe(original[0]?.sourceVersion);
    expect(changedMode[0]?.sourceVersion).not.toBe(original[0]?.sourceVersion);
    expect(changedMode[0]?.transportModeCode).toBe("FERRY");
  });
});

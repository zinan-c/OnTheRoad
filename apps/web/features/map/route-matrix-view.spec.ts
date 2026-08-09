import { describe, expect, test } from "vitest";

import type { ProductDay, ProductItem } from "../../src/features/itinerary/itinerary-panel";
import {
  buildRouteMapItems,
  currentRouteSegments,
  type RouteSegment,
} from "../../src/features/map/route-map-workspace";

const baseItem = {
  description: null,
  timeKind: "unscheduled",
  startTime: null,
  endTime: null,
  endDayOffset: 0,
  timePeriod: null,
  durationMinutes: null,
  locationId: null,
  startLocationId: null,
  endLocationId: null,
  transportModeCode: null,
  bookingInfo: null,
  contactInfo: null,
  remark: null,
  dining: null,
  accommodation: null,
  version: 1,
} as const;

describe("E2E-017 route matrix view", () => {
  test("shows both transport endpoints and never invents a point for unresolved F", () => {
    const days = [{ id: "day-2", dayNumber: 2 }] as ProductDay[];
    const items = [
      { ...baseItem, id: "d", tripDayId: "day-2", itemType: "transport", target: "D", startLocationId: "d-start", endLocationId: "d-end" },
      { ...baseItem, id: "f", tripDayId: "day-2", itemType: "attraction", target: "F", locationId: "f-location" },
    ] as ProductItem[];
    const markers = buildRouteMapItems(items, days, {
      "d-start": { id: "d-start", point: { longitude: 121.4, latitude: 31.2 } },
      "d-end": { id: "d-end", point: { longitude: 121.5, latitude: 31.3 } },
      "f-location": { id: "f-location", geocodingStatus: "unresolved", point: null },
    });

    expect(markers.map(({ id }) => id)).toEqual(["d:start", "d:end", "f"]);
    expect(markers.filter(({ point }) => point)).toHaveLength(2);
    expect(markers.find(({ id }) => id === "f")).not.toHaveProperty("point");
  });

  test("Day view uses the segment arrival day while global view keeps the full active matrix", () => {
    const routes = [
      { id: "a-b", tripDayId: "day-1" },
      { id: "b-c", tripDayId: "day-2" },
      { id: "d-internal", tripDayId: "day-2", kind: "item_transport" },
    ] as RouteSegment[];

    expect(currentRouteSegments(routes, "day-1").map(({ id }) => id)).toEqual(["a-b"]);
    expect(currentRouteSegments(routes, "day-2").map(({ id }) => id)).toEqual(["b-c", "d-internal"]);
    expect(currentRouteSegments(routes, null)).toHaveLength(3);
  });
});

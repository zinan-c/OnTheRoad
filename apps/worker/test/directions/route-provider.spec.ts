import { describe, expect, test, vi } from "vitest";

import type { DirectionsProvider } from "@on-the-road/providers";
import { resolveRouteCandidates } from "../../src/processors/directions/postgres-route-rebuild.js";

describe("route provider composition", () => {
  test("forwards WGS84 endpoints, mode and map profile and keeps provider geometry", async () => {
    const route = vi.fn<DirectionsProvider["route"]>().mockResolvedValue({
      kind: "resolved",
      geometry: {
        type: "LineString",
        coordinates: [
          { longitude: 121.48, latitude: 31.2, crs: "WGS84" },
          { longitude: 121.486, latitude: 31.205, crs: "WGS84" },
          { longitude: 121.49, latitude: 31.21, crs: "WGS84" },
        ],
      },
      mode: "WALK",
      attribution: "fixture directions",
    });
    const candidates = [{
      kind: "between_items",
      arrivalDayId: "day-1",
      fromItineraryItemId: "item-a",
      toItineraryItemId: "item-b",
      transportModeCode: "WALK",
      sourceVersion: "source-v1",
      sourceContext: {},
      blockers: [],
      fromLocation: { id: "location-a", point: { longitude: 121.48, latitude: 31.2 } },
      toLocation: { id: "location-b", point: { longitude: 121.49, latitude: 31.21 } },
    }];

    const [resolved] = await resolveRouteCandidates(
      candidates,
      { route },
      "fixture",
      "fixture",
    );

    expect(route).toHaveBeenCalledWith({
      from: { longitude: 121.48, latitude: 31.2, crs: "WGS84" },
      to: { longitude: 121.49, latitude: 31.21, crs: "WGS84" },
      mode: "WALK",
      mapProfile: "fixture",
    });
    expect(resolved).toMatchObject({
      routeProvider: "fixture",
      routeQuality: "actual",
      route: { geometry: { coordinates: [{}, {}, {}] } },
    });
  });

  test("does not call the provider when either endpoint is blocked", async () => {
    const route = vi.fn<DirectionsProvider["route"]>();
    const [pending] = await resolveRouteCandidates([{
      kind: "between_items",
      arrivalDayId: "day-1",
      fromItineraryItemId: "item-a",
      toItineraryItemId: "item-b",
      transportModeCode: "WALK",
      sourceVersion: "source-v1",
      sourceContext: {},
      blockers: ["to_location_unresolved"],
      fromLocation: { id: "location-a", point: { longitude: 121.48, latitude: 31.2 } },
      toLocation: null,
    }], { route }, "fixture", "fixture");

    expect(route).not.toHaveBeenCalled();
    expect(pending).toMatchObject({ route: null, routeProvider: null, routeQuality: "unknown" });
  });
});

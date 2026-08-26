import { describe, expect, test, vi } from "vitest";

import { ProviderError, type DirectionsProvider } from "@on-the-road/providers";
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

  test("retries retryable provider errors with a bounded exponential policy", async () => {
    const route = vi.fn<DirectionsProvider["route"]>()
      .mockRejectedValueOnce(new ProviderError("PROVIDER_RATE_LIMITED", "slow down", true))
      .mockRejectedValueOnce(new ProviderError("PROVIDER_TIMEOUT", "timeout", true))
      .mockResolvedValue({
        kind: "resolved",
        geometry: { type: "LineString", coordinates: [
          { longitude: 121.48, latitude: 31.2, crs: "WGS84" },
          { longitude: 121.49, latitude: 31.21, crs: "WGS84" },
        ] },
        mode: "WALK",
        attribution: "fixture directions",
      });
    const sleep = vi.fn(async () => {});
    const [resolved] = await resolveRouteCandidates([{
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
    }], { route }, "fixture", "fixture", {
      baseBackoffMs: 0,
      minIntervalMs: 0,
      sleep,
    });

    expect(route).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(resolved).toMatchObject({ routeQuality: "actual", routeAttempts: 3, routeErrorCode: null });
  });

  test("honors a seven-second Retry-After without truncating it to the backoff cap", async () => {
    const route = vi.fn<DirectionsProvider["route"]>()
      .mockRejectedValueOnce(new ProviderError(
        "PROVIDER_RATE_LIMITED",
        "slow down",
        true,
        undefined,
        { retryAfterSeconds: 7 },
      ))
      .mockResolvedValue({
        kind: "resolved",
        geometry: { type: "LineString", coordinates: [
          { longitude: 121.48, latitude: 31.2, crs: "WGS84" },
          { longitude: 121.49, latitude: 31.21, crs: "WGS84" },
        ] },
        mode: "WALK",
        attribution: "fixture directions",
      });
    const sleep = vi.fn(async () => {});
    await resolveRouteCandidates([{
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
    }], { route }, "fixture", "fixture", {
      minIntervalMs: 0,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(7_000);
  });

  test("persists a non-retryable provider failure without retrying", async () => {
    const route = vi.fn<DirectionsProvider["route"]>().mockRejectedValue(
      new ProviderError("PROVIDER_REQUEST_INVALID", "bad request", false),
    );
    const [failed] = await resolveRouteCandidates([{
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
    }], { route }, "fixture", "fixture", {
      minIntervalMs: 0,
      sleep: vi.fn(async () => {}),
    });

    expect(route).toHaveBeenCalledTimes(1);
    expect(failed).toMatchObject({
      route: null,
      routeProvider: "fixture",
      routeQuality: "unknown",
      routeErrorCode: "PROVIDER_REQUEST_INVALID",
      routeAttempts: 1,
    });
  });

  test("does not start a provider call after the generation becomes stale", async () => {
    const route = vi.fn<DirectionsProvider["route"]>();
    const [stale] = await resolveRouteCandidates([{
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
    }], { route }, "fixture", "fixture", {
      beforeProvider: async () => false,
      minIntervalMs: 0,
    });

    expect(route).not.toHaveBeenCalled();
    expect(stale).toMatchObject({ route: null, routeErrorCode: null, routeAttempts: 0 });
  });

  test("limits concurrent provider calls", async () => {
    let active = 0;
    let maximum = 0;
    const route = vi.fn<DirectionsProvider["route"]>(async (request) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return {
        kind: "resolved",
        geometry: { type: "LineString", coordinates: [request.from, request.to] },
        mode: request.mode,
        attribution: "fixture directions",
      };
    });
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      kind: "between_items",
      arrivalDayId: "day-1",
      fromItineraryItemId: `item-${index}`,
      toItineraryItemId: `item-${index + 1}`,
      transportModeCode: "WALK",
      sourceVersion: `source-v${index}`,
      sourceContext: {},
      blockers: [],
      fromLocation: { id: `location-${index}`, point: { longitude: 121.48, latitude: 31.2 } },
      toLocation: { id: `location-${index + 1}`, point: { longitude: 121.49, latitude: 31.21 } },
    }));

    await resolveRouteCandidates(candidates, { route }, "fixture", "fixture", {
      concurrency: 2,
      maxAttempts: 1,
      minIntervalMs: 0,
    });

    expect(route).toHaveBeenCalledTimes(candidates.length);
    expect(maximum).toBeLessThanOrEqual(2);
  });
});

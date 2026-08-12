import { describe, expect, test } from "vitest";

import {
  deriveGeocodingBatchStatus,
  deriveImportJobReadiness,
  geocodingRetryDelay,
  type GeocodingBatchCounts,
} from "../../src/processors/geocoding/postgres-batch-processor.js";
import { createFixtureGeocoder } from "@on-the-road/providers/geocoding";

const counts = (overrides: Partial<GeocodingBatchCounts> = {}): GeocodingBatchCounts => ({
  total: 4,
  queued: 0,
  resolving: 0,
  resolved: 4,
  ambiguous: 0,
  failed: 0,
  cancelled: 0,
  ...overrides,
});

describe("geocoding batch policy", () => {
  test("only completes after every unit has left queued/resolving", () => {
    expect(deriveGeocodingBatchStatus(counts({ queued: 1, resolved: 3 }), false)).toBe("running");
    expect(deriveGeocodingBatchStatus(counts({ resolving: 1, resolved: 3 }), false)).toBe("running");
    expect(deriveGeocodingBatchStatus(counts({ ambiguous: 1, resolved: 3 }), false)).toBe("completed_with_warnings");
  });

  test("turns a cancellation request into a terminal cancellation only at a checkpoint", () => {
    expect(deriveGeocodingBatchStatus(counts({ resolving: 1, resolved: 3 }), true)).toBe("running");
    expect(deriveGeocodingBatchStatus(counts({ cancelled: 1, resolved: 3 }), true)).toBe("cancelled");
  });

  test("only waits for confirmation while unresolved import rows remain", () => {
    expect(deriveImportJobReadiness(2, false)).toBe("confirmation_required");
    expect(deriveImportJobReadiness(0, false)).toBe("ready_to_import");
    expect(deriveImportJobReadiness(0, true)).toBe("cancelled");
  });

  test("backs off provider 429/5xx retries and respects Retry-After", () => {
    expect(geocodingRetryDelay(1, { baseBackoffMs: 500, maxBackoffMs: 30_000 })).toBe(500);
    expect(geocodingRetryDelay(3, { baseBackoffMs: 500, maxBackoffMs: 30_000 })).toBe(2_000);
    expect(geocodingRetryDelay(2, { baseBackoffMs: 500, maxBackoffMs: 30_000, retryAfterSeconds: 8 })).toBe(8_000);
    expect(geocodingRetryDelay(2, { baseBackoffMs: 500, maxBackoffMs: 3_000, retryAfterSeconds: 8 })).toBe(3_000);
  });

  test("fixture provider accepts an explicit batch trigger and remains offline", async () => {
    const provider = createFixtureGeocoder({ profile: "fixture-global" });
    await expect(provider.search({ query: "人民广场", trigger: "batch" })).resolves.toHaveLength(2);
  });
});

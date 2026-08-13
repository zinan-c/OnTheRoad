import { describe, expect, test } from "vitest";

import {
  InMemoryGeocodingStateStore,
  PolicyGeocoder,
  type Geocoder,
  type NormalizedCandidate,
} from "@on-the-road/providers/geocoding";
import { PostgresGeocodingBatchProcessor } from "../../src/processors/geocoding/postgres-batch-processor.js";
import { FakeGeocodingDatabase } from "./fake-batch-database.js";

function candidate(label: string): NormalizedCandidate {
  return {
    id: `fixture:${label}`,
    label,
    point: { longitude: 121.47, latitude: 31.23, crs: "WGS84" },
    countryCode: "CN",
    providerScore: 1,
    attribution: "On The Road fixture",
    selected: false,
    provider: "fixture",
    mapProfile: "fixture-cn",
  };
}

describe("TC-E06-01 batch scheduling and progress", () => {
  test("uses the geocoding cache and reconciles resolved/ambiguous/failed provider buckets", async () => {
    const upstreamCalls: Array<{ query: string; trigger?: string; mapProfile?: string }> = [];
    const upstream: Geocoder = {
      provider: "fixture",
      profile: "fixture-cn",
      capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
      async search(request) {
        upstreamCalls.push({
          query: request.query,
          trigger: request.trigger,
          mapProfile: request.context?.mapProfile,
        });
        if (request.query === "ambiguous") return [candidate("one"), candidate("two")];
        if (request.query === "missing") return [];
        return [candidate(request.query)];
      },
      async reverse() { return null; },
    };
    const geocoder = new PolicyGeocoder(upstream, {
      store: new InMemoryGeocodingStateStore(),
      cacheTtlSeconds: 300,
      bucket: { capacity: 20, refillPerSecond: 20 },
    });
    const database = new FakeGeocodingDatabase([
      { id: "job-1", query: "cached" },
      { id: "job-2", query: "cached" },
      { id: "job-3", query: "ambiguous" },
      { id: "job-4", query: "missing" },
    ]);
    const processor = new PostgresGeocodingBatchProcessor({
      executor: database as never,
      geocoder,
      maxConcurrency: 1,
      sleep: async () => {},
    });

    await processor.process(database.batchId);

    expect(upstreamCalls).toHaveLength(3);
    expect(upstreamCalls.every(({ trigger }) => trigger === "batch")).toBe(true);
    expect(upstreamCalls.every(({ mapProfile }) => mapProfile === "cn_primary")).toBe(true);
    expect(database.batch).toMatchObject({
      status: "completed_with_warnings",
      total: 4,
      queued: 0,
      resolving: 0,
      resolved: 2,
      ambiguous: 1,
      failed: 1,
      cancelled: 0,
    });
    expect(database.stagedLocations.size).toBe(3);
  });
});

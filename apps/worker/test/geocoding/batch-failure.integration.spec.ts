import { describe, expect, test, vi } from "vitest";

import { GeocoderError, type Geocoder } from "@on-the-road/providers/geocoding";
import {
  PostgresGeocodingBatchProcessor,
  geocodingRetryDelay,
} from "../../src/processors/geocoding/postgres-batch-processor.js";
import { FakeGeocodingDatabase } from "./fake-batch-database.js";

const success = {
  id: "fixture:success",
  label: "Success",
  point: { longitude: 121.47, latitude: 31.23, crs: "WGS84" as const },
  countryCode: "CN",
  providerScore: 1,
  attribution: "On The Road fixture",
  selected: false as const,
  provider: "fixture" as const,
  mapProfile: "fixture-cn",
};

describe("TC-E06-02 batch failure, cancellation and recovery", () => {
  test("honors Retry-After, isolates permanent failures, and leaves progress database-recoverable", async () => {
    expect(geocodingRetryDelay(1, {
      baseBackoffMs: 100,
      maxBackoffMs: 5_000,
      retryAfterSeconds: 3,
    })).toBe(3_000);

    const attempts = new Map<string, number>();
    const geocoder: Geocoder = {
      provider: "fixture",
      profile: "fixture-cn",
      capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
      async search({ query }) {
        const count = (attempts.get(query) ?? 0) + 1;
        attempts.set(query, count);
        if (query === "rate-limited" && count === 1) {
          throw new GeocoderError("PROVIDER_RATE_LIMITED", "fixture throttled", {
            retryable: true,
            retryAfterSeconds: 3,
            provider: "fixture",
          });
        }
        if (query === "server-error") {
          throw new GeocoderError("PROVIDER_UNAVAILABLE", "fixture unavailable", {
            retryable: true,
            provider: "fixture",
          });
        }
        if (query === "permanent") return [];
        return [success];
      },
      async reverse() { return null; },
    };
    const database = new FakeGeocodingDatabase([
      { id: "job-rate", query: "rate-limited" },
      { id: "job-server", query: "server-error", maxAttempts: 1 },
      { id: "job-permanent", query: "permanent" },
    ]);
    const sleep = vi.fn(async () => {});
    const processor = new PostgresGeocodingBatchProcessor({
      executor: database as never,
      geocoder,
      maxConcurrency: 1,
      baseBackoffMs: 100,
      maxBackoffMs: 5_000,
      sleep,
    });

    await processor.process(database.batchId);

    expect(database.retryDelays).toEqual([3_000]);
    expect(attempts.get("rate-limited")).toBe(2);
    expect(database.batch).toMatchObject({ status: "completed_with_warnings", resolved: 1, failed: 2 });
    expect(database.jobs.map((job) => job.status)).toEqual(["resolved", "failed", "failed"]);
    expect(await processor.listRecoverableBatchIds()).toEqual([]);
    expect(sleep).not.toHaveBeenCalled();

    const recoverable = new FakeGeocodingDatabase([{ id: "job-recoverable", query: "queued" }]);
    recoverable.batch.status = "running";
    expect(await new PostgresGeocodingBatchProcessor({
      executor: recoverable as never,
      geocoder,
    }).listRecoverableBatchIds()).toEqual([recoverable.batchId]);
  });

  test("cancels queued units and reconciles the parent ImportJob after queue loss", async () => {
    const geocoder: Geocoder = {
      provider: "fixture",
      profile: "fixture-cn",
      capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
      async search() { throw new Error("cancelled work must not reach provider"); },
      async reverse() { return null; },
    };
    const database = new FakeGeocodingDatabase([
      { id: "job-cancelled-1", query: "one" },
      { id: "job-cancelled-2", query: "two" },
    ]);
    database.batch.cancelRequestedAt = new Date().toISOString();
    const processor = new PostgresGeocodingBatchProcessor({ executor: database as never, geocoder });

    await processor.process(database.batchId);

    expect(database.batch).toMatchObject({ status: "cancelled", queued: 0, resolving: 0, cancelled: 2 });
    expect(database.importJobStatus).toBe("cancelled");
    expect(database.jobs.every((job) => job.status === "cancelled")).toBe(true);
  });
});

import { describe, expect, test } from "vitest";

import { PostgresGeocodingBatchProcessor } from "../../../apps/worker/src/processors/geocoding/postgres-batch-processor.js";
import { FakeGeocodingDatabase } from "../../../apps/worker/test/geocoding/fake-batch-database.js";
import { PostgresImportCommitProcessor } from "../../../apps/worker/src/processors/import/postgres-commit-processor.js";
import { FakeCommitDatabase, type FakeImportJob, type FakeImportRow } from "../../../apps/worker/test/import/fake-commit-database.js";

const tripId = "00000000-0000-4000-8000-000000000401";
const ownerId = "m4-commit-owner";

function importJob(id: string): FakeImportJob {
  return {
    id,
    trip_id: tripId,
    owner_id: ownerId,
    source_sha256: "a".repeat(64),
    importer_version: "runtime-1",
    mapping_hash: "mapping-m4",
    status: "confirmation_required",
    committed_rows: 0,
    imported_rows: 0,
    error_rows: 0,
    default_currency: "CNY",
  };
}

function importRow(
  id: string,
  sourceRowKey: string,
  fingerprint: string,
  normalizedData: Record<string, unknown>,
  stagedLocation: Record<string, unknown> | null = null,
): FakeImportRow {
  return {
    id,
    source_row_key: sourceRowKey,
    fingerprint,
    normalized_data: normalizedData,
    status: "ready",
    decision_scope: "default",
    staged_location: stagedLocation,
  };
}

describe("TC-M4-INT-01 geocode-confirm-commit-route", () => {
  test("resolves an ambiguous place, accepts text-only fallback, then commits facts once", async () => {
    const geocoding = new FakeGeocodingDatabase([
      { id: "geocode-ambiguous", query: "老城", stagingId: "staged-ambiguous" },
      { id: "geocode-resolved", query: "博物馆", stagingId: "staged-resolved" },
    ]);
    const batchProcessor = new PostgresGeocodingBatchProcessor({
      executor: geocoding as never,
      geocoder: {
        provider: "fixture",
        profile: "fixture-cn",
        capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
        async search({ query }) {
          return query === "老城"
            ? [
              { id: "fixture:old-town-a", label: "老城 A", point: { longitude: 121.47, latitude: 31.23, crs: "WGS84" }, countryCode: "CN", providerScore: 0.8, attribution: "fixture", selected: false, provider: "fixture", mapProfile: "fixture-cn" },
              { id: "fixture:old-town-b", label: "老城 B", point: { longitude: 121.48, latitude: 31.24, crs: "WGS84" }, countryCode: "CN", providerScore: 0.7, attribution: "fixture", selected: false, provider: "fixture", mapProfile: "fixture-cn" },
            ]
            : [{ id: "fixture:museum", label: "博物馆", point: { longitude: 121.49, latitude: 31.25, crs: "WGS84" }, countryCode: "CN", providerScore: 1, attribution: "fixture", selected: false, provider: "fixture", mapProfile: "fixture-cn" }];
        },
        async reverse() { return null; },
      },
      maxConcurrency: 2,
      sleep: async () => {},
    });
    await batchProcessor.process(geocoding.batchId);
    expect(geocoding.batch).toMatchObject({ status: "completed_with_warnings", ambiguous: 1, resolved: 1 });
    expect(geocoding.stagedLocations.get("staged-ambiguous")?.candidates).toHaveLength(2);

    const job = importJob("import-m4-commit");
    job.status = "importing";
    const database = new FakeCommitDatabase([job], {
      [job.id]: [
        importRow("row-candidate", "Itinerary:2", "fingerprint-candidate", {
          day: 1, target: "老城", address: "老城", cost: 30, currency: "CNY",
        }, {
          decisionType: "candidate",
          inputText: "老城",
          name: "老城 A",
          point: { latitude: 31.23, longitude: 121.47, crs: "WGS84" },
        }),
        importRow("row-text", "Itinerary:3", "fingerprint-text", {
          day: 1, target: "机场接送", cost: 80, currency: "CNY",
        }, {
          decisionType: "accept_text",
          inputText: "机场接送",
          name: "机场接送",
        }),
      ],
    });
    const processor = new PostgresImportCommitProcessor({ executor: database as never, chunkSize: 1 });

    const first = await processor.process(job.id);
    expect(first).toMatchObject({ status: "completed", insertedRows: 2, committedRows: 2 });
    expect(database.items).toHaveLength(2);
    expect(database.locations).toHaveLength(1);
    expect([...database.locations.values()]).toEqual([
      expect.objectContaining({ name: "老城 A", status: "resolved", point: { latitude: 31.23, longitude: 121.47 } }),
    ]);
    expect(database.expenses).toHaveLength(2);
    expect(database.ledger).toHaveLength(2);
    expect(database.claims).toHaveLength(2);
    expect(database.queue.filter(({ name }) => name === "route.rebuild.requested")).toHaveLength(2);
    expect(database.routeGenerations.get("day-1")).toBe(3);

    const replay = await processor.process(job.id);
    expect(replay.status).toBe("completed");
    expect(database.items).toHaveLength(2);
    expect(database.locations).toHaveLength(1);
    expect(database.expenses).toHaveLength(2);
    expect(database.ledger).toHaveLength(2);
    expect(database.routeGenerations.get("day-1")).toBe(3);
  });
});

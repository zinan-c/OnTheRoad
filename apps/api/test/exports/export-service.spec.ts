import { describe, expect, test } from "vitest";

import { PostgresExportService } from "../../src/modules/exports/service.mjs";

const trip = {
  id: "00000000-0000-4000-8000-000000000001",
  owner_id: "owner-1",
  name: "Fixture trip",
  start_date: "2026-08-01",
  end_date: "2026-08-02",
  total_days: 2,
  travelers: 1,
  default_currency: "CNY",
  budget: null,
  timezone: "Asia/Shanghai",
  map_profile: "cn_primary",
  description: "A frozen export fixture",
  status: "active",
  version: 3,
};

function database(options: { attachmentStatus?: string } = {}) {
  const attachmentStatus = options.attachmentStatus ?? "ready";
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      if (text.includes("FROM trip\n")) return { rows: [trip] };
      if (text.includes("FROM trip_day")) return { rows: [{ id: "day-1", day_number: 1, date: "2026-08-01", day_of_week: 6, is_workday: false, version: 1, route_generation: 1 }] };
      if (text.includes("FROM itinerary_item")) return { rows: [{ id: "item-1", trip_day_id: "day-1", item_type: "attraction", time_kind: "unscheduled", start_time: null, end_time: null, end_day_offset: 0, time_zone: null, time_period: null, target: "Museum", description: "A place", duration_minutes: null, destination_id: null, location_id: "location-1", start_location_id: null, end_location_id: null, transport_mode_code: null, remark: null, external_source: null, external_id: null, sort_order: 0, version: 1, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z", location_name: "Museum", location_address: "Museum Road", location_point: { longitude: 121.47, latitude: 31.23 } }] };
      if (text.includes("FROM expense")) return { rows: [] };
      if (text.includes("FROM route_segment")) return { rows: [] };
      if (text.includes("FROM attachment")) return { rows: [{ id: "attachment-1", itinerary_item_id: null, status: attachmentStatus, object_version: attachmentStatus === "ready" ? "v1" : null, checksum_sha256: attachmentStatus === "ready" ? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" : null, content_type: "image/png", width: 100, height: 100, caption: null, sort_order: 0 }] };
      if (text.includes("FROM destination")) return { rows: [] };
      if (text.includes("FROM export_job")) return { rows: [] };
      return { rows: [] };
    },
  };
  const job = {
    id: "00000000-0000-4000-8000-000000000009",
    tripId: trip.id,
    ownerId: "owner-1",
    createdBy: "owner-1",
    idempotencyKey: "export-1",
    tripVersion: trip.version,
    status: "queued",
    stage: "assets",
    options: {},
    optionsHash: "a".repeat(64),
    templateVersion: "m4-print-v1",
    templateHash: "b".repeat(64),
    snapshotSchemaVersion: 1,
    snapshot: {},
    snapshotHash: "c".repeat(64),
    omissionCount: 0,
    warnings: [],
    assetManifest: [],
  };
  return {
    queries,
    async transaction<T>(operation: (value: typeof client) => Promise<T>) {
      return operation(client);
    },
    async json() {
      return job;
    },
  };
}

describe("F01 export job service", () => {
  test("previews a repeatable-read snapshot without treating generated maps as media blockers", async () => {
    const db = database();
    const service = new PostgresExportService({ database: db });
    const preview = await service.preview("owner-1", trip.id, {
      sections: ["global_map"],
      mediaPolicy: "require_all",
    });
    expect(preview.snapshot.tripVersion).toBe(3);
    expect(preview.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "map:overview", kind: "map", status: "processing" }),
    ]));
    expect(preview.blockingAssets).toEqual([]);
    expect(preview.canCreate).toBe(true);
  });

  test("require_all rejects a failed attachment before creating an ExportJob", async () => {
    const db = database({ attachmentStatus: "failed" });
    const service = new PostgresExportService({ database: db });
    await expect(service.create("owner-1", trip.id, {
      idempotencyKey: "export-1",
      sections: ["gallery"],
      mediaPolicy: "require_all",
    })).rejects.toMatchObject({ code: "EXPORT_ASSETS_NOT_READY", status: 409 });
    expect(db.queries.some((query) => query.includes("INSERT INTO export_job"))).toBe(false);
  });
});

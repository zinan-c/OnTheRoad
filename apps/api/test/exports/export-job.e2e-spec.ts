import { describe, expect, test } from "vitest";

import { PostgresExportService } from "../../src/modules/exports/service.mjs";
import { exportState, FakeExportDatabase } from "./fake-export-database";

const tripId = "00000000-0000-4000-8000-000000000001";

describe("TC-F01-03 atomic ExportJob API", () => {
  test("persists a queued snapshot, replays an idempotency key, and rejects option reuse", async () => {
    const state = exportState();
    const calls: unknown[][] = [];
    const service = new PostgresExportService({
      database: new FakeExportDatabase(state),
      queue: { add: async (...args: unknown[]) => { calls.push(args); return {}; } },
    });
    const input = {
      idempotencyKey: "f01-export-replay",
      sections: ["cover", "daily_itinerary"],
      mediaPolicy: "require_all",
    };

    const first = await service.create("owner-1", tripId, input);
    expect(first).toMatchObject({
      status: "queued",
      snapshot: { tripId, tripVersion: 3 },
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(calls).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);

    const replay = await service.create("owner-1", tripId, input);
    expect(replay.id).toBe(first.id);
    expect(calls).toHaveLength(1);

    await expect(service.create("owner-1", tripId, {
      ...input,
      orientation: "landscape",
    })).rejects.toMatchObject({ code: "EXPORT_IDEMPOTENCY_KEY_REUSED", status: 409 });
    expect(state.jobs).toHaveLength(1);
  });

  test("reuses a completed snapshot only when facts/options match and freezes later Trip edits", async () => {
    const state = exportState();
    const calls: unknown[][] = [];
    const service = new PostgresExportService({
      database: new FakeExportDatabase(state),
      queue: { add: async (...args: unknown[]) => { calls.push(args); return {}; } },
    });
    const original = await service.create("owner-1", tripId, {
      idempotencyKey: "f01-export-freeze-1",
      sections: ["cover", "daily_itinerary"],
      mediaPolicy: "require_all",
    });
    state.jobs[0]!.status = "completed";
    state.jobs[0]!.completed_at = "2026-08-13T00:05:00.000Z";
    state.trip.version = 4;
    state.trip.name = "Edited after export";
    state.items[0]!.target = "Edited item";

    const changed = await service.create("owner-1", tripId, {
      idempotencyKey: "f01-export-freeze-2",
      sections: ["cover", "daily_itinerary"],
      mediaPolicy: "require_all",
    });
    expect(changed.id).not.toBe(original.id);
    expect(changed.tripVersion).toBe(4);
    expect(changed.snapshot.facts.trip).toMatchObject({ name: "Edited after export" });
    expect(state.jobs).toHaveLength(2);
    expect(state.jobs[0]!.snapshot.facts).toMatchObject({
      trip: expect.objectContaining({ name: "Fixture trip" }),
      days: expect.arrayContaining([
        expect.objectContaining({ items: [expect.objectContaining({ target: "Museum" })] }),
      ]),
    });
    expect(calls).toHaveLength(2);
  });
});

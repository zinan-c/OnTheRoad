import { describe, expect, test } from "vitest";

import {
  DEFAULT_EXPORT_OPTIONS,
  blockingExportAssets,
  exportSnapshotHash,
  hashExportTemplate,
  normalizeExportOptions,
} from "../../src/export/snapshot.js";

const snapshot = (capturedAt: string) => ({
  schemaVersion: 1,
  tripId: "trip-1",
  tripVersion: 4,
  facts: { trip: { name: "上海" } },
  assets: [],
  capturedAt,
});

describe("TC-F01-01 export snapshot preflight", () => {
  test("normalizes A4 defaults and section toggles", () => {
    expect(normalizeExportOptions({ orientation: "landscape", sections: ["cover", "expenses"], mediaPolicy: "ready_only" })).toEqual({
      paper: "A4",
      orientation: "landscape",
      sections: ["cover", "expenses"],
      mediaPolicy: "ready_only",
    });
    expect(DEFAULT_EXPORT_OPTIONS.paper).toBe("A4");
    expect(() => normalizeExportOptions({ sections: ["cover", "cover"] })).toThrow("repeat");
  });

  test("hash excludes capture time so identical snapshots can be reused", () => {
    expect(exportSnapshotHash(snapshot("2026-08-12T00:00:00.000Z")))
      .toBe(exportSnapshotHash(snapshot("2026-08-12T00:00:01.000Z")));
    expect(hashExportTemplate("m4-print-v1")).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("reports only required non-ready assets as blockers", () => {
    const assets = [
      { id: "ready", kind: "image" as const, contentType: "image/png", checksumSha256: "a".repeat(64), objectVersion: "v1", width: 10, height: 10, required: true, status: "ready" as const, omissionReason: null },
      { id: "missing", kind: "map" as const, contentType: "image/png", checksumSha256: null, objectVersion: null, width: null, height: null, required: true, status: "missing" as const, omissionReason: "not rendered" },
      { id: "optional", kind: "image" as const, contentType: "image/png", checksumSha256: null, objectVersion: null, width: null, height: null, required: false, status: "processing" as const, omissionReason: null },
    ];
    expect(blockingExportAssets(assets).map(({ id }) => id)).toEqual(["missing"]);
  });
});

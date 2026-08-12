import { describe, expect, test } from "vitest";

import {
  assertExportOptions,
  assertExportSnapshot,
  assertExportJobTransition,
  hashCanonicalJson,
} from "../../src/export/contracts.js";

const checksum = "a".repeat(64);

function snapshot(facts: Record<string, unknown> = { tripName: "上海周末" }) {
  return {
    schemaVersion: 1,
    tripId: "trip-1",
    tripVersion: 7,
    facts,
    assets: [{
      id: "map:overview",
      kind: "map" as const,
      contentType: "image/png",
      checksumSha256: checksum,
      objectVersion: "v1",
      width: 1280,
      height: 720,
      required: true,
      status: "ready" as const,
      omissionReason: null,
    }],
    capturedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("TC-F01-01 canonical snapshot/hash", () => {
  test("key ordering does not change the hash but fact changes do", () => {
    expect(hashCanonicalJson({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(hashCanonicalJson({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashCanonicalJson(snapshot())).not.toBe(hashCanonicalJson(snapshot({ tripName: "杭州周末" })));
    expect(() => assertExportSnapshot(snapshot())).not.toThrow();
  });

  test("snapshot rejects signed URLs and permits explicit non-ready omissions", () => {
    expect(() => assertExportSnapshot({
      ...snapshot({ media: { signedUrl: "https://example.test/temporary" } }),
    })).toThrow(/ephemeral URL/iu);
    expect(() => assertExportSnapshot({
      ...snapshot(),
      assets: [{
        ...snapshot().assets[0]!,
        status: "missing",
        checksumSha256: null,
        objectVersion: null,
        omissionReason: "attachment not ready",
      }],
    })).not.toThrow();
  });
});

describe("M4 Wave0 export state and option contracts", () => {
  test("options are constrained and terminal jobs cannot transition", () => {
    expect(() => assertExportOptions({
      paper: "A4",
      orientation: "portrait",
      sections: ["cover", "overview", "global_map"],
      mediaPolicy: "ready_only",
    })).not.toThrow();
    expect(() => assertExportJobTransition("queued", "rendering")).not.toThrow();
    expect(() => assertExportJobTransition("completed", "rendering")).toThrow();
  });
});

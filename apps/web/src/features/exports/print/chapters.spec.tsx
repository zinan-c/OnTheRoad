// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import type { ExportSection, ExportSnapshot } from "@on-the-road/application/export";
import { PrintTemplate } from "./print-template";
import { buildPrintChapters, buildPrintManifest } from "./chapters";

afterEach(cleanup);

const ready = "a".repeat(64);

function snapshot(): ExportSnapshot {
  return {
    schemaVersion: 1,
    tripId: "trip-1",
    tripVersion: 4,
    capturedAt: "2026-08-12T00:00:00.000Z",
    facts: {
      trip: { name: "上海五日" },
      overview: { travelers: 2, timezone: "Asia/Shanghai" },
      globalMap: { assetId: "map:global" },
      days: [{
        id: "day-1",
        dayNumber: 1,
        date: "2026-09-01",
        items: [{ id: "item-1", target: "外滩", description: "黄昏散步", expense: "CNY 12" }],
        mapAssetId: "map:day-1",
      }],
      expenses: [{ id: "expense-1", amount: "12 CNY" }],
      notes: ["只读快照"],
    },
    assets: [
      { id: "map:global", kind: "map", contentType: "image/png", checksumSha256: ready, objectVersion: "v1", width: 1200, height: 800, required: true, status: "ready", omissionReason: null },
      { id: "map:day-1", kind: "map", contentType: "image/png", checksumSha256: ready, objectVersion: "v2", width: 1200, height: 800, required: true, status: "ready", omissionReason: null },
      { id: "image:missing", kind: "image", contentType: "image/jpeg", checksumSha256: null, objectVersion: null, width: null, height: null, required: false, status: "missing", omissionReason: "not processed" },
    ],
  };
}

const sections: readonly ExportSection[] = ["cover", "overview", "global_map", "daily_itinerary", "daily_map", "expenses", "notes", "omissions"];

describe("TC-F03-01 print chapter switches", () => {
  test("renders selected chapters from the snapshot only", async () => {
    const chapters = buildPrintChapters(snapshot(), sections);
    expect(chapters.map(({ section }) => section)).toEqual(sections);
    expect(chapters.find(({ section }) => section === "daily_itinerary")?.data.days).toHaveLength(1);
    expect(buildPrintManifest(snapshot(), chapters).referencedAssetIds).toEqual(["map:global", "map:day-1"]);

    render(<PrintTemplate snapshot={snapshot()} sections={sections} snapshotHash="snapshot-hash" />);
    expect(screen.getByRole("heading", { name: "旅行计划" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "每日行程" })).toBeTruthy();
    expect(screen.getByText("外滩")).toBeTruthy();
    expect(screen.getByText("只读快照")).toBeTruthy();
    expect(screen.getByRole("list", { name: "遗漏资源" })).toBeTruthy();
    await waitFor(() => expect(document.querySelector("[data-print-ready='ready']")).toBeTruthy());
  });
});

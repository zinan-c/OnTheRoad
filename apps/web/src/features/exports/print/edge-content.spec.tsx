// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { vi } from "vitest";

import type { ExportSnapshot } from "@on-the-road/application/export";
import { PrintTemplate } from "./print-template";

afterEach(cleanup);

function edgeSnapshot(): ExportSnapshot {
  return {
    schemaVersion: 1,
    tripId: "trip-edge",
    tripVersion: 1,
    capturedAt: "2026-08-12T00:00:00.000Z",
    facts: {
      trip: { name: "A".repeat(1_000) },
      days: [{ id: "empty-day", dayNumber: 1, date: null, items: [] }],
      notes: [],
    },
    assets: [{ id: "map:missing", kind: "map", contentType: "image/png", checksumSha256: null, objectVersion: null, width: null, height: null, required: true, status: "failed", omissionReason: "renderer timeout" }],
  };
}

describe("TC-F03-02 long/empty/missing-resource content", () => {
  test("keeps empty sections readable and exposes omissions without API calls", () => {
    const request = vi.spyOn(globalThis, "fetch");
    render(<PrintTemplate snapshot={edgeSnapshot()} sections={["cover", "daily_itinerary", "global_map", "omissions"]} />);
    expect(screen.getByText("当天没有行程安排。")).toBeTruthy();
    expect(screen.getByText(/renderer timeout/iu)).toBeTruthy();
    expect(screen.getByText("暂无地图资源，详见遗漏清单。")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });
});

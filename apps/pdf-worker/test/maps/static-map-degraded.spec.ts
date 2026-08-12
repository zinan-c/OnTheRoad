import { describe, expect, test } from "vitest";

import {
  detectStaticMapBlank,
  renderStaticMapAsset,
} from "@on-the-road/providers/static-map/renderer";

const baseRequest = {
  assetId: "map:degraded",
  scope: "day" as const,
  width: 320,
  height: 180,
  pixelRatio: 1 as const,
  markers: [],
  routes: [],
  routeGeometries: [],
  legend: [{ label: "降级地图", color: "#667085", kind: "degraded" as const }],
  attribution: "On The Road fixture",
  tilePolicy: { mode: "fixture" as const, allowedHosts: [] },
};

describe("TC-F02-02 static map degraded renderer", () => {
  test("detects a neutral grid as blank feature content but accepts a marker pixel", () => {
    expect(detectStaticMapBlank(Uint8Array.from([244, 246, 248, 217, 225, 232, 152, 162, 179]))).toBe(true);
    expect(detectStaticMapBlank(Uint8Array.from([244, 246, 248, 21, 94, 239]))).toBe(false);
    expect(() => detectStaticMapBlank(Uint8Array.from([1, 2]))).toThrow("RGB");
  });

  test("fits a single point and marks a no-tile render as degraded", () => {
    const result = renderStaticMapAsset({
      ...baseRequest,
      markers: [{
        id: "single",
        label: "single point",
        dayNumber: 1,
        color: "#2563eb",
        point: { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
      }],
      tilePolicy: { mode: "disabled", allowedHosts: [] },
    });
    expect(result.manifest.bounds?.east).toBeGreaterThan(result.manifest.bounds?.west ?? 0);
    expect(result.manifest.bounds?.north).toBeGreaterThan(result.manifest.bounds?.south ?? 0);
    expect(result.manifest.degraded).toBe(true);
    expect(result.manifest.degradationReason).toContain("disabled");
  });

  test("uses a world bound for antimeridian-scale input without requesting a tile host", () => {
    const result = renderStaticMapAsset({
      ...baseRequest,
      markers: [
        { id: "west", label: "west", dayNumber: null, color: "#2563eb", point: { longitude: -179, latitude: 10, crs: "WGS84" } },
        { id: "east", label: "east", dayNumber: null, color: "#16a34a", point: { longitude: 179, latitude: 11, crs: "WGS84" } },
      ],
    });
    expect(result.manifest.bounds).toMatchObject({ west: -180, east: 180 });
    expect(result.manifest.degraded).toBe(false);
  });

  test("rejects URL-shaped hosts so the renderer cannot silently broaden the allowlist", () => {
    expect(() => renderStaticMapAsset({
      ...baseRequest,
      tilePolicy: { mode: "allowlisted", allowedHosts: ["https://tiles.example.test"] },
    })).toThrow("allowlist");
  });
});

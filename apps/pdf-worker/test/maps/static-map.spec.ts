import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  renderStaticMapAsset,
  type StaticMapAssetRenderRequest,
} from "@on-the-road/providers/static-map/renderer";

const point = (longitude: number, latitude: number) => ({ longitude, latitude, crs: "WGS84" as const });

const request: StaticMapAssetRenderRequest = {
  assetId: "map:overview",
  scope: "overview",
  width: 640,
  height: 360,
  pixelRatio: 2,
  markers: [
    { id: "item-1", label: "外滩", dayNumber: 1, color: "#2563eb", point: point(121.49, 31.24) },
    { id: "item-2", label: "普陀山", dayNumber: 4, color: "#16a34a", point: point(122.39, 30.0) },
  ],
  routes: [{ id: "route-1", color: "#155eef", pointCount: 3, approximate: false }],
  routeGeometries: [{
    id: "route-1",
    color: "#155eef",
    approximate: false,
    coordinates: [point(121.49, 31.24), point(121.85, 30.95), point(122.39, 30.0)],
  }],
  legend: [
    { label: "行程点", color: "#2563eb", kind: "marker" },
    { label: "路线", color: "#155eef", kind: "route" },
  ],
  attribution: "On The Road fixture",
  tilePolicy: { mode: "fixture", allowedHosts: [] },
};

describe("TC-F02-01 static map asset", () => {
  test("renders a deterministic 2x PNG and durable manifest", () => {
    const first = renderStaticMapAsset(request);
    const second = renderStaticMapAsset(request);
    expect(first.bytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(first.bytes).toEqual(second.bytes);
    expect(first.manifest.checksumSha256).toBe(createHash("sha256").update(first.bytes).digest("hex"));
    expect(first.manifest).toMatchObject({
      contentType: "image/png",
      status: "ready",
      width: 640,
      height: 360,
      pixelRatio: 2,
      degraded: false,
      attribution: "On The Road fixture",
      bounds: { west: 121.38199999999999, east: 122.498, south: 29.8512, north: 31.3888 },
    });
    expect(first.manifest.markers).toHaveLength(2);
    expect(first.manifest.routes).toEqual([{ id: "route-1", color: "#155eef", pointCount: 3, approximate: false }]);
    expect(first.manifest.legend.map(({ kind }) => kind)).toEqual(["marker", "route"]);
  });
});

describe("TC-F02-02 static map fallback", () => {
  test("keeps marker and route readable when tile rendering is disabled", () => {
    const result = renderStaticMapAsset({ ...request, tilePolicy: { mode: "disabled", allowedHosts: [] } });
    expect(result.manifest.degraded).toBe(true);
    expect(result.manifest.degradationReason).toContain("disabled");
    expect(result.manifest.legend.at(-1)?.kind).toBe("degraded");
    expect(result.bytes.length).toBeGreaterThan(100);
  });

  test("marks an empty geometry as degraded but still returns a non-blank neutral grid", () => {
    const result = renderStaticMapAsset({
      ...request,
      assetId: "map:empty",
      markers: [],
      routes: [],
      routeGeometries: [],
      tilePolicy: { mode: "fixture", allowedHosts: [] },
    });
    expect(result.manifest.degraded).toBe(true);
    expect(result.manifest.degradationReason).toContain("no marker");
    expect(result.bytes.length).toBeGreaterThan(100);
  });

  test("rejects an allowlisted policy without an allowlist", () => {
    expect(() => renderStaticMapAsset({
      ...request,
      tilePolicy: { mode: "allowlisted", allowedHosts: [] },
    })).toThrow("allowlisted");
  });
});

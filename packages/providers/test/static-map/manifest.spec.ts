import { describe, expect, test } from "vitest";

import {
  assertStaticMapAssetManifest,
  type StaticMapAssetManifest,
} from "../../src/static-map/manifest.js";

const base: StaticMapAssetManifest = {
  assetId: "map:overview",
  scope: "overview",
  contentType: "image/png",
  status: "ready",
  checksumSha256: "a".repeat(64),
  width: 1280,
  height: 720,
  pixelRatio: 2,
  bounds: { north: 31.3, south: 30.9, east: 121.7, west: 121.2 },
  markers: [{
    id: "item-1",
    label: "外滩",
    dayNumber: 1,
    color: "#2563eb",
    point: { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
  }],
  routes: [{ id: "route-1", color: "#2563eb", pointCount: 3, approximate: false }],
  legend: [
    { label: "行程点", color: "#2563eb", kind: "marker" },
    { label: "路线", color: "#2563eb", kind: "route" },
  ],
  attribution: "On The Road fixture",
  degraded: false,
  degradationReason: null,
};

describe("TC-F02-01 static map asset manifest", () => {
  test("requires durable dimensions, checksum and attribution metadata", () => {
    expect(() => assertStaticMapAssetManifest(base)).not.toThrow();
    expect(() => assertStaticMapAssetManifest({
      ...base,
      status: "missing",
      checksumSha256: null,
      degraded: true,
      degradationReason: "tile host is disabled in CI",
    })).not.toThrow();
  });

  test("degraded output must explain the fallback and ready output must be hashed", () => {
    expect(() => assertStaticMapAssetManifest({
      ...base,
      degraded: true,
      degradationReason: null,
    })).toThrow();
    expect(() => assertStaticMapAssetManifest({
      ...base,
      checksumSha256: null,
    })).toThrow();
  });
});

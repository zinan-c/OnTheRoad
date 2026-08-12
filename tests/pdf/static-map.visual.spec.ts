import { expect, test } from "vitest";

import { renderStaticMapAsset } from "../../packages/providers/src/static-map/renderer.js";

test("TC-F02-03 full-five-day print map fixture keeps route, range and attribution", () => {
  const result = renderStaticMapAsset({
    assetId: "map:full-five-day",
    scope: "overview",
    width: 1024,
    height: 576,
    pixelRatio: 2,
    markers: [
      { id: "day-1", label: "Day 1", dayNumber: 1, color: "#2563eb", point: { longitude: 121.49, latitude: 31.24, crs: "WGS84" } },
      { id: "day-5", label: "Day 5", dayNumber: 5, color: "#16a34a", point: { longitude: 121.8052, latitude: 31.1434, crs: "WGS84" } },
      { id: "day-4", label: "Day 4", dayNumber: 4, color: "#f97316", point: { longitude: 122.39, latitude: 30.0, crs: "WGS84" } },
    ],
    routes: [{ id: "route-full", color: "#155eef", pointCount: 5, approximate: true }],
    routeGeometries: [{
      id: "route-full",
      color: "#155eef",
      approximate: true,
      coordinates: [
        { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
        { longitude: 121.8052, latitude: 31.1434, crs: "WGS84" },
        { longitude: 122.0, latitude: 30.7, crs: "WGS84" },
        { longitude: 122.39, latitude: 30.0, crs: "WGS84" },
        { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
      ],
    }],
    legend: [
      { label: "行程点", color: "#2563eb", kind: "marker" },
      { label: "近似路线", color: "#155eef", kind: "route" },
    ],
    attribution: "On The Road fixture",
    tilePolicy: { mode: "fixture", allowedHosts: [] },
  });
  expect(result.manifest.width * result.manifest.pixelRatio).toBe(2048);
  expect(result.manifest.height * result.manifest.pixelRatio).toBe(1152);
  expect(result.manifest.bounds).toMatchObject({ west: 121.38199999999999, east: 122.498 });
  expect(result.manifest.markers.map(({ dayNumber }) => dayNumber)).toEqual([1, 5, 4]);
  expect(result.manifest.routes[0]?.approximate).toBe(true);
  expect(result.manifest.attribution).toBe("On The Road fixture");
  expect(result.bytes.length).toBeGreaterThan(1_000);
});

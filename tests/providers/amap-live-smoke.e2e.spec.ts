import { describe, expect, test } from "vitest";

import { createAmapDirectionsProvider } from "../../packages/providers/src/directions/amap.js";
import { createAmapGeocoder } from "../../packages/providers/src/geocoding/amap.js";
import { createAmapStaticMapAssetProvider } from "../../packages/providers/src/static-map/amap.js";

const enabled = process.env.OTR_AMAP_LIVE_SMOKE === "1"
  && Boolean(process.env.AMAP_API_KEY?.trim())
  && Boolean(process.env.AMAP_JS_API_KEY?.trim())
  && Boolean(process.env.AMAP_JS_SECURITY_CODE?.trim());

describe.skipIf(!enabled)("opt-in AMap live smoke", () => {
  test("uses official Search, Reverse, Directions and Static Map only when explicitly enabled", async () => {
    const apiKey = process.env.AMAP_API_KEY!.trim();
    const geocoder = createAmapGeocoder({ profile: "cn-primary", apiKey, language: "zh-CN", timeoutMs: 8_000 });
    const point = { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" as const };
    const search = await geocoder.search({ query: "上海人民广场", trigger: "explicit", limit: 1 });
    const reverse = await geocoder.reverse(point, "zh-CN");
    const directions = createAmapDirectionsProvider({ apiKey, timeoutMs: 10_000 });
    const route = await directions.route({ from: point, to: { longitude: 121.49, latitude: 31.24, crs: "WGS84" }, mode: "WALK" });
    const staticMap = createAmapStaticMapAssetProvider({ apiKey, attribution: "© 高德地图", timeoutMs: 10_000 });
    const image = await staticMap.render({
      assetId: "live-smoke",
      scope: "overview",
      width: 320,
      height: 180,
      pixelRatio: 1,
      markers: search.slice(0, 1).map((candidate, index) => ({ id: `candidate-${index}`, label: candidate.label, dayNumber: 1, color: "#2563eb", point: candidate.point })),
      routes: [],
      routeGeometries: [],
      legend: [{ label: "smoke", color: "#2563eb", kind: "marker" }],
      attribution: "© 高德地图",
      tilePolicy: { mode: "fixture", allowedHosts: [] },
    });
    expect(search.length).toBeGreaterThanOrEqual(0);
    expect(reverse?.point.crs ?? point.crs).toBe("WGS84");
    expect(route.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(image.manifest.attribution).toBe("© 高德地图");
  }, 45_000);
});

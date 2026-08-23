import { describe, expect, test } from "vitest";

import { createAmapStaticMapAssetProvider } from "../../src/static-map/amap.js";
import type { StaticMapAssetRenderRequest } from "../../src/static-map/renderer.js";
import { wgs84ToGcj02 } from "../../src/coordinates/gcj02.js";

const point = (longitude: number, latitude: number) => ({ longitude, latitude, crs: "WGS84" as const });
const request: StaticMapAssetRenderRequest = {
  assetId: "map:overview",
  scope: "overview",
  width: 640,
  height: 360,
  pixelRatio: 1,
  markers: [{ id: "one", label: "外滩", dayNumber: 1, color: "#2563eb", point: point(121.49, 31.24) }],
  routes: [{ id: "route", color: "#155eef", pointCount: 2, approximate: false }],
  routeGeometries: [{ id: "route", color: "#155eef", approximate: false, coordinates: [point(121.49, 31.24), point(121.5, 31.25)] }],
  legend: [{ label: "路线", color: "#155eef", kind: "route" }],
  attribution: "© 高德地图",
  tilePolicy: { mode: "fixture", allowedHosts: [] },
};

describe("AMap Static Map adapter", () => {
  test("uses the official endpoint, sends GCJ02 geometry, and validates image responses", async () => {
    let requested: URL | undefined;
    const provider = createAmapStaticMapAssetProvider({
      apiKey: "amap-secret",
      baseUrl: "https://restapi.amap.com/v3/staticmap",
      attribution: "© 高德地图",
      fetch: async (url) => {
        requested = url;
        return new Response(Uint8Array.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
      },
    });
    const result = await provider.render(request);
    const gcj = wgs84ToGcj02(request.markers[0]!.point);
    expect(requested?.hostname).toBe("restapi.amap.com");
    expect(requested?.pathname).toBe("/v3/staticmap");
    expect(requested?.searchParams.get("key")).toBe("amap-secret");
    expect(requested?.searchParams.get("location")).not.toBe(`${request.markers[0]!.point.longitude},${request.markers[0]!.point.latitude}`);
    expect(requested?.searchParams.get("markers")).toContain(`${gcj.longitude.toFixed(6)},${gcj.latitude.toFixed(6)}`);
    expect(result.manifest).toMatchObject({ status: "ready", degraded: false, contentType: "image/png", attribution: "© 高德地图" });
    expect(result.bytes).toEqual(Uint8Array.from([137, 80, 78, 71]));
  });

  test.each([
    [429, "rate limit"],
    [503, "service"],
  ])("falls back with an explicit reason for HTTP %s", async (status, expected) => {
    const provider = createAmapStaticMapAssetProvider({
      apiKey: "amap-key",
      attribution: "© 高德地图",
      fetch: async () => new Response("", { status }),
    });
    const result = await provider.render(request);
    expect(result.manifest.degraded).toBe(true);
    expect(result.manifest.degradationReason).toContain(expected);
    expect(result.manifest.attribution).toBe("© 高德地图");
    expect(result.bytes.length).toBeGreaterThan(100);
  });

  test("falls back on invalid content and missing credentials without making a normal-looking manifest", async () => {
    const invalid = createAmapStaticMapAssetProvider({ apiKey: "amap-key", attribution: "© 高德地图", fetch: async () => Response.json({ error: "not an image" }) });
    const missing = createAmapStaticMapAssetProvider({ apiKey: "", attribution: "© 高德地图", fetch: async () => { throw new Error("must not call network"); } });
    await expect(invalid.render(request)).resolves.toMatchObject({ manifest: { degraded: true, degradationReason: expect.stringContaining("not an image") } });
    await expect(missing.render(request)).resolves.toMatchObject({ manifest: { degraded: true, degradationReason: expect.stringContaining("not configured") } });
  });
});

import { describe, expect, test } from "vitest";

import {
  createAmapDirectionsProvider,
  type DirectionsFetch,
} from "../../src/directions/amap.js";
import { wgs84ToGcj02 } from "../../src/coordinates/gcj02.js";

const from = { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" as const };
const to = { longitude: 121.49, latitude: 31.24, crs: "WGS84" as const };

function responseFor(points = [from, to]) {
  const polyline = points.map((point) => {
    const gcj = wgs84ToGcj02(point);
    return `${gcj.longitude},${gcj.latitude}`;
  }).join(";");
  return Response.json({ status: "1", route: { paths: [{ steps: [{ polyline }] }] } });
}

describe("AMap Directions adapter", () => {
  test("maps walking/bicycling/driving paths and converts merged step polylines back to WGS84", async () => {
    const requested: URL[] = [];
    const fetch: DirectionsFetch = async (url) => {
      requested.push(url);
      return responseFor([from, { longitude: 121.48, latitude: 31.235, crs: "WGS84" }, to]);
    };
    const provider = createAmapDirectionsProvider({ apiKey: "amap-key", fetch, drivingStrategy: 2 });

    await expect(provider.route({ from, to, mode: "WALK" })).resolves.toMatchObject({ kind: "resolved" });
    await expect(provider.route({ from, to, mode: "BICYCLE" })).resolves.toMatchObject({ kind: "resolved" });
    await expect(provider.route({ from, to, mode: "SELF_DRIVE" })).resolves.toMatchObject({ kind: "resolved" });

    expect(requested.map((url) => url.pathname)).toEqual([
      "/v5/direction/walking",
      "/v5/direction/bicycling",
      "/v5/direction/driving",
    ]);
    expect(requested[2]?.searchParams.get("strategy")).toBe("2");
    expect(requested[0]?.searchParams.get("origin")).not.toBe(`${from.longitude},${from.latitude}`);
    const result = await provider.route({ from, to, mode: "WALK" });
    expect(result.geometry.coordinates[0]?.longitude).toBeCloseTo(from.longitude, 5);
    expect(result.geometry.coordinates.at(-1)?.latitude).toBeCloseTo(to.latitude, 5);
  });

  test("requires transit city context and uses the integrated transit endpoint", async () => {
    const requested: URL[] = [];
    const provider = createAmapDirectionsProvider({
      apiKey: "amap-key",
      fetch: async (url) => { requested.push(url); return responseFor(); },
    });
    await expect(provider.route({ from, to, mode: "METRO" })).rejects.toMatchObject({ code: "PROVIDER_REQUEST_INVALID" });
    await expect(provider.route({ from, to, mode: "PUBLIC_BUS", city: "上海", cityd: "上海" })).resolves.toMatchObject({ kind: "resolved" });
    expect(requested[0]?.pathname).toBe("/v5/direction/transit/integrated");
    expect(requested[0]?.searchParams.get("city")).toBe("上海");
    expect(requested[0]?.searchParams.get("cityd")).toBe("上海");
  });

  test("uses the first path with valid merged geometry", async () => {
    const provider = createAmapDirectionsProvider({
      apiKey: "amap-key",
      fetch: async () => Response.json({
        status: "1",
        route: {
          paths: [
            { steps: [{ polyline: "bad" }] },
            { steps: [{ polyline: "121.4737,31.2304;121.48,31.24" }] },
          ],
        },
      }),
    });

    await expect(provider.route({ from, to, mode: "WALK" })).resolves.toMatchObject({
      kind: "resolved",
      geometry: { type: "LineString", coordinates: expect.any(Array) },
    });
  });

  test("returns only explicit approximations and never approximates provider failures", async () => {
    const fetch = async () => { throw new Error("network down"); };
    const provider = createAmapDirectionsProvider({ apiKey: "amap-key", fetch });
    await expect(provider.route({ from, to, mode: "MOTORCYCLE" })).resolves.toMatchObject({ kind: "approximate" });
    await expect(provider.route({ from, to, mode: "FLIGHT" })).resolves.toMatchObject({ kind: "approximate" });
    await expect(provider.route({ from, to, mode: "WALK" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  test.each([
    [401, "PROVIDER_CREDENTIALS_INVALID"],
    [429, "PROVIDER_RATE_LIMITED"],
    [504, "PROVIDER_TIMEOUT"],
  ] as const)("normalizes HTTP %s without returning an approximate route", async (status, code) => {
    const provider = createAmapDirectionsProvider({
      apiKey: "amap-key",
      fetch: async () => new Response("", { status }),
    });
    await expect(provider.route({ from, to, mode: "WALK" })).rejects.toMatchObject({ code });
  });
});

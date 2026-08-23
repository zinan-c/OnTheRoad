import { describe, expect, test } from "vitest";

import {
  assertGcj02Point,
  gcj02ToWgs84,
  wgs84ToGcj02,
} from "../../src/coordinates/gcj02.js";

describe("shared GCJ02 coordinate boundary", () => {
  test.each([
    { longitude: 121.4737, latitude: 31.2304 },
    { longitude: 116.3974, latitude: 39.9093 },
    { longitude: 113.2644, latitude: 23.1291 },
  ])("round trips WGS84 within a metre for $longitude,$latitude", (input) => {
    const wgs84 = { ...input, crs: "WGS84" as const };
    const gcj02 = wgs84ToGcj02(wgs84);
    expect(gcj02.crs).toBe("GCJ02");
    expect(gcj02.longitude).not.toBeCloseTo(wgs84.longitude, 5);
    const restored = gcj02ToWgs84(gcj02);
    const metres = Math.hypot(
      (restored.longitude - wgs84.longitude) * 111_320 * Math.cos((wgs84.latitude * Math.PI) / 180),
      (restored.latitude - wgs84.latitude) * 110_574,
    );
    expect(metres).toBeLessThan(1);
  });

  test("keeps an outside-China point numerically stable while preserving the provider CRS", () => {
    const wgs84 = { longitude: -73.9857, latitude: 40.7484, crs: "WGS84" as const };
    const gcj02 = wgs84ToGcj02(wgs84);
    expect(gcj02).toEqual({ longitude: wgs84.longitude, latitude: wgs84.latitude, crs: "GCJ02" });
    expect(gcj02ToWgs84(gcj02)).toEqual(wgs84);
  });

  test("rejects a point with the wrong CRS at the provider boundary", () => {
    expect(() => assertGcj02Point({ longitude: 121, latitude: 31, crs: "WGS84" } as never)).toThrow("GCJ02");
  });
});

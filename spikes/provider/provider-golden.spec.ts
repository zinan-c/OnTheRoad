import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { geoGolden } from "./fixtures/geo-golden.js";
import { startMockHere, type MockHere } from "./fixtures/mock-here.js";
import {
  HereAdapter,
  coordinateErrorMeters,
  resolveMapProfile,
  toWgs84
} from "./src/index.js";

describe("TC-A08-01 Provider golden points", () => {
  let mock: MockHere;
  beforeAll(async () => { mock = await startMockHere(); });
  afterAll(async () => { await mock.close(); });

  test("TC-A08-01 converts 10+ domestic and international points to WGS84", () => {
    expect(geoGolden.length).toBeGreaterThanOrEqual(10);
    for (const point of geoGolden) {
      const actual = toWgs84(point.source, point.sourceCrs);
      expect(actual.crs).toBe("WGS84");
      expect(coordinateErrorMeters(actual, point.expectedWgs84)).toBeLessThanOrEqual(3);
    }
  });

  test("TC-A08-01 searches and reverses A12 locations with attribution", async () => {
    const adapter = new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-cn",
      language: "zh-CN",
      apiKey: "fixture-key",
      fetchImplementation: mock.fetchImplementation
    });
    const candidates = await adapter.search({ query: "外滩", context: { countryCodes: ["CHN"] } });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.find((candidate) => candidate.label === "外滩")).toMatchObject({
      label: "外滩",
      coordinate: { longitude: 121.4906, latitude: 31.2413, crs: "WGS84" },
      selected: false
    });
    expect(candidates.every((candidate) => candidate.attribution === "© HERE")).toBe(true);
    expect(candidates.every((candidate) => candidate.provider === "here")).toBe(true);

    const reverse = await adapter.reverse({ longitude: 121.4906, latitude: 31.2413, crs: "WGS84" });
    expect(reverse.label).toBe("外滩");
    expect(reverse.coordinate.crs).toBe("WGS84");
    expect(mock.fixtureVersion).toBe("minimal-five-day@1");
  });

  test("TC-A08-01 resolves mapProfile without location-dependent switching", () => {
    expect(resolveMapProfile("fixture-cn")).toMatchObject({
      id: "fixture-cn",
      provider: "here",
      domainCrs: "WGS84",
      endpointMode: "explicit"
    });
    expect(() => resolveMapProfile("unknown")).toThrowError(/MAP_PROFILE_UNKNOWN/u);
  });

  test("TC-A08-01 uses HERE discover only for a strict bounding box", async () => {
    const adapter = new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-cn",
      language: "zh-CN",
      apiKey: "fixture-key",
      fetchImplementation: mock.fetchImplementation
    });
    await adapter.search({
      query: "外滩",
      context: { countryCodes: ["CHN"], viewbox: [121.4, 31.1, 121.6, 31.3] }
    });
    const request = mock.requests.at(-1);
    expect(request?.pathname).toBe("/v1/discover");
    expect(request?.searchParams.getAll("in")).toEqual([
      "countryCode:CHN",
      "bbox:121.4,31.1,121.6,31.3"
    ]);
    expect(request?.searchParams.get("apiKey")).toBe("fixture-key");
  });
});

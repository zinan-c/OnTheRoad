import { describe, expect, test } from "vitest";

import {
  createFixtureGeocoder,
  createHereGeocoder,
  type GeocodingFetch,
} from "../../src/geocoding/index.js";

const hereFetch: GeocodingFetch = async (url) => {
  if (url.pathname.endsWith("/revgeocode")) {
    return Response.json({ items: [{
      id: "here:reverse:bund",
      title: "The Bund, Shanghai",
      position: { lat: 31.24001, lng: 121.49002 },
      address: { label: "The Bund, Shanghai", countryCode: "CHN", city: "Shanghai" },
    }] });
  }
  return Response.json({ items: [
    {
      id: "here:shanghai",
      title: "上海市",
      position: { lat: 31.2304, lng: 121.4737 },
      address: { label: "上海市, 中国", countryCode: "CHN", city: "上海市" },
      scoring: { queryScore: 0.91 },
    },
    {
      id: "here:other",
      title: "Shanghai, US",
      position: { lat: 40.1, lng: -89.1 },
      address: { label: "Shanghai, United States", countryCode: "USA" },
      scoring: { queryScore: 0.99 },
    },
  ] });
};

describe("TC-C02-01 Geocoder adapter contract", () => {
  test("normalizes Chinese/English context search, capability and attribution", async () => {
    const adapter = createHereGeocoder({
      profile: "commercial-required",
      apiKey: "test-only-key",
      language: "zh-CN",
      fetch: hereFetch,
    });
    expect(adapter.capabilities()).toEqual({
      search: true,
      reverse: true,
      autocomplete: false,
      fuzzy: true,
    });

    const candidates = await adapter.search({
      query: " 上海 ",
      locale: "zh-CN",
      context: { countryCodes: ["chn"] },
      limit: 5,
    });
    expect(candidates[0]).toMatchObject({
      id: "here:shanghai",
      label: "上海市",
      countryCode: "chn",
      city: "上海市",
      point: { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" },
      attribution: "© HERE",
      selected: false,
      provider: "here",
      mapProfile: "commercial-required",
    });
    expect(candidates[0]?.providerScore).toBeGreaterThan(candidates[1]?.providerScore ?? 0);

    await expect(adapter.reverse({
      longitude: 121.49002,
      latitude: 31.24001,
      crs: "WGS84",
    }, "en")).resolves.toMatchObject({
      label: "The Bund, Shanghai",
      attribution: "© HERE",
    });
  });

  test("development fixture is explicit, offline and never claims autocomplete", async () => {
    const adapter = createFixtureGeocoder({ profile: "fixture-cn" });
    expect(adapter.capabilities().autocomplete).toBe(false);
    await expect(adapter.search({ query: "上海" })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({
        attribution: "On The Road fixture",
        mapProfile: "fixture-cn",
      })]),
    );
  });
});

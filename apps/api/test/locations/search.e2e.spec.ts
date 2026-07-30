import { describe, expect, test, vi } from "vitest";

import {
  createConfiguredLocationSearchApi,
  createLocationSearchApi,
} from "../../src/modules/locations/search.js";
import {
  createFixtureGeocoder,
  GeocoderError,
} from "@on-the-road/providers/geocoding";

describe("TC-C02-03 location search API and controlled offline smoke", () => {
  test("runs fixture search/capability/attribution without a socket", async () => {
    const api = createConfiguredLocationSearchApi({ MAP_PROFILE: "fixture" });
    expect(api.capabilities()).toEqual({
      provider: "fixture",
      mapProfile: "fixture",
      search: true,
      reverse: true,
      autocomplete: false,
      fuzzy: true,
    });
    const result = await api.search({
      query: "上海",
      locale: "zh-CN",
      context: { countryCodes: ["CHN"] },
      trigger: "explicit",
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toMatchObject({
      selected: false,
      point: { crs: "WGS84" },
      attribution: "On The Road fixture",
      mapProfile: "fixture",
    });
    expect(result.candidates[0]).not.toHaveProperty("providerPlaceId");
  });

  test("rejects missing credentials at construction and never silently changes provider", async () => {
    expect(() => createConfiguredLocationSearchApi({
      MAP_PROFILE: "international_primary",
      OTR_HERE_API_KEY: "",
    })).toThrowError(GeocoderError);
    expect(() => createConfiguredLocationSearchApi({
      MAP_PROFILE: "cn_primary",
      AMAP_API_KEY: "",
    })).toThrowError(expect.objectContaining({
      code: "PROVIDER_CREDENTIALS_MISSING",
      provider: "amap",
    }));
    expect(() => createConfiguredLocationSearchApi({
      MAP_PROFILE: "hybrid",
      AMAP_API_KEY: "amap-present",
      OTR_HERE_API_KEY: "",
    })).toThrowError(expect.objectContaining({
      code: "PROVIDER_CREDENTIALS_MISSING",
      provider: "here",
    }));

    const api = createLocationSearchApi({
      geocoder: createFixtureGeocoder({ profile: "fixture-global" }),
    });
    await expect(api.search({
      query: "Shanghai",
      trigger: "autocomplete",
    })).rejects.toMatchObject({ code: "PROVIDER_TRIGGER_UNSUPPORTED" });
  });

  test("constructs cn_primary and deterministically routes hybrid without fallback", async () => {
    const hosts: string[] = [];
    const fetch = async (url: URL) => {
      hosts.push(url.hostname);
      if (url.hostname === "restapi.amap.com") {
        return Response.json({
          status: "1",
          pois: [{
            id: "amap:shanghai",
            name: "上海",
            location: "121.478223,31.228457",
          }],
        });
      }
      return Response.json({
        items: [{
          id: "here:new-york",
          title: "New York",
          position: { lat: 40.7128, lng: -74.006 },
          address: { countryCode: "USA", city: "New York" },
        }],
      });
    };
    const cn = createConfiguredLocationSearchApi({
      MAP_PROFILE: "cn_primary",
      AMAP_API_KEY: "fixture-amap-key",
    }, { fetch });
    const cnResult = await cn.search({
      query: "上海",
      context: { countryCodes: ["CHN"] },
    });
    expect(cnResult).toMatchObject({
      provider: "amap",
      mapProfile: "cn_primary",
    });
    expect(cnResult.candidates[0]).toMatchObject({
      provider: "amap",
      point: { crs: "WGS84" },
    });

    const hybrid = createConfiguredLocationSearchApi({
      MAP_PROFILE: "hybrid",
      AMAP_API_KEY: "fixture-amap-key",
      OTR_HERE_API_KEY: "fixture-here-key",
    }, { fetch });
    await hybrid.search({
      query: "上海",
      context: { countryCodes: ["CHN"] },
    });
    await hybrid.search({
      query: "New York",
      context: { countryCodes: ["USA"] },
    });
    expect(hosts).toEqual([
      "restapi.amap.com",
      "restapi.amap.com",
      "geocode.search.hereapi.com",
    ]);
  });

  test("uses only OTR_HERE_API_KEY in a controlled in-process HERE smoke", async () => {
    const requests: URL[] = [];
    const api = createConfiguredLocationSearchApi({
      MAP_PROFILE: "international_primary",
      MAP_LANGUAGE: "en",
      OTR_HERE_API_KEY: "fixture-here-key",
      OTR_HERE_APP_ID: "must-not-be-sent",
    }, {
      fetch: async (url) => {
        requests.push(url);
        return Response.json({ items: [{
          id: "here:fixture:shanghai",
          title: "Shanghai",
          position: { lat: 31.2304, lng: 121.4737 },
          address: { countryCode: "CHN", city: "Shanghai" },
        }] });
      },
    });
    const result = await api.search({ query: "Shanghai", limit: 1 });
    expect(result.provider).toBe("here");
    expect(result.mapProfile).toBe("international_primary");
    expect(result.candidates[0]?.mapProfile).toBe("international_primary");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.hostname).toBe("geocode.search.hereapi.com");
    expect(requests[0]?.searchParams.get("apiKey")).toBe("fixture-here-key");
    expect(requests[0]?.search).not.toContain("must-not-be-sent");
  });

  test("logs provider context but redacts API key and sensitive query text", async () => {
    const info = vi.fn();
    const api = createLocationSearchApi({
      geocoder: createFixtureGeocoder({ profile: "fixture-cn" }),
      logger: { info },
    });
    await api.search({ query: "上海市浦东新区世纪大道 100 号" });
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).toContain("queryFingerprint");
    expect(serialized).not.toContain("世纪大道");
    expect(serialized).not.toContain("OTR_HERE_API_KEY");
  });
});

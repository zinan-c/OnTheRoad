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

    const ambiguous = await api.searchForResolution({ query: "人民广场", trigger: "explicit" });
    expect(ambiguous.candidates).toHaveLength(2);
    expect(ambiguous.candidates.map(({ city, district }) => ({ city, district }))).toEqual([
      { city: "上海", district: "黄浦区" },
      { city: "重庆", district: "渝中区" },
    ]);
    expect(ambiguous.candidates[0]?.id).toBe("fixture:loc-people-square-shanghai");
  });

  test("rejects missing credentials at construction and never silently changes provider", async () => {
    expect(() => createConfiguredLocationSearchApi({
      MAP_PROFILE: "international_primary",
      OTR_NOMINATIM_USER_AGENT: "",
      OTR_NOMINATIM_CONTACT: "",
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
      OTR_NOMINATIM_USER_AGENT: "",
      OTR_NOMINATIM_CONTACT: "",
    })).toThrowError(expect.objectContaining({
      code: "PROVIDER_CREDENTIALS_MISSING",
      provider: "nominatim",
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
      return Response.json([{
        osm_type: "node",
        osm_id: 2001,
        display_name: "New York",
        lat: "40.7128",
        lon: "-74.006",
        address: { country_code: "us", city: "New York" },
      }]);
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
      OTR_NOMINATIM_USER_AGENT: "on-the-road-test/1.0",
      OTR_NOMINATIM_CONTACT: "test@example.com",
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
      "nominatim.openstreetmap.org",
    ]);
  });

  test("uses the configured Nominatim identity in a controlled in-process smoke", async () => {
    const requests: URL[] = [];
    const api = createConfiguredLocationSearchApi({
      MAP_PROFILE: "international_primary",
      MAP_LANGUAGE: "en",
      OTR_NOMINATIM_USER_AGENT: "on-the-road-test/1.0",
      OTR_NOMINATIM_CONTACT: "test@example.com",
    }, {
      fetch: async (url) => {
        requests.push(url);
        if (url.pathname.endsWith("/reverse")) {
          return Response.json({
            osm_type: "node",
            osm_id: 3002,
            display_name: "The Bund, Shanghai",
            lat: "31.24001",
            lon: "121.49002",
            address: { country_code: "cn", city: "Shanghai" },
          });
        }
        return Response.json([{
          osm_type: "node",
          osm_id: 3001,
          display_name: "Shanghai",
          lat: "31.2304",
          lon: "121.4737",
          address: { country_code: "cn", city: "Shanghai" },
        }]);
      },
    });
    const result = await api.search({ query: "Shanghai", limit: 1 });
    expect(result.provider).toBe("nominatim");
    expect(result.mapProfile).toBe("international_primary");
    expect(result.candidates[0]?.mapProfile).toBe("international_primary");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.hostname).toBe("nominatim.openstreetmap.org");
    expect(requests[0]?.searchParams.get("email")).toBe("test@example.com");
    expect(requests[0]?.searchParams.get("apiKey")).toBeNull();
    await expect(api.reverse({
      longitude: 121.49002,
      latitude: 31.24001,
      crs: "WGS84",
    })).resolves.toMatchObject({
      id: "osm:node:3002",
      provider: "nominatim",
      point: { crs: "WGS84" },
    });
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
    expect(serialized).not.toContain("OTR_NOMINATIM_CONTACT");
  });
});

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
      MAPBOX_PUBLIC_TOKEN: "mapbox-public",
      MAPBOX_GEOCODING_TOKEN: "",
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
      MAPBOX_PUBLIC_TOKEN: "mapbox-public",
      MAPBOX_GEOCODING_TOKEN: "",
    })).toThrowError(expect.objectContaining({
      code: "PROVIDER_CREDENTIALS_MISSING",
      provider: "mapbox",
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
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          id: "place.new-york",
          geometry: { type: "Point", coordinates: [-74.006, 40.7128] },
          properties: {
            mapbox_id: "place.new-york",
            name: "New York",
            context: { country: { country_code: "US" }, place: { name: "New York" } },
          },
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
      MAPBOX_PUBLIC_TOKEN: "mapbox-public",
      MAPBOX_GEOCODING_TOKEN: "mapbox-server-key",
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
      "api.mapbox.com",
    ]);
  });

  test("uses the configured Mapbox Permanent token in a controlled in-process smoke", async () => {
    const requests: URL[] = [];
    const api = createConfiguredLocationSearchApi({
      MAP_PROFILE: "international_primary",
      MAP_LANGUAGE: "en",
      MAPBOX_PUBLIC_TOKEN: "mapbox-public",
      MAPBOX_GEOCODING_TOKEN: "mapbox-server-key",
    }, {
      fetch: async (url) => {
        requests.push(url);
        return Response.json({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            id: "place.shanghai",
            geometry: { type: "Point", coordinates: [121.4737, 31.2304] },
            properties: {
              mapbox_id: url.pathname.endsWith("/reverse") ? "place.reverse-shanghai" : "place.shanghai",
              name: url.pathname.endsWith("/reverse") ? "The Bund, Shanghai" : "Shanghai",
              context: { country: { country_code: "CN" }, place: { name: "Shanghai" } },
            },
          }],
        });
      },
    });
    const result = await api.search({ query: "Shanghai", limit: 1 });
    expect(result.provider).toBe("mapbox");
    expect(result.mapProfile).toBe("international_primary");
    expect(result.candidates[0]?.mapProfile).toBe("international_primary");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.hostname).toBe("api.mapbox.com");
    expect(requests[0]?.searchParams.get("permanent")).toBe("true");
    expect(requests[0]?.searchParams.get("autocomplete")).toBe("false");
    expect(requests[0]?.searchParams.get("access_token")).toBe("mapbox-server-key");
    await expect(api.reverse({
      longitude: 121.49002,
      latitude: 31.24001,
      crs: "WGS84",
    })).resolves.toMatchObject({
      id: "place.reverse-shanghai",
      provider: "mapbox",
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

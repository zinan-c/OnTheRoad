import { describe, expect, test } from "vitest";

import {
  createAmapGeocoder,
  createFixtureGeocoder,
  createHereGeocoder,
  createHybridGeocoder,
  createMapboxGeocoder,
  createNominatimGeocoder,
  gcj02ToWgs84,
  wgs84ToGcj02,
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

const nominatimFetch: GeocodingFetch = async (url) => {
  if (url.pathname.endsWith("/reverse")) {
    return Response.json({
      osm_type: "node",
      osm_id: 4242,
      lat: "31.24001",
      lon: "121.49002",
      display_name: "The Bund, Shanghai, China",
      address: { country_code: "cn", city: "Shanghai", city_district: "Huangpu" },
      licence: "Data © OpenStreetMap contributors, ODbL 1.0.",
    });
  }
  return Response.json([
    {
      osm_type: "node",
      osm_id: 1001,
      lat: "31.2304",
      lon: "121.4737",
      name: "上海市",
      display_name: "上海市, 中国",
      type: "city",
      class: "place",
      importance: 0.91,
      address: { country_code: "cn", city: "上海市", city_district: "黄浦区" },
      licence: "Data © OpenStreetMap contributors, ODbL 1.0.",
    },
    {
      osm_type: "way",
      osm_id: 1002,
      lat: "40.1",
      lon: "-89.1",
      display_name: "Shanghai, United States",
      address: { country_code: "us", city: "Shanghai" },
      licence: "Data © OpenStreetMap contributors, ODbL 1.0.",
    },
  ]);
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

  test("normalizes Nominatim OSM identity, WGS84, context, attribution and reverse", async () => {
    const requested: URL[] = [];
    const adapter = createNominatimGeocoder({
      profile: "public-online",
      baseUrl: "https://nominatim.test/proxy",
      userAgent: "on-the-road-test/1.0",
      contact: "test@example.com",
      language: "en",
      fetch: async (url, init) => {
        requested.push(url);
        expect(init?.headers).toMatchObject({ "user-agent": "on-the-road-test/1.0" });
        return nominatimFetch(url, init);
      },
    });
    const candidates = await adapter.search({
      query: " 上海 ",
      locale: "zh-CN",
      context: {
        countryCodes: ["CHN"],
        viewbox: [120, 30, 122, 32],
      },
      limit: 5,
    });
    expect(candidates[0]).toMatchObject({
        id: "osm:node:1001",
        label: "上海市",
        point: { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" },
        countryCode: "cn",
        city: "上海市",
        district: "黄浦区",
        provider: "nominatim",
        attribution: "Data © OpenStreetMap contributors, ODbL 1.0.",
    });
    expect(requested[0]?.searchParams.get("format")).toBe("jsonv2");
    expect(requested[0]?.pathname).toBe("/proxy/search");
    expect(requested[0]?.searchParams.get("countrycodes")).toBe("cn");
    expect(requested[0]?.searchParams.get("viewbox")).toBe("120,32,122,30");
    expect(requested[0]?.searchParams.get("email")).toBe("test@example.com");
    await expect(adapter.search({ query: "Shanghai", trigger: "autocomplete" })).rejects.toMatchObject({
      code: "PROVIDER_TRIGGER_UNSUPPORTED",
      provider: "nominatim",
    });
    await expect(adapter.reverse({
      longitude: 121.49002,
      latitude: 31.24001,
      crs: "WGS84",
    }, "zh-CN")).resolves.toMatchObject({
      id: "osm:node:4242",
      label: "The Bund, Shanghai, China",
      point: { longitude: 121.49002, latitude: 31.24001, crs: "WGS84" },
      provider: "nominatim",
    });
  });

  test("normalizes AMAP GCJ-02 search/reverse coordinates to the WGS84 domain", async () => {
    const requested: URL[] = [];
    const fetch: GeocodingFetch = async (url) => {
      requested.push(url);
      if (url.pathname.endsWith("/regeo")) {
        return Response.json({
          status: "1",
          infocode: "10000",
          regeocode: {
            formatted_address: "上海市黄浦区中山东一路",
            addressComponent: { city: "上海市" },
          },
        });
      }
      return Response.json({
        status: "1",
        infocode: "10000",
        pois: [{
          id: "B0FFGAMAP",
          name: "外滩",
          address: "中山东一路",
          location: "121.478223,31.228457",
          cityname: "上海市",
        }],
      });
    };
    const adapter = createAmapGeocoder({
      profile: "cn-primary",
      apiKey: "amap-test-key",
      language: "zh-CN",
      fetch,
    });

    const candidates = await adapter.search({ query: "外滩", limit: 3 });
    expect(candidates[0]).toMatchObject({
      id: "B0FFGAMAP",
      label: "外滩",
      countryCode: "chn",
      city: "上海市",
      attribution: "© 高德地图",
      provider: "amap",
      mapProfile: "cn-primary",
      point: { crs: "WGS84" },
    });
    expect(candidates[0]?.point.longitude).toBeCloseTo(121.4737, 3);
    expect(candidates[0]?.point.latitude).toBeCloseTo(31.2304, 3);

    const wgs84 = { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" as const };
    const gcj02 = wgs84ToGcj02(wgs84);
    expect(gcj02ToWgs84(gcj02).longitude).toBeCloseTo(wgs84.longitude, 6);
    await expect(adapter.reverse(wgs84, "zh-CN")).resolves.toMatchObject({
      label: "上海市黄浦区中山东一路",
      point: wgs84,
      attribution: "© 高德地图",
    });
    expect(requested[1]?.searchParams.get("location")).not.toBe(
      `${wgs84.longitude},${wgs84.latitude}`,
    );
    expect(requested.every((url) => url.searchParams.get("key") === "amap-test-key")).toBe(true);
  });

  test("hybrid routes deterministically by country context and coordinate bounds", async () => {
    const amap = createAmapGeocoder({
      profile: "cn-primary",
      apiKey: "amap-key",
      language: "zh-CN",
      fetch: async (url) => url.pathname.endsWith("/regeo")
        ? Response.json({
          status: "1",
          regeocode: { formatted_address: "上海" },
        })
        : Response.json({
          status: "1",
          pois: [{ id: "amap:cn", name: "上海", location: "121.478223,31.228457" }],
        }),
    });
    const mapbox = createMapboxGeocoder({
      profile: "mapbox-permanent",
      accessToken: "mapbox-test-token",
      language: "en",
      fetch: async () => Response.json({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          id: "place.new-york",
          geometry: { type: "Point", coordinates: [-73.9857, 40.7484] },
          properties: {
            mapbox_id: "place.new-york",
            name: "New York",
            context: { country: { country_code: "US" }, place: { name: "New York" } },
          },
        }],
      }),
    });
    const hybrid = createHybridGeocoder({ amap, mapbox });

    await expect(hybrid.search({
      query: "Shanghai",
      context: { countryCodes: ["CHN"] },
    })).resolves.toEqual([
      expect.objectContaining({ provider: "amap" }),
    ]);
    await expect(hybrid.search({
      query: "People's Square",
      context: { proximity: [121.4737, 31.2304] },
    })).resolves.toEqual([
      expect.objectContaining({ provider: "amap" }),
    ]);
    await expect(hybrid.search({
      query: "Shanghai",
      context: { countryCodes: ["USA"] },
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "mapbox" }),
    ]));
    await expect(hybrid.reverse({
      longitude: 121.4737,
      latitude: 31.2304,
      crs: "WGS84",
    })).resolves.toMatchObject({ provider: "amap" });
    await expect(hybrid.reverse({
      longitude: -73.9857,
      latitude: 40.7484,
      crs: "WGS84",
    })).resolves.toMatchObject({ provider: "mapbox" });
  });
});

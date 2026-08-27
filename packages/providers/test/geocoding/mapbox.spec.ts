import { describe, expect, test } from "vitest";

import {
  createMapboxGeocoder,
  type GeocodingFetch,
} from "../../src/geocoding/index.js";

function feature(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    id: "address.1",
    geometry: { type: "Point", coordinates: [123.8854, 10.3157] },
    properties: {
      mapbox_id: "mbx:cebu-city",
      name: "Cebu City",
      name_preferred: "Cebu City",
      full_address: "Cebu City, Cebu, Philippines",
      feature_type: "place",
      context: {
        country: { name: "Philippines", country_code: "PH" },
        region: { name: "Central Visayas" },
        place: { name: "Cebu City" },
        district: { name: "Cebu" },
      },
      match_code: { confidence: "high" },
      ...overrides,
    },
  };
}

describe("Mapbox Geocoding v6 Permanent adapter", () => {
  test("maps forward context and sends permanent non-autocomplete parameters", async () => {
    const requested: URL[] = [];
    const fetch: GeocodingFetch = async (url) => {
      requested.push(url);
      return Response.json({ type: "FeatureCollection", features: [feature()] });
    };
    const adapter = createMapboxGeocoder({
      profile: "mapbox-permanent",
      accessToken: "server-mapbox-geocoding-token",
      language: "en",
      fetch,
    });

    const result = await adapter.search({
      query: " Cebu City ",
      locale: "en-PH",
      limit: 4,
      context: {
        countryCodes: ["PHL"],
        viewbox: [123, 9, 124, 11],
        proximity: { longitude: 123.9, latitude: 10.3, crs: "WGS84" },
      },
      trigger: "explicit",
    });

    expect(result[0]).toMatchObject({
      id: "mbx:cebu-city",
      label: "Cebu City",
      formattedAddress: "Cebu City, Cebu, Philippines",
      countryCode: "ph",
      city: "Cebu City",
      district: "Cebu",
      point: { longitude: 123.8854, latitude: 10.3157, crs: "WGS84" },
      providerScore: 0.95,
      attribution: "© Mapbox",
      selected: false,
      provider: "mapbox",
      mapProfile: "mapbox-permanent",
    });
    expect(Object.fromEntries(requested[0]!.searchParams)).toEqual(expect.objectContaining({
      q: "Cebu City",
      access_token: "server-mapbox-geocoding-token",
      permanent: "true",
      autocomplete: "false",
      format: "geojson",
      language: "en-PH",
      limit: "4",
      country: "ph",
      bbox: "123,9,124,11",
      proximity: "123.9,10.3",
    }));
  });

  test("maps reverse WGS84 and rejects autocomplete without a request", async () => {
    const requested: URL[] = [];
    const adapter = createMapboxGeocoder({
      profile: "mapbox-permanent",
      accessToken: "server-token",
      language: "en",
      fetch: async (url) => {
        requested.push(url);
        return Response.json({ type: "FeatureCollection", features: [feature({
          name: "Mactan-Cebu International Airport",
          name_preferred: "Mactan-Cebu International Airport",
        })] });
      },
    });

    await expect(adapter.reverse({ longitude: 123.979, latitude: 10.3076, crs: "WGS84" }, "en"))
      .resolves.toMatchObject({ provider: "mapbox", label: "Mactan-Cebu International Airport" });
    expect(requested[0]?.pathname).toBe("/search/geocode/v6/reverse");
    expect(requested[0]?.searchParams.get("permanent")).toBe("true");
    expect(requested[0]?.searchParams.has("autocomplete")).toBe(false);
    expect(requested[0]?.searchParams.has("limit")).toBe(false);
    expect(requested[0]?.searchParams.get("longitude")).toBe("123.979");
    expect(requested[0]?.searchParams.get("latitude")).toBe("10.3076");

    await expect(adapter.search({ query: "Cebu", trigger: "autocomplete" })).rejects.toMatchObject({
      code: "PROVIDER_TRIGGER_UNSUPPORTED",
      provider: "mapbox",
    });
    expect(requested).toHaveLength(1);
  });

  test.each([401, 403, 429, 503, 504])("normalizes HTTP %s without exposing token", async (status) => {
    const adapter = createMapboxGeocoder({
      profile: "mapbox-permanent",
      accessToken: "secret-mapbox-token",
      language: "en",
      fetch: async () => Response.json({}, {
        status,
        headers: status === 429 ? { "retry-after": "9" } : undefined,
      }),
    });
    const expected = status === 401 || status === 403
      ? "PROVIDER_CREDENTIALS_INVALID"
      : status === 429
        ? "PROVIDER_RATE_LIMITED"
        : status === 504
          ? "PROVIDER_TIMEOUT"
          : "PROVIDER_UNAVAILABLE";
    await expect(adapter.search({ query: "Cebu" })).rejects.toMatchObject({
      code: expected,
      provider: "mapbox",
      ...(status === 429 ? { retryAfterSeconds: 9 } : {}),
    });
    try {
      await adapter.search({ query: "Cebu again" });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("secret-mapbox-token");
    }
  });

  test("fails closed for credentials, invalid payload and invalid client context", async () => {
    expect(() => createMapboxGeocoder({
      profile: "mapbox-permanent",
      accessToken: "",
      language: "en",
    })).toThrowError(expect.objectContaining({ code: "PROVIDER_CREDENTIALS_MISSING", provider: "mapbox" }));

    const adapter = createMapboxGeocoder({
      profile: "mapbox-permanent",
      accessToken: "server-token",
      language: "en",
      fetch: async () => Response.json({ type: "FeatureCollection", features: [null] }),
    });
    await expect(adapter.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      provider: "mapbox",
    });
    await expect(adapter.search({
      query: "Cebu",
      context: { countryCodes: ["ZZZ"] },
    })).rejects.toMatchObject({ code: "PROVIDER_REQUEST_INVALID", provider: "mapbox" });
  });
});

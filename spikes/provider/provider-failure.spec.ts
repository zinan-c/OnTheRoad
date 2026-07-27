import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { startMockHere, type MockHere } from "./fixtures/mock-here.js";
import {
  HereAdapter,
  ProviderError,
  providerCacheKey,
  toWgs84
} from "./src/index.js";

describe("TC-A08-02 ambiguity, rate limiting, timeout and credentials", () => {
  let mock: MockHere;
  beforeAll(async () => { mock = await startMockHere(); });
  afterAll(async () => { await mock.close(); });

  test("TC-A08-02 never silently selects ambiguous cross-region candidates", async () => {
    const adapter = new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-global",
      language: "en",
      apiKey: "fixture-key",
      fetchImplementation: mock.fetchImplementation
    });
    const candidates = await adapter.search({ query: "Springfield" });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.selected === false)).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.label)).size).toBe(2);
  });

  test.each([
    ["rate-limit", "PROVIDER_RATE_LIMITED", 7],
    ["server-error", "PROVIDER_UNAVAILABLE", undefined],
    ["timeout", "PROVIDER_TIMEOUT", undefined]
  ])("TC-A08-02 normalizes %s without provider fallback", async (query, code, retryAfterSeconds) => {
    const adapter = new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-global",
      language: "en",
      apiKey: "fixture-key",
      timeoutMs: 30,
      fetchImplementation: mock.fetchImplementation
    });
    await expect(adapter.search({ query })).rejects.toMatchObject({ code, retryAfterSeconds });
    expect(mock.requests.at(-1)?.hostname).toBe("geocode.fixture.test");
  });

  test("TC-A08-02 fails fast for missing credentials and undeclared CRS", async () => {
    expect(() => new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "commercial-required",
      language: "en",
      apiKey: ""
    })).toThrowError(ProviderError);
    expect(() => toWgs84({ longitude: 121.49, latitude: 31.24 }, undefined)).toThrowError(/COORDINATE_CRS_REQUIRED/u);
  });

  test("TC-A08-02 isolates normalized cache keys by profile language and context", () => {
    const base = { provider: "here", profile: "fixture-cn", language: "zh-CN", query: " 外滩 " };
    expect(providerCacheKey(base)).toBe(providerCacheKey({ ...base, query: "外滩" }));
    expect(providerCacheKey(base)).not.toBe(providerCacheKey({ ...base, language: "en" }));
    expect(providerCacheKey(base)).not.toBe(providerCacheKey({ ...base, context: { countryCodes: ["cn"] } }));
    expect(providerCacheKey(base)).not.toBe(providerCacheKey({ ...base, profile: "fixture-global" }));
  });

  test("TC-A08-02 rejects invalid HERE payload and normalizes reverse no-result", async () => {
    const invalidPayload = new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-global",
      language: "en",
      apiKey: "fixture-key",
      fetchImplementation: (async () => Response.json({ items: [{
        id: "here:fixture:invalid",
        title: "Invalid coordinate"
      }] })) as typeof fetch
    });
    await expect(invalidPayload.search({ query: "invalid" })).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID"
    });

    const fixtureAdapter = new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-global",
      language: "en",
      apiKey: "fixture-key",
      fetchImplementation: mock.fetchImplementation
    });
    await expect(fixtureAdapter.reverse({
      longitude: 0,
      latitude: 0,
      crs: "WGS84"
    })).rejects.toMatchObject({ code: "PROVIDER_NO_RESULT" });
  });

  test("TC-A08-02 maps HERE authentication failures without fallback", async () => {
    const adapter = new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-global",
      language: "en",
      apiKey: "rejected-key",
      fetchImplementation: (async () => Response.json(
        { error: "Unauthorized" },
        { status: 401 },
      )) as typeof fetch
    });
    await expect(adapter.search({ query: "Shanghai" })).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIALS_INVALID",
      status: 401,
      retryable: false
    });
  });
});

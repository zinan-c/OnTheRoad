import { describe, expect, test } from "vitest";

import {
  createAmapGeocoder,
  createHereGeocoder,
  createHybridGeocoder,
  GeocoderError,
  InMemoryGeocodingStateStore,
  PolicyGeocoder,
  type GeocodingFetch,
} from "../../src/geocoding/index.js";

describe("TC-C02-02 rate, cache and policy faults", () => {
  test("isolates cache by normalized query, language and geographic context", async () => {
    let calls = 0;
    const fetch: GeocodingFetch = async () => {
      calls += 1;
      return Response.json({ items: [{
        id: "here:cached",
        title: "Shanghai",
        position: { lat: 31.23, lng: 121.47 },
        address: { countryCode: "CHN" },
      }] });
    };
    const provider = new PolicyGeocoder(createHereGeocoder({
      profile: "commercial-required",
      apiKey: "test-key",
      language: "en",
      fetch,
    }), {
      store: new InMemoryGeocodingStateStore(),
      cacheTtlSeconds: 60,
      bucket: { capacity: 10, refillPerSecond: 10 },
    });
    await provider.search({ query: " Shanghai ", locale: "en", context: { countryCodes: ["CHN"] } });
    await provider.search({ query: "Shanghai", locale: "en", context: { countryCodes: ["chn"] } });
    expect(calls).toBe(1);
    await provider.search({ query: "Shanghai", locale: "zh-CN", context: { countryCodes: ["chn"] } });
    await provider.search({ query: "Shanghai", locale: "en", context: { countryCodes: ["usa"] } });
    expect(calls).toBe(3);
  });

  test("honors Retry-After, retries 5xx with fake time, and enforces token bucket", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    let attempts = 0;
    const fetch: GeocodingFetch = async () => {
      attempts += 1;
      if (attempts === 1) return Response.json({}, { status: 503 });
      if (attempts === 3) {
        return Response.json({}, { status: 429, headers: { "retry-after": "7" } });
      }
      return Response.json({ items: [] });
    };
    const provider = new PolicyGeocoder(createHereGeocoder({
      profile: "commercial-required",
      apiKey: "test-key",
      language: "en",
      fetch,
    }), {
      store: new InMemoryGeocodingStateStore(),
      cacheTtlSeconds: 0,
      bucket: { capacity: 3, refillPerSecond: 0 },
      maxRetries: 1,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });
    await provider.search({ query: "server error then success" });
    expect(sleeps).toEqual([250]);
    await expect(provider.search({ query: "rate limited" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryAfterSeconds: 7,
    });
    await expect(provider.search({ query: "bucket empty" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      source: "client",
    });
  });

  test("maps auth, timeout and invalid payload without provider fallback", async () => {
    expect(() => createHereGeocoder({
      profile: "commercial-required",
      apiKey: "",
      language: "en",
    })).toThrowError(GeocoderError);
    const adapter = createHereGeocoder({
      profile: "commercial-required",
      apiKey: "secret-never-in-message",
      language: "en",
      fetch: async () => Response.json({ items: [{}] }),
    });
    await expect(adapter.search({ query: "private address" })).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      provider: "here",
    });

    const unauthorized = createHereGeocoder({
      profile: "commercial-required",
      apiKey: "rejected-key",
      language: "en",
      fetch: async () => Response.json({}, { status: 401 }),
    });
    await expect(unauthorized.search({ query: "Shanghai" })).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIALS_INVALID",
      status: 401,
      retryable: false,
    });

    const timeout = createHereGeocoder({
      profile: "commercial-required",
      apiKey: "timeout-key",
      language: "en",
      timeoutMs: 5,
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
    });
    await expect(timeout.search({ query: "Shanghai" })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  test("normalizes AMAP failures and hybrid never falls back to HERE", async () => {
    expect(() => createAmapGeocoder({
      profile: "cn-primary",
      apiKey: "",
      language: "zh-CN",
    })).toThrowError(expect.objectContaining({
      code: "PROVIDER_CREDENTIALS_MISSING",
      provider: "amap",
    }));

    const amap = createAmapGeocoder({
      profile: "cn-primary",
      apiKey: "rejected-amap-key",
      language: "zh-CN",
      fetch: async () => Response.json({
        status: "0",
        info: "INVALID_USER_KEY",
        infocode: "10001",
      }),
    });
    let hereCalls = 0;
    const here = createHereGeocoder({
      profile: "commercial-required",
      apiKey: "here-key",
      language: "en",
      fetch: async () => {
        hereCalls += 1;
        return Response.json({ items: [] });
      },
    });
    const hybrid = createHybridGeocoder({ amap, here });

    await expect(hybrid.search({
      query: "上海",
      context: { countryCodes: ["CHN"] },
    })).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIALS_INVALID",
      provider: "amap",
      retryable: false,
    });
    expect(hereCalls).toBe(0);
  });

  test("hybrid cache keys isolate deterministic AMAP and HERE routing contexts", async () => {
    let amapCalls = 0;
    let hereCalls = 0;
    const hybrid = createHybridGeocoder({
      amap: createAmapGeocoder({
        profile: "cn-primary",
        apiKey: "amap-key",
        language: "zh-CN",
        fetch: async () => {
          amapCalls += 1;
          return Response.json({ status: "1", pois: [] });
        },
      }),
      here: createHereGeocoder({
        profile: "commercial-required",
        apiKey: "here-key",
        language: "en",
        fetch: async () => {
          hereCalls += 1;
          return Response.json({ items: [] });
        },
      }),
    });
    const cached = new PolicyGeocoder(hybrid, {
      store: new InMemoryGeocodingStateStore(),
      cacheTtlSeconds: 60,
      bucket: { capacity: 10, refillPerSecond: 10 },
    });

    await cached.search({ query: "Central", context: { countryCodes: ["CHN"] } });
    await cached.search({ query: "Central", context: { countryCodes: ["chn"] } });
    await cached.search({ query: "Central", context: { countryCodes: ["USA"] } });
    await cached.search({ query: "Central", context: { countryCodes: ["usa"] } });
    expect({ amapCalls, hereCalls }).toEqual({ amapCalls: 1, hereCalls: 1 });
  });
});

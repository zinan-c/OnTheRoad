import { describe, expect, test } from "vitest";

import { createAmapGeocoder } from "../../src/geocoding/amap.js";
import type { GeocodingFetch } from "../../src/geocoding/types.js";

const point = { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" as const };

function provider(fetch: GeocodingFetch, options: Readonly<{ timeoutMs?: number }> = {}) {
  return createAmapGeocoder({
    profile: "cn-primary",
    apiKey: "amap-test-secret",
    language: "zh-CN",
    fetch,
    ...options,
  });
}

describe("AMap Search/Reverse error boundary", () => {
  test("returns deterministic empty Search and empty Reverse results", async () => {
    const adapter = provider(async (url) => url.pathname.endsWith("/regeo")
      ? Response.json({ status: "1", regeocode: {} })
      : Response.json({ status: "1", pois: [] }));

    await expect(adapter.search({ query: "不存在的地点", trigger: "explicit" })).resolves.toEqual([]);
    await expect(adapter.reverse(point)).resolves.toBeNull();
  });

  test.each([401, 403])("maps HTTP %s to credentials-invalid without leaking the key", async (status) => {
    const adapter = provider(async () => new Response("denied", { status }));
    await expect(adapter.search({ query: "上海", trigger: "explicit" })).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIALS_INVALID",
      status,
      retryable: false,
    });
    try {
      await adapter.reverse(point);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("amap-test-secret");
    }
  });

  test("maps AMap error payloads and HTTP rate limits to retryable errors", async () => {
    const payloadFailure = provider(async () => Response.json({ status: "0", infocode: "10004" }));
    await expect(payloadFailure.search({ query: "上海", trigger: "explicit" })).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      provider: "amap",
    });

    const httpFailure = provider(async () => new Response("busy", {
      status: 429,
      headers: { "retry-after": "3" },
    }));
    await expect(httpFailure.reverse(point)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 3,
      retryable: true,
    });
  });

  test("rejects invalid payloads and converts aborts to timeout errors", async () => {
    const invalid = provider(async () => new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(invalid.search({ query: "上海", trigger: "explicit" })).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      retryable: false,
    });

    const timeout = provider(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }), { timeoutMs: 5 });
    await expect(timeout.reverse(point)).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });
});

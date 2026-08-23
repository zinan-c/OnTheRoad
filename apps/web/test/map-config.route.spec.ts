import { afterEach, describe, expect, test, vi } from "vitest";

import { GET } from "../src/app/api/map/config/route";

afterEach(() => vi.unstubAllEnvs());

describe("same-origin map runtime config", () => {
  test("returns only browser-safe AMap fields", async () => {
    for (const [key, value] of Object.entries({
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:3000",
      API_BASE_URL: "http://localhost:3001/api/v1",
      MAP_PROFILE: "cn_primary",
      AMAP_API_KEY: "server-secret-key",
      AMAP_JS_API_KEY: "browser-public-key",
      AMAP_JS_SECURITY_CODE: "browser-security-code",
    })) vi.stubEnv(key, value);

    const response = await GET();
    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      provider: "amap",
      engine: "amap-js",
      jsApiKey: "browser-public-key",
      securityJsCode: "browser-security-code",
      defaultLayer: "amap-street",
      attribution: "© 高德地图",
    });
    expect(JSON.stringify(payload)).not.toContain("server-secret-key");
    expect(payload.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "amap-street", enabled: true }),
      expect.objectContaining({ id: "amap-satellite", enabled: true }),
      expect.objectContaining({ id: "amap-satellite-labels", enabled: true }),
    ]));
  });

  test("fails closed without serializing validation details", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.stubEnv("API_BASE_URL", "http://localhost:3001/api/v1");
    vi.stubEnv("MAP_PROFILE", "cn_primary");
    vi.stubEnv("AMAP_API_KEY", "server-secret-key");
    vi.stubEnv("AMAP_JS_API_KEY", "");
    vi.stubEnv("AMAP_JS_SECURITY_CODE", "");

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "MAP_CONFIG_UNAVAILABLE", title: "Map configuration is unavailable" });
  });
});

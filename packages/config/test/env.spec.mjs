import assert from "node:assert/strict";
import { describe, expect, test } from "vitest";

import {
  loadProcessConfig,
  PROCESS_ROLES,
} from "../src/env.js";

const minimalEnvironment = {
  NODE_ENV: "development",
  APP_ORIGIN: "http://localhost:3000",
  API_BASE_URL: "http://localhost:3001/api/v1",
  DATABASE_URL: "postgresql://on_the_road:local-only@localhost:5432/on_the_road",
  REDIS_URL: "redis://localhost:6379",
  OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
  OBJECT_STORAGE_ACCESS_KEY: "otr-local-access",
  OBJECT_STORAGE_SECRET_KEY: "otr-local-secret-change-me",
  OBJECT_STORAGE_BUCKET: "on-the-road-dev",
  CLAMAV_HOST: "localhost",
  SESSION_SECRET: "local-session-secret-change-me-32-bytes",
  MAP_PROFILE: "fixture",
  MAP_AUTOCOMPLETE_ENABLED: "false",
  MAP_EXPLICIT_SEARCH_ENABLED: "false",
};

describe("TC-A03-01 minimal config schema", () => {
  test("all four processes load one typed schema", () => {
    assert.deepEqual(PROCESS_ROLES, ["web", "api", "worker", "pdf-worker"]);

    const configs = PROCESS_ROLES.map((role) =>
      loadProcessConfig(role, minimalEnvironment),
    );

    for (const config of configs) {
      expect(config.environment).toBe("development");
      expect(config.profile).toBe("dev");
      expect(config.serviceModes).toEqual({
        postgres: "native",
        redis: "native",
        minio: "native",
        clamav: "native",
        api: "native",
        web: "native",
        worker: "native",
        pdf_worker: "native",
      });
      expect(config.map.profile).toBe("fixture");
      expect(config.map.capabilities).toEqual({
        autocomplete: false,
        batchGeocoding: false,
        explicitSearch: false,
        offlineMap: true,
      });
      expect(config.urls.api.href).toBe("http://localhost:3001/api/v1");
      expect(config.map.providerCredentialsConfigured).toEqual({
        amap: false,
        nominatim: false,
        here: false,
        mapbox: false,
      });
      if (config.role === "web") {
        expect(config.server).toBeUndefined();
      } else {
        expect(config.server.storage.bucket).toBe("on-the-road-dev");
      }
    }

    expect(configs.map(({ role }) => role)).toEqual(PROCESS_ROLES);
  });

  test("QA can select container or remote mode independently per service", () => {
    const config = loadProcessConfig("api", {
      ...minimalEnvironment,
      OTR_RUNTIME_PROFILE: "qa",
      OTR_QA_POSTGRES_MODE: "container",
      OTR_QA_REDIS_MODE: "remote",
    });

    expect(config.profile).toBe("qa");
    expect(config.serviceModes).toMatchObject({
      postgres: "container",
      redis: "remote",
      minio: "native",
      worker: "native",
    });
  });

  test("Mapbox Permanent credentials stay server-side while capabilities remain shared", () => {
    const environment = {
      ...minimalEnvironment,
      MAP_PROFILE: "international_primary",
      MAP_AUTOCOMPLETE_ENABLED: "false",
      MAP_EXPLICIT_SEARCH_ENABLED: "true",
      MAPBOX_PUBLIC_TOKEN: "pk.mapbox-public",
      MAPBOX_GEOCODING_TOKEN: "sk.mapbox-server",
    };
    const web = loadProcessConfig("web", environment);
    const api = loadProcessConfig("api", environment);

    expect(web.map.providerCredentialsConfigured.mapbox).toBe(true);
    expect(web.map.capabilities).toMatchObject({
      autocomplete: false,
      explicitSearch: true,
    });
    expect(web.map.client).toMatchObject({
      provider: "mapbox",
      engine: "maplibre",
      mapboxPublicToken: "pk.mapbox-public",
      tileSize: 512,
      maxZoom: 22,
      showMapboxLogo: true,
      defaultLayer: "mapbox-streets",
    });
    expect(JSON.stringify(web)).not.toContain("sk.mapbox-server");
    expect(api.server.providerCredentials.mapboxGeocodingToken).toBe("sk.mapbox-server");
    expect(api.map.providerCapabilities).toEqual({
      map: true,
      geocoding: true,
      reverseGeocoding: true,
      directions: false,
      staticMaps: false,
    });
  });

  test("international Web config does not require or retain the server token", () => {
    const web = loadProcessConfig("web", {
      ...minimalEnvironment,
      MAP_PROFILE: "international_primary",
      MAP_EXPLICIT_SEARCH_ENABLED: "true",
      MAPBOX_PUBLIC_TOKEN: "pk.mapbox-public",
    });

    expect(web.map.client).toMatchObject({
      provider: "mapbox",
      mapboxPublicToken: "pk.mapbox-public",
      tileSize: 512,
    });
    expect(web.map.providerCredentialsConfigured.mapbox).toBe(false);
    expect(JSON.stringify(web)).not.toContain("MAPBOX_GEOCODING_TOKEN");
  });

  test("cn_primary exposes only browser-safe AMap JS config and actual capabilities", () => {
    const environment = {
      ...minimalEnvironment,
      MAP_PROFILE: "cn_primary",
      MAP_EXPLICIT_SEARCH_ENABLED: "true",
      AMAP_API_KEY: "server-amap-key",
      AMAP_JS_API_KEY: "browser-amap-key",
      AMAP_JS_SECURITY_CODE: "browser-security-code",
    };
    const web = loadProcessConfig("web", environment);
    const api = loadProcessConfig("api", environment);

    expect(web.map.client).toMatchObject({
      provider: "amap",
      engine: "amap-js",
      jsApiKey: "browser-amap-key",
      securityJsCode: "browser-security-code",
      defaultLayer: "amap-street",
      attribution: "© 高德地图",
    });
    expect(web.map.providerCapabilities).toEqual({
      map: true,
      geocoding: true,
      reverseGeocoding: true,
      directions: true,
      staticMaps: true,
    });
    expect(api.server.providerCredentials.amapApiKey).toBe("server-amap-key");
    expect(JSON.stringify(web)).not.toContain("server-amap-key");
  });
});

export { minimalEnvironment };

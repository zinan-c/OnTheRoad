import assert from "node:assert/strict";
import { describe, expect, test } from "vitest";

import {
  ConfigValidationError,
  loadProcessConfig,
  redactSecrets,
} from "../src/env.js";
import { minimalEnvironment } from "./env.spec.mjs";

describe("TC-A03-02 secret and error redaction", () => {
  test.each([
    "NODE_ENV",
    "APP_ORIGIN",
    "API_BASE_URL",
    "MAP_PROFILE",
    "DATABASE_URL",
    "REDIS_URL",
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
    "OBJECT_STORAGE_BUCKET",
    "CLAMAV_HOST",
    "SESSION_SECRET",
  ])("missing required variable %s fails with its field name", (field) => {
    const environment = { ...minimalEnvironment };
    delete environment[field];
    assert.throws(
      () => loadProcessConfig("api", environment),
      (error) => {
        assert.ok(error instanceof ConfigValidationError);
        expect(error.issues).toContainEqual(expect.objectContaining({
          field,
          code: "REQUIRED",
        }));
        return true;
      },
    );
  });

  test.each([
    ["missing DATABASE_URL", { DATABASE_URL: undefined }, "DATABASE_URL"],
    ["invalid API URL", { API_BASE_URL: "not a URL" }, "API_BASE_URL"],
    ["invalid API port", { API_PORT: "70000" }, "API_PORT"],
    [
      "hybrid without Nominatim identity",
      { MAP_PROFILE: "hybrid", AMAP_API_KEY: "amap-only" },
      "OTR_NOMINATIM_USER_AGENT",
    ],
    [
      "China profile without AMAP key",
      {
        MAP_PROFILE: "cn_primary",
        MAP_EXPLICIT_SEARCH_ENABLED: "false",
      },
      "AMAP_API_KEY",
    ],
    [
      "China profile with a non-AMap Directions endpoint",
      {
        MAP_PROFILE: "cn_primary",
        AMAP_API_KEY: "amap-server-key",
        AMAP_JS_API_KEY: "amap-browser-key",
        AMAP_JS_SECURITY_CODE: "amap-security-code",
        OTR_DIRECTIONS_BASE_URL: "https://maps.example.test/",
      },
      "OTR_DIRECTIONS_BASE_URL",
    ],
    [
      "Nominatim search without identity",
      {
        MAP_PROFILE: "international_primary",
        MAP_EXPLICIT_SEARCH_ENABLED: "true",
      },
      "OTR_NOMINATIM_USER_AGENT",
    ],
    [
      "Nominatim rate above public cap",
      {
        MAP_PROFILE: "international_primary",
        OTR_NOMINATIM_USER_AGENT: "on-the-road-test/1.0",
        OTR_NOMINATIM_CONTACT: "test@example.com",
        OTR_NOMINATIM_RATE_LIMIT_RPS: "1.1",
      },
      "OTR_NOMINATIM_RATE_LIMIT_RPS",
    ],
    [
      "autocomplete is disabled for Nominatim",
      {
        MAP_PROFILE: "international_primary",
        OTR_NOMINATIM_USER_AGENT: "on-the-road-test/1.0",
        OTR_NOMINATIM_CONTACT: "test@example.com",
        MAP_AUTOCOMPLETE_ENABLED: "true",
      },
      "MAP_AUTOCOMPLETE_ENABLED",
    ],
    [
      "production development credentials",
      {
        NODE_ENV: "production",
        OBJECT_STORAGE_ACCESS_KEY: "otr-local-access",
      },
      "OBJECT_STORAGE_ACCESS_KEY",
    ],
    [
      "invalid runtime profile",
      { OTR_RUNTIME_PROFILE: "staging" },
      "OTR_RUNTIME_PROFILE",
    ],
    [
      "invalid QA service mode",
      { OTR_RUNTIME_PROFILE: "qa", OTR_QA_REDIS_MODE: "docker" },
      "OTR_QA_REDIS_MODE",
    ],
  ])("%s fails with a field-level issue before startup", (_, changes, field) => {
    const environment = { ...minimalEnvironment, ...changes };
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete environment[key];
    }

    assert.throws(
      () => loadProcessConfig("api", environment),
      (error) => {
        assert.ok(error instanceof ConfigValidationError);
        expect(error.issues.some((issue) => issue.field === field)).toBe(true);
        const serialized = JSON.stringify(error);
        expect(serialized).not.toContain(minimalEnvironment.SESSION_SECRET);
        expect(serialized).not.toContain(minimalEnvironment.OBJECT_STORAGE_SECRET_KEY);
        if (environment.OTR_NOMINATIM_CONTACT) {
          expect(serialized).not.toContain(environment.OTR_NOMINATIM_CONTACT);
        }
        return true;
      },
    );
  });

  test("structured values and free-form messages redact secret material", () => {
    const value = "provider-secret-value";
    expect(
      redactSecrets({
        AMAP_API_KEY: value,
        OTR_NOMINATIM_CONTACT: value,
        DATABASE_URL: `postgresql://user:${value}@database.local/app`,
        nested: { message: `request failed with ${value}` },
        safe: "visible",
      }),
    ).toEqual({
        AMAP_API_KEY: "[REDACTED]",
        OTR_NOMINATIM_CONTACT: "[REDACTED]",
      DATABASE_URL: "[REDACTED]",
      nested: { message: "request failed with [REDACTED]" },
      safe: "visible",
    });
  });
});

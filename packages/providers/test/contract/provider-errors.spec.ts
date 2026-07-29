import { describe, expect, test } from "vitest";

import {
  ProviderError,
  createFixtureProvider,
  mapProviderError,
  validateProviderAttribution,
} from "../../src/index.js";

describe("TC-C01-02 capability and error mapping", () => {
  test("disabled capability fails explicitly", async () => {
    const provider = createFixtureProvider({ capabilities: { directions: false } });

    await expect(provider.directions.route({
      from: { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
      to: { longitude: 122.3, latitude: 29.95, crs: "WGS84" },
      mode: "ferry",
    })).rejects.toMatchObject({
      code: "PROVIDER_CAPABILITY_UNSUPPORTED",
      capability: "directions",
      retryable: false,
    });
  });

  test("missing attribution and unknown failures use stable domain errors", () => {
    expect(() => validateProviderAttribution("  ")).toThrowError(
      expect.objectContaining({ code: "PROVIDER_ATTRIBUTION_MISSING" }),
    );

    const mapped = mapProviderError(new Error("vendor leaked a private response"));
    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(mapped.message).not.toContain("private response");
  });
});

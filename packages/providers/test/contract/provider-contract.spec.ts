import { describe, expect, test } from "vitest";

import {
  assertWgs84Point,
  createFixtureProvider,
  providerCapabilities,
  type ProviderSuite,
} from "../../src/index.js";

async function exerciseProvider(provider: ProviderSuite) {
  const client = await provider.map.getClientConfig({ locale: "zh-CN", profile: "fixture-cn" });
  const search = await provider.geocoding.search({ query: "外滩", locale: "zh-CN" });
  const selected = search.find(({ label }) => label === "外滩")!;
  const reverse = await provider.reverseGeocoding.reverse(selected.point, "zh-CN");
  const route = await provider.directions.route({
    from: selected.point,
    to: { longitude: 122.301, latitude: 29.949, crs: "WGS84" },
    mode: "ferry",
  });
  const staticMap = await provider.staticMap.render({
    points: [search[0]!.point, route.geometry.coordinates.at(-1)!],
    width: 640,
    height: 360,
  });
  return { client, search, reverse, route, staticMap };
}

describe("TC-C01-01 provider interface contract", () => {
  test("fixture implements all five interfaces with WGS84-only DTOs", async () => {
    const provider = createFixtureProvider();
    const result = await exerciseProvider(provider);

    expect(providerCapabilities(provider)).toEqual({
      map: true,
      geocoding: true,
      reverseGeocoding: true,
      directions: true,
      staticMap: true,
      autocomplete: false,
      fuzzy: true,
    });
    expect(result.client).toMatchObject({ profile: "fixture-cn", attribution: "On The Road fixture" });
    expect(result.search).toContainEqual(expect.objectContaining({
      id: "fixture:loc-bund",
      label: "外滩",
      attribution: "On The Road fixture",
    }));
    expect(result.reverse?.id).toBe("fixture:loc-bund");
    expect(result.route.kind).toBe("approximate");
    expect(result.staticMap.mediaType).toBe("image/svg+xml");

    for (const candidate of result.search) assertWgs84Point(candidate.point);
    for (const coordinate of result.route.geometry.coordinates) assertWgs84Point(coordinate);
    expect(JSON.stringify(result)).not.toMatch(/raw|vendor|gcj|bd09|apiKey/iu);
  });
});

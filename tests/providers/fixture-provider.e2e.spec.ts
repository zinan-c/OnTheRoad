import { expect, test, vi } from "vitest";

import { createFixtureProvider } from "../../packages/providers/src/index.js";

test("TC-C01-03 fixture provider completes offline operations deterministically", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network blocked"));
  const provider = createFixtureProvider();

  const first = await provider.geocoding.search({ query: "普陀山", locale: "zh-CN" });
  const second = await provider.geocoding.search({ query: "普陀山", locale: "zh-CN" });
  const reverse = await provider.reverseGeocoding.reverse(first[0]!.point);
  const route = await provider.directions.route({
    from: { longitude: 121.4906, latitude: 31.2413, crs: "WGS84" },
    to: first[0]!.point,
    mode: "ferry",
  });
  const map = await provider.staticMap.render({
    points: route.geometry.coordinates,
    width: 800,
    height: 450,
  });

  expect(second).toEqual(first);
  expect(reverse?.label).toBe("普陀山");
  expect(route.geometry.coordinates).toHaveLength(2);
  expect(map.content).toContain("<svg");
  expect(map.content).toContain("On The Road fixture");
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});

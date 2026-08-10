import { describe, expect, test } from "vitest";

import { routeLayerModel } from "../../src/features/map/route-layer-failure.js";

describe("TC-C08-02 route geometry degradation", () => {
  test("does not render failed or obsolete geometry", () => {
    expect(routeLayerModel({ modeCode: "FLIGHT", quality: "actual", status: "failed", geometry: [[0, 0], [1, 1]] })).toMatchObject({ visible: false, message: "Route calculation failed; endpoint details remain available" });
    expect(routeLayerModel({ modeCode: "WALK", quality: "actual", status: "obsolete", geometry: [[0, 0], [1, 1]] }).visible).toBe(false);
  });

  test("filters invalid coordinates and explains approximate geometry", () => {
    const result = routeLayerModel({ modeCode: "OTHER", quality: "approximate", status: "resolved", geometry: [[0, 0], [200, 1], [1, 1]] });
    expect(result.visible).toBe(true);
    expect(result.geometry).toEqual([[0, 0], [1, 1]]);
    expect(result.message).toContain("not turn-by-turn navigation");
  });
});

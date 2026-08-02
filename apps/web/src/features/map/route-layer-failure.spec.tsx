import { describe, expect, test } from "vitest";

import { routeLayerModel } from "./route-layer-failure.js";

describe("C08 route geometry degradation", () => {
  test("does not render failed or obsolete geometry", () => {
    expect(routeLayerModel({ modeCode: "FLIGHT", quality: "actual", status: "failed", geometry: [[0, 0], [1, 1]] })).toMatchObject({ visible: false, message: "路线计算失败，可查看起终点信息" });
    expect(routeLayerModel({ modeCode: "WALK", quality: "actual", status: "obsolete", geometry: [[0, 0], [1, 1]] }).visible).toBe(false);
  });

  test("filters invalid coordinates and explains approximate geometry", () => {
    const result = routeLayerModel({ modeCode: "OTHER", quality: "approximate", status: "resolved", geometry: [[0, 0], [200, 1], [1, 1]] });
    expect(result.visible).toBe(true);
    expect(result.geometry).toEqual([[0, 0], [1, 1]]);
    expect(result.message).toContain("不代表真实导航");
  });
});

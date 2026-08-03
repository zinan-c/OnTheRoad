import { describe, expect, test } from "vitest";

import { routeStyle } from "../../src/features/map/route-style.js";

describe("TC-C08-01 route style contract", () => {
  test("keeps mode color, line and icon distinguishable", () => {
    const walk = routeStyle({ modeCode: "WALK", quality: "actual" });
    const flight = routeStyle({ modeCode: "FLIGHT", quality: "actual" });
    expect(walk).toMatchObject({ label: "步行", icon: "person-walking", isApproximate: false });
    expect(flight).toMatchObject({ label: "飞机", icon: "plane", dasharray: [6, 4] });
    expect(walk.color).not.toBe(flight.color);
  });

  test("uses custom mode and labels approximate/unknown quality", () => {
    const style = routeStyle({ modeCode: "CUSTOM", quality: "approximate", customMode: { code: "CUSTOM", label: "缆车接驳", color: "#123456", lineStyle: "dotted", icon: "cable-car" } });
    expect(style).toMatchObject({ label: "缆车接驳", color: "#123456", dasharray: [1, 2], qualityLabel: "示意路线", isApproximate: true });
  });
});

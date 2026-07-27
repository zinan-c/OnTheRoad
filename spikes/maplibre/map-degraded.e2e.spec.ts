import assert from "node:assert/strict";
import test from "node:test";

import { launchHarness } from "./src/test-harness.ts";

test("TC-A09-02 shows neutral grid when tiles fail", async () => {
  const harness = await launchHarness({ scenario: "tile-failure" });
  try {
    await harness.page.route("**/tiles/**", (route) => route.abort());
    await harness.open();
    await assert.doesNotReject(
      harness.page.getByRole("status", { name: "底图不可用，中性网格已启用" }).waitFor(),
    );
    await harness.page.getByRole("button", { name: "上海地点标记" }).click();
    assert.equal(await harness.page.locator("#event-log").textContent(), "map-click");
  } finally {
    await harness.close();
  }
});

test("TC-A09-01 supports keyboard marker movement and returns WGS84", async () => {
  const harness = await launchHarness({ scenario: "default" });
  try {
    await harness.open();
    const marker = harness.page.getByRole("button", { name: "上海地点标记" });
    await marker.focus();
    await marker.press("ArrowRight");
    const event = await harness.page.evaluate(
      () =>
        (window as typeof window & {
          __LAST_SELECTION__?: {
            source: string;
            point: { longitude: number; latitude: number };
          };
        }).__LAST_SELECTION__,
    );
    assert.equal(event?.source, "marker-drag");
    assert.equal(event?.point.longitude, 121.5006);
    assert.equal(event?.point.latitude, 31.2413);
  } finally {
    await harness.close();
  }
});

test("TC-A09-02 renders structured 0/1/same-point and WebGL failure states", async () => {
  for (const scenario of ["zero", "one", "same", "webgl-failure"] as const) {
    const harness = await launchHarness({ scenario });
    try {
      await harness.open();
      await harness.page.getByTestId(`scenario-${scenario}`).waitFor();
      assert.match(
        (await harness.page.getByTestId("map-status").textContent()) ?? "",
        /无坐标|单点范围|同点范围|WebGL 不可用/,
      );
    } finally {
      await harness.close();
    }
  }
});

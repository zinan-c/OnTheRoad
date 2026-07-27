import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { launchHarness } from "./src/test-harness.ts";

const evidenceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "evidence",
);

test("TC-A09-03 captures four route styles with legend and attribution", async () => {
  const harness = await launchHarness({ scenario: "default" });
  try {
    await harness.open();
    const diagnostics = await harness.page.evaluate(
      () =>
        (window as typeof window & {
          __MAP_DIAGNOSTICS__?: {
            basemapMode: string;
            fixtureVersion: string;
            maplibreVersion: string;
            markerCount: number;
            renderedRouteFeatureCount: number;
            routeLayerIds: string[];
          };
        }).__MAP_DIAGNOSTICS__,
    );
    assert.deepEqual(diagnostics?.routeLayerIds, [
      "route-flight",
      "route-walk",
      "route-road",
      "route-ferry",
    ]);
    assert.equal(diagnostics?.basemapMode, "fixture-tile");
    assert.equal(diagnostics?.maplibreVersion, "6.0.0");
    assert.equal(diagnostics?.fixtureVersion, "minimal-five-day@1");
    assert.equal(diagnostics?.markerCount, 3);
    assert.ok((diagnostics?.renderedRouteFeatureCount ?? 0) >= 4);
    await assert.doesNotReject(
      harness.page.getByRole("list", { name: "路线图例" }).waitFor(),
    );
    assert.deepEqual(
      await harness.page.locator("#legend li").allTextContents(),
      ["飞机", "步行", "道路交通", "船运"],
    );
    assert.match(
      (await harness.page.locator("#attribution").textContent()) ?? "",
      /MapLibre.*Local GeoJSON fixture.*OpenStreetMap contributors/,
    );
    await mkdir(evidenceRoot, { recursive: true });
    const screenshotPath = path.join(evidenceRoot, "map-styles.png");
    await harness.page.screenshot({
      animations: "disabled",
      path: screenshotPath,
    });
    await writeFile(
      path.join(evidenceRoot, "map-styles.json"),
      `${JSON.stringify(
        {
          case: "TC-A09-03",
          viewport: { width: 1280, height: 760 },
          diagnostics,
          legend: ["飞机", "步行", "道路交通", "船运"],
          attribution:
            "MapLibre · Local GeoJSON fixture · © OpenStreetMap contributors",
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await harness.close();
  }
});

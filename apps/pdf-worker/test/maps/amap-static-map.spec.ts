import { describe, expect, test } from "vitest";

import type { ExportSnapshot } from "@on-the-road/application/export";
import {
  renderMaps,
} from "../../src/print-renderer.js";
import {
  renderStaticMapAsset,
  type StaticMapAssetProvider,
} from "@on-the-road/providers/static-map/renderer";

describe("PDF AMap static-map composition", () => {
  test("passes WGS84 snapshot geometry and AMap attribution through the provider boundary", async () => {
    let seen: { attribution: string; markers: readonly unknown[] } | undefined;
    const provider: StaticMapAssetProvider = {
      async render(input) {
        seen = { attribution: input.attribution, markers: input.markers };
        return renderStaticMapAsset({ ...input, attribution: "© 高德地图", tilePolicy: { mode: "fixture", allowedHosts: [] } });
      },
    };
    const snapshot: ExportSnapshot = {
      schemaVersion: 1,
      tripId: "trip-1",
      tripVersion: 1,
      facts: {
        days: [{
          id: "day-1",
          dayNumber: 1,
          items: [{ id: "item-1", name: "外滩", point: { longitude: 121.49, latitude: 31.24, crs: "WGS84" } }],
        }],
        routes: [],
      },
      assets: [{ id: "map:overview", kind: "map", contentType: "image/png", checksumSha256: null, objectVersion: null, width: null, height: null, required: true, status: "processing", omissionReason: "queued" }],
      capturedAt: "2026-08-23T00:00:00.000Z",
    };

    const [asset] = await renderMaps(snapshot, undefined, provider, "© 高德地图");
    expect(seen).toMatchObject({ attribution: "© 高德地图" });
    expect(seen?.markers[0]).toMatchObject({ point: { crs: "WGS84", longitude: 121.49, latitude: 31.24 } });
    expect(asset).toMatchObject({ contentType: "image/png", attribution: "© 高德地图", degraded: false });
  });
});

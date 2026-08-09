import { describe, expect, test } from "vitest";

import { buildPersistedRouteGeoJson } from "../../src/features/map/real-route-map";
import { createMapLibreRuntime } from "../../src/features/map/maplibre-runtime.mjs";

describe("persisted route map", () => {
  test("passes the Route API LineString through without rebuilding it from markers", () => {
    const coordinates = [[121.48, 31.2], [121.486, 31.205], [121.49, 31.21]] as const;
    const geojson = buildPersistedRouteGeoJson([{
      id: "route-ab",
      transportModeCode: "WALK",
      quality: "actual",
      geometry: { type: "LineString", coordinates },
    }], [], "route-ab");

    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0]?.geometry.coordinates).toEqual(coordinates);
    expect(geojson.features[0]?.properties.selected).toBe(true);
  });

  test("configures a requested fixture raster source with visible attribution", () => {
    let mapOptions: Record<string, any> | undefined;
    class FakeMap {
      constructor(options: Record<string, any>) { mapOptions = options; }
      on() { return this; }
      remove() {}
    }
    const runtime = createMapLibreRuntime({ Map: FakeMap }, {
      tileTemplate: "/api/map/tiles/{z}/{x}/{y}",
      attribution: "fixture attribution",
    });
    runtime.createMap({ container: {}, onTileError: () => undefined });

    expect(mapOptions?.attributionControl).toBe(true);
    expect(mapOptions?.style.sources["otr-basemap"]).toMatchObject({
      type: "raster",
      tiles: ["/api/map/tiles/{z}/{x}/{y}"],
      attribution: "fixture attribution",
    });
  });
});

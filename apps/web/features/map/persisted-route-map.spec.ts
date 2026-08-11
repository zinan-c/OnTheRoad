import { describe, expect, test, vi } from "vitest";

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

  test("defers the initial fit until the raster map has loaded", () => {
    let load: (() => void) | undefined;
    const fitBounds = vi.fn();
    const resize = vi.fn();
    class FakeMap {
      constructor() {}
      on(event: string, handler: () => void) {
        if (event === "load") load = handler;
        return this;
      }
      getSource() { return undefined; }
      getLayer() { return undefined; }
      addSource() {}
      addLayer() {}
      fitBounds = fitBounds;
      resize = resize;
      remove() {}
    }
    const runtime = createMapLibreRuntime({ Map: FakeMap }, {
      tileTemplate: "/api/map/tiles/{z}/{x}/{y}",
    });
    const handle = runtime.createMap({ container: {}, onTileError: () => undefined });
    const bounds = [[123, 9], [124, 10]] as [[number, number], [number, number]];

    handle.fitBounds(bounds, { padding: 48, maxZoom: 14 });
    expect(fitBounds).not.toHaveBeenCalled();

    load?.();
    expect(resize).toHaveBeenCalledOnce();
    expect(fitBounds).toHaveBeenCalledWith(bounds, { padding: 48, maxZoom: 14 });
  });
});

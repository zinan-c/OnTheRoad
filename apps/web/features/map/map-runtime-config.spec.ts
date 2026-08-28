import { describe, expect, test } from "vitest";

import {
  mapLibreRuntimeOptions,
  type MapRuntimeConfig,
} from "../../src/features/map/map-runtime-config";

describe("map runtime configuration", () => {
  test("preserves the fixture map's visible attribution", () => {
    const config: MapRuntimeConfig = {
      provider: "fixture",
      engine: "maplibre",
      defaultLayer: "amap-street",
      attribution: "On The Road fixture",
    };

    expect(mapLibreRuntimeOptions(config)).toMatchObject({
      attribution: "Map data © On The Road fixture",
    });
  });

  test("passes Mapbox runtime options and attribution through", () => {
    const config: MapRuntimeConfig = {
      provider: "mapbox",
      engine: "maplibre",
      defaultLayer: "mapbox-streets",
      mapboxPublicToken: "pk.test",
      tileTemplate: "https://api.mapbox.com/tiles/{z}/{x}/{y}",
      tileSize: 512,
      maxZoom: 22,
      showMapboxLogo: true,
      attribution: "© Mapbox © OpenStreetMap contributors",
    };

    expect(mapLibreRuntimeOptions(config)).toMatchObject({
      tileTemplate: config.tileTemplate,
      tileSize: 512,
      maxZoom: 22,
      showMapboxLogo: true,
      attribution: config.attribution,
    });
  });
});

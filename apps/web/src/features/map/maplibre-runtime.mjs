// @ts-nocheck -- this optional adapter is checked once the approved MapLibre dependency exists.
// The host loads this adapter only after its approved MapLibre dependency is available.
// Keeping the import dynamic lets the fixture/neutral-grid path work without WebGL.
export async function loadMapLibreRuntime() {
  const imported = await import("maplibre-gl");
  return createMapLibreRuntime(imported.default ?? imported);
}

export function createMapLibreRuntime(maplibregl) {
  return {
    createMap({ container, onTileError }) {
      const map = new maplibregl.Map({
        container,
        attributionControl: false,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: "otr-background", type: "background", paint: {
            "background-color": "#F5F7FA",
          } }],
        },
      });
      let geojson = { type: "FeatureCollection", features: [] };
      let markerModels = [];
      let ready = false;
      let markers = [];

      map.on("error", (event) => onTileError(asError(event?.error)));
      map.on("load", () => {
        ready = true;
        ensureSourceAndLayers(map);
        applyGeoJson(map, geojson);
        markers = replaceMarkers(maplibregl, map, markers, markerModels);
      });

      return {
        setGeoJson(next) {
          geojson = next;
          if (ready) applyGeoJson(map, geojson);
        },
        setMarkers(next) {
          markerModels = [...next];
          if (ready) markers = replaceMarkers(maplibregl, map, markers, markerModels);
        },
        fitBounds(bounds, options) {
          map.fitBounds(bounds, options);
        },
        resize() {
          map.resize();
        },
        destroy() {
          markers.forEach((marker) => marker.remove());
          markers = [];
          map.remove();
        },
      };
    },
  };
}

function ensureSourceAndLayers(map) {
  if (!map.getSource("otr-locations")) {
    map.addSource("otr-locations", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer("otr-location-rings")) {
    map.addLayer({
      id: "otr-location-rings",
      type: "circle",
      source: "otr-locations",
      paint: {
        "circle-radius": 13,
        "circle-color": "#FFFFFF",
        "circle-stroke-width": 4,
        "circle-stroke-color": ["get", "dayColor"],
      },
    });
  }
}

function applyGeoJson(map, geojson) {
  map.getSource("otr-locations")?.setData(geojson);
}

function replaceMarkers(maplibregl, map, current, markerModels) {
  current.forEach((marker) => marker.remove());
  return markerModels.map((model) => {
    const element = document.createElement("button");
    element.className = "otr-maplibre-marker";
    element.type = "button";
    element.textContent = String(model.daySequence);
    element.style.borderColor = model.dayColor;
    element.setAttribute("aria-label", model.markerLabel);
    element.title = model.tooltip;
    return new maplibregl.Marker({ element })
      .setLngLat(model.coordinate)
      .setPopup(new maplibregl.Popup({ offset: 18 }).setText(model.tooltip))
      .addTo(map);
  });
}

function asError(value) {
  return value instanceof Error ? value : new Error("basemap unavailable");
}

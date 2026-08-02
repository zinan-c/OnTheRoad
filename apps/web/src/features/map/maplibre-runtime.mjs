// @ts-nocheck -- owner: Web Maps; reason: MapLibre browser adapter isolation; remove after its runtime facade is converted to TypeScript.
// The host loads this adapter only after its approved MapLibre dependency is available.
// Keeping the import dynamic lets the fixture/neutral-grid path work without WebGL.
export async function loadMapLibreRuntime() {
  const imported = await import("maplibre-gl");
  return createMapLibreRuntime(imported.default ?? imported);
}

export function createMapLibreRuntime(maplibregl) {
  return {
    createMap({ container, onTileError, onMarkerClick }) {
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
      let routeGeojson = { type: "FeatureCollection", features: [] };
      let markerModels = [];
      let ready = false;
      let markers = [];

      map.on("error", (event) => onTileError(asError(event?.error)));
      map.on("load", () => {
        ready = true;
        ensureSourceAndLayers(map);
        applyGeoJson(map, geojson);
        applyRouteGeoJson(map, routeGeojson);
        markers = replaceMarkers(maplibregl, map, markers, markerModels, onMarkerClick);
      });

      return {
        setGeoJson(next) {
          geojson = next;
          if (ready) applyGeoJson(map, geojson);
        },
        setRouteGeoJson(next) {
          routeGeojson = next;
          if (ready) applyRouteGeoJson(map, routeGeojson);
        },
        setMarkers(next) {
          markerModels = [...next];
          if (ready) markers = replaceMarkers(maplibregl, map, markers, markerModels, onMarkerClick);
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
  if (!map.getSource("otr-routes")) map.addSource("otr-routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!map.getLayer("otr-route-lines")) map.addLayer({ id: "otr-route-lines", type: "line", source: "otr-routes", paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85 } });
}

function applyGeoJson(map, geojson) {
  map.getSource("otr-locations")?.setData(geojson);
}

function applyRouteGeoJson(map, geojson) {
  map.getSource("otr-routes")?.setData(geojson);
}

function replaceMarkers(maplibregl, map, current, markerModels, onMarkerClick) {
  current.forEach((marker) => marker.remove());
  return markerModels.map((model) => {
    const element = document.createElement("button");
    element.className = "otr-maplibre-marker";
    element.type = "button";
    element.textContent = String(model.daySequence);
    element.style.borderColor = model.dayColor;
    element.setAttribute("aria-label", model.markerLabel);
    element.title = model.tooltip;
    element.addEventListener("click", () => onMarkerClick?.(model.itemId));
    return new maplibregl.Marker({ element })
      .setLngLat(model.coordinate)
      .setPopup(new maplibregl.Popup({ offset: 18 }).setText(model.tooltip))
      .addTo(map);
  });
}

function asError(value) {
  return value instanceof Error ? value : new Error("basemap unavailable");
}

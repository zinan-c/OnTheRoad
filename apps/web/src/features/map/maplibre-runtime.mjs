// @ts-nocheck -- owner: Web Maps; reason: MapLibre browser adapter isolation; remove after its runtime facade is converted to TypeScript.
// The host loads this adapter only after its approved MapLibre dependency is available.
// Keeping the import dynamic lets the fixture/neutral-grid path work without WebGL.
export async function loadMapLibreRuntime(options = {}) {
  const imported = await import("maplibre-gl");
  return createMapLibreRuntime(imported.default ?? imported, options);
}

export function createMapLibreRuntime(maplibregl, options = {}) {
  return {
    createMap({ container, onTileError, onMarkerClick = undefined, onRouteClick = undefined, onMapClick = undefined, onMarkerDragEnd = undefined, draggableMarkers = false }) {
      const basemap = options.tileTemplate ? {
        "otr-basemap": {
          type: "raster",
          tiles: [options.tileTemplate],
          tileSize: options.tileSize ?? 256,
          ...(options.maxZoom === undefined ? {} : { maxzoom: options.maxZoom }),
          attribution: options.attribution ?? "地图数据 © On The Road fixture",
        },
      } : {};
      const map = new maplibregl.Map({
        container,
        attributionControl: Boolean(options.tileTemplate),
        style: {
          version: 8,
          sources: basemap,
          layers: [{ id: "otr-background", type: "background", paint: {
            "background-color": "#F5F7FA",
          } }, ...(options.tileTemplate ? [{ id: "otr-basemap", type: "raster", source: "otr-basemap" }] : [])],
        },
      });
      if (options.showMapboxLogo && typeof map.addControl === "function") {
        map.addControl(createMapboxLogoControl(options.mapboxLogoHref), "bottom-left");
      }
      let geojson = { type: "FeatureCollection", features: [] };
      let routeGeojson = { type: "FeatureCollection", features: [] };
      let markerModels = [];
      let ready = false;
      let markers = [];
      let selectedItemId = null;
      let suppressMapClick = false;
      let pendingFitBounds = null;
      const markerDragEnd = (itemId, point, inputMode) => {
        suppressMapClick = true;
        onMarkerDragEnd?.(itemId, point, inputMode);
        void Promise.resolve().then(() => { suppressMapClick = false; });
      };

      map.on("error", (event) => onTileError(asError(event?.error)));
      map.on("click", (event) => {
        if (!suppressMapClick) onMapClick?.({
          longitude: event.lngLat.lng,
          latitude: event.lngLat.lat,
          crs: "WGS84",
        });
      });
      map.on("click", "otr-route-lines", (event) => {
        const routeId = event.features?.[0]?.id;
        if (routeId !== undefined && routeId !== null) onRouteClick?.(String(routeId));
      });
      map.on("load", () => {
        ready = true;
        ensureSourceAndLayers(map);
        applyGeoJson(map, geojson);
        applyRouteGeoJson(map, routeGeojson);
        markers = replaceMarkers(maplibregl, map, markers, markerModels, onMarkerClick, markerDragEnd, draggableMarkers, selectedItemId);
        if (pendingFitBounds) {
          const { bounds, fitOptions } = pendingFitBounds;
          pendingFitBounds = null;
          map.resize();
          map.fitBounds(bounds, fitOptions);
        }
      });

      return {
        setBaseLayer() {
          // The selected raster source is fixed for this runtime. The method
          // exists so the shared MapRuntimeHandle remains interchangeable with
          // the AMap JS runtime.
        },
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
          if (ready) markers = replaceMarkers(maplibregl, map, markers, markerModels, onMarkerClick, markerDragEnd, draggableMarkers, selectedItemId);
        },
        setSelectedItem(itemId) {
          selectedItemId = itemId;
          applyMarkerSelection(markers, selectedItemId);
        },
        fitBounds(bounds, options) {
          // MapLibre accepts fitBounds before load, but the call can be
          // applied against its default world-sized transform. Queue it so
          // the first view is fitted to the itinerary after the raster style
          // and container dimensions are ready.
          if (!ready) {
            pendingFitBounds = { bounds, fitOptions: options };
            return;
          }
          map.resize();
          map.fitBounds(bounds, options);
        },
        resize() {
          map.resize();
        },
        destroy() {
          markers.forEach((marker) => marker.remove());
          markers = [];
          try {
            map.remove();
          } catch {
            // A partially initialized WebGL map may not have a painter to tear down.
          }
        },
      };
    },
  };
}

function createMapboxLogoControl(href = "https://www.mapbox.com/about/maps/") {
  let container;
  return {
    onAdd() {
      container = document.createElement("div");
      container.className = "mapboxgl-ctrl mapboxgl-ctrl-logo";
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = "Mapbox";
      link.setAttribute("aria-label", "Mapbox");
      link.title = "Mapbox";
      link.style.background = "#000";
      link.style.color = "#fff";
      link.style.display = "block";
      link.style.font = "600 11px/20px sans-serif";
      link.style.padding = "0 4px";
      link.style.textDecoration = "none";
      container.append(link);
      return container;
    },
    onRemove() {
      container?.parentNode?.removeChild(container);
      container = undefined;
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
  if (!map.getLayer("otr-route-lines")) map.addLayer({ id: "otr-route-lines", type: "line", source: "otr-routes", paint: { "line-color": ["get", "color"], "line-width": ["case", ["boolean", ["get", "selected"], false], 7, 4], "line-opacity": 0.85, "line-dasharray": ["get", "dasharray"] } });
}

function applyGeoJson(map, geojson) {
  map.getSource("otr-locations")?.setData(geojson);
}

function applyRouteGeoJson(map, geojson) {
  map.getSource("otr-routes")?.setData(geojson);
}

function replaceMarkers(maplibregl, map, current, markerModels, onMarkerClick, onMarkerDragEnd, draggableMarkers, selectedItemId) {
  current.forEach((marker) => marker.remove());
  return markerModels.map((model) => {
    const element = document.createElement("button");
    element.className = "otr-maplibre-marker";
    element.type = "button";
    const label = document.createElement("span");
    label.textContent = String(model.daySequence);
    element.append(label);
    element.style.borderColor = model.dayColor;
    element.setAttribute("aria-label", model.tooltip);
    element.setAttribute("data-item-id", model.itemId);
    element.title = model.tooltip;
    element.addEventListener("click", () => onMarkerClick?.(model.itemId));
    const marker = new maplibregl.Marker({ element, draggable: draggableMarkers })
      .setLngLat(model.coordinate)
      .setOffset(model.offset ?? [0, 0])
      .setPopup(new maplibregl.Popup({ offset: 18 }).setText(model.tooltip))
      .addTo(map);
    if (draggableMarkers) marker.on("dragend", (event) => {
      const point = marker.getLngLat();
      const original = event?.originalEvent;
      const inputMode = original?.pointerType === "touch" || original?.touches ? "touch" : "mouse";
      onMarkerDragEnd?.(model.itemId, { longitude: point.lng, latitude: point.lat, crs: "WGS84" }, inputMode);
    });
    applyMarkerSelection([marker], selectedItemId);
    return marker;
  });
}

function applyMarkerSelection(markers, selectedItemId) {
  markers.forEach((marker) => {
    const element = marker.getElement?.();
    if (!element) return;
    const selected = element.getAttribute("data-item-id") === selectedItemId
      || element.getAttribute("data-item-id")?.startsWith(`${selectedItemId}:`);
    element.classList.toggle("is-selected", Boolean(selected));
    element.setAttribute("aria-pressed", String(Boolean(selected)));
  });
}

function asError(value) {
  return value instanceof Error ? value : new Error("basemap unavailable");
}

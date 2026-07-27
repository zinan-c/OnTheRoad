/* global CustomEvent, URLSearchParams, location, window */

import * as maplibregl from "/vendor/maplibre-gl.mjs";
import {
  ROUTE_STYLES,
  fitPlan,
  normalizeWgs84,
  selectionEvent,
} from "/src/map-contract.mjs";
import { FIXTURE_VERSION, LOCATIONS, ROUTES } from "/src/fixture.ts";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "default";
const mapNode = document.querySelector("#map");
const grid = document.querySelector("#neutral-grid");
const state = document.querySelector("#map-state");
const eventLog = document.querySelector("#event-log");
const marker = document.querySelector("#scenario-marker");
marker.dataset.testid = `scenario-${scenario}`;

const scenarioPoints = {
  zero: [],
  one: [LOCATIONS[0].coordinates],
  same: [LOCATIONS[0].coordinates, LOCATIONS[0].coordinates],
  default: LOCATIONS.map((location) => location.coordinates),
  "tile-failure": LOCATIONS.map((location) => location.coordinates),
};
const points = scenarioPoints[scenario] ?? scenarioPoints.default;
const plan = fitPlan(points);

for (const [mode, style] of Object.entries(ROUTE_STYLES)) {
  const item = document.createElement("li");
  item.innerHTML = `<span class="legend-line legend-${mode}" aria-hidden="true"></span>${style.label}`;
  document.querySelector("#legend").append(item);
}

function showGrid(message) {
  grid.classList.remove("hidden");
  grid.querySelector("span").textContent = message;
  grid.setAttribute("aria-label", "底图不可用，中性网格已启用");
}

function showState(message) {
  state.textContent = message;
  state.classList.remove("hidden");
}

function emitSelection(source, coordinates) {
  const event = selectionEvent(source, coordinates);
  eventLog.textContent = source;
  window.dispatchEvent(new CustomEvent("otr:location-selected", { detail: event }));
  window.__LAST_SELECTION__ = event;
}

if (scenario === "webgl-failure") {
  showGrid("WebGL 不可用 / 使用中性网格");
  showState("WebGL 不可用：文字行程仍可编辑");
  mapNode.setAttribute("aria-disabled", "true");
  window.__HARNESS_READY__ = true;
} else {
  const style = {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          scenario === "tile-failure"
            ? `${location.origin}/tiles/{z}/{x}/{y}.svg`
            : `${location.origin}/fixture-tiles/{z}/{x}/{y}.svg`,
        ],
        tileSize: 256,
        attribution: "Local deterministic fixture tile",
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#f4f2e9" } },
      { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.7 } },
    ],
  };
  const map = new maplibregl.Map({
    container: "map",
    style,
    center: [121.9, 30.5],
    zoom: 7,
    attributionControl: false,
    preserveDrawingBuffer: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("error", (event) => {
    if (scenario === "tile-failure" || /tile|source/i.test(event?.error?.message ?? "")) {
      showGrid("底图不可用 / 本地中性网格");
    }
  });
  const initialize = () => {
    map.addSource("routes", { type: "geojson", data: ROUTES });
    for (const [mode, routeStyle] of Object.entries(ROUTE_STYLES)) {
      map.addLayer({
        id: `route-${mode}`,
        type: "line",
        source: "routes",
        filter: ["==", ["get", "mode"], mode],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": routeStyle.color,
          "line-width": routeStyle.width,
          "line-dasharray": routeStyle.dasharray,
        },
      });
    }
    const activeLocations =
      scenario === "zero"
        ? []
        : scenario === "one"
          ? LOCATIONS.slice(0, 1)
          : scenario === "same"
            ? [LOCATIONS[0], { ...LOCATIONS[1], coordinates: LOCATIONS[0].coordinates }]
            : LOCATIONS;
    activeLocations.forEach((locationItem, index) => {
      const button = document.createElement("button");
      button.className = "marker-button";
      button.type = "button";
      button.ariaLabel = locationItem.name;
      button.innerHTML = `<span class="marker-number">${index + 1}</span>`;
      const mapMarker = new maplibregl.Marker({
        element: button,
        draggable: true,
        anchor: "center",
      })
        .setLngLat(locationItem.coordinates)
        .addTo(map);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        emitSelection("map-click", mapMarker.getLngLat().toArray());
      });
      button.addEventListener("keydown", (event) => {
        const delta = {
          ArrowLeft: [-0.01, 0],
          ArrowRight: [0.01, 0],
          ArrowUp: [0, 0.01],
          ArrowDown: [0, -0.01],
        }[event.key];
        if (delta) {
          event.preventDefault();
          const current = mapMarker.getLngLat();
          const next = normalizeWgs84([current.lng + delta[0], current.lat + delta[1]]);
          mapMarker.setLngLat([next.longitude, next.latitude]);
          emitSelection("marker-drag", [next.longitude, next.latitude]);
        } else if (event.key === "Enter") {
          emitSelection("map-click", mapMarker.getLngLat().toArray());
        }
      });
      mapMarker.on("dragend", () => {
        emitSelection("marker-drag", mapMarker.getLngLat().toArray());
      });
    });
    map.on("click", (event) => emitSelection("map-click", event.lngLat.toArray()));
    if (plan.bounds) {
      map.fitBounds(plan.bounds, { padding: 90, duration: 0, maxZoom: 12 });
    }
    if (plan.kind !== "bounds") showState(plan.message);
    if (scenario === "tile-failure") {
      setTimeout(() => showGrid("底图不可用 / 本地中性网格"), 250);
    }
    map.once("idle", () => {
      const routeLayerIds = Object.keys(ROUTE_STYLES).map(
        (mode) => `route-${mode}`,
      );
      window.__MAP_DIAGNOSTICS__ = {
        maplibreVersion: maplibregl.getVersion(),
        fixtureVersion: FIXTURE_VERSION,
        basemapMode:
          scenario === "tile-failure" ? "neutral-grid" : "fixture-tile",
        routeLayerIds,
        renderedRouteFeatureCount: map.queryRenderedFeatures({
          layers: routeLayerIds,
        }).length,
        fitPlan: plan,
        markerCount: activeLocations.length,
      };
      window.__HARNESS_READY__ = true;
    });
  };
  map.once("style.load", initialize);
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapLibreWrapper, type MapRuntimeFactory } from "./maplibre-wrapper";
import type { MapFilter, MapItem } from "./map-model";
import { MAP_LAYER_CATALOG, loadConfiguredMapRuntime, type MapLayerCatalogEntry } from "./map-runtime-config";
import type { MapLayerId } from "@on-the-road/config/env";
import { routeStyle, type RouteQuality } from "./route-style";
import type { TransportModeView } from "../trips/settings/transport-modes";

export type PersistedRoute = {
  readonly id: string;
  readonly transportModeCode: string | null;
  readonly quality: RouteQuality | null;
  readonly geometry: { readonly type: "LineString"; readonly coordinates: readonly (readonly [number, number])[] } | null;
};

export function buildPersistedRouteGeoJson(
  routes: readonly PersistedRoute[],
  transportModes: readonly TransportModeView[],
  selectedRouteId?: string | null,
) {
  return {
    type: "FeatureCollection" as const,
    features: routes.flatMap((route) => {
      if (!route.geometry) return [];
      const customMode = transportModes.find(({ code }) => code === route.transportModeCode);
      const style = routeStyle({ modeCode: route.transportModeCode, quality: route.quality ?? "unknown", ...(customMode ? { customMode } : {}) });
      return [{
        type: "Feature" as const,
        id: route.id,
        geometry: route.geometry,
        properties: {
          color: style.color,
          dasharray: [...style.dasharray],
          modeLabel: style.label,
          modeIcon: style.icon,
          lineStyle: style.lineStyle,
          selected: route.id === selectedRouteId,
        },
      }];
    }),
  };
}

export function RealRouteMap({ items, routes, transportModes = [], selectedRouteId, selectedItemId, filter, onSelect, onRouteSelect }: {
  readonly items: readonly MapItem[];
  readonly routes: readonly PersistedRoute[];
  readonly transportModes?: readonly TransportModeView[];
  readonly selectedRouteId?: string | null;
  readonly selectedItemId?: string | null;
  readonly filter?: MapFilter;
  readonly onSelect: (itemId: string) => void;
  readonly onRouteSelect: (routeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<MapLibreWrapper | undefined>(undefined);
  const [layer, setLayer] = useState<MapLayerId>(() => preferredLayer());
  const [layers, setLayers] = useState<readonly MapLayerCatalogEntry[]>(MAP_LAYER_CATALOG);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState("© 高德地图");
  const itemsRef = useRef(items);
  const filterRef = useRef(filter);
  itemsRef.current = items;
  filterRef.current = filter;
  const selectedItemRef = useRef(selectedItemId);
  selectedItemRef.current = selectedItemId;
  const routeGeoJson = useMemo(
    () => buildPersistedRouteGeoJson(routes, transportModes, selectedRouteId),
    [routes, selectedRouteId, transportModes],
  );
  const routeGeoJsonRef = useRef(routeGeoJson);
  routeGeoJsonRef.current = routeGeoJson;

  useEffect(() => {
    let disposed = false;
    void loadConfiguredMapRuntime().then((runtime) => {
      if (disposed || !containerRef.current) return;
      const wrapper = new MapLibreWrapper(
        runtime as unknown as MapRuntimeFactory,
        (state) => setRuntimeError(state.degradationReason ?? null),
      );
      wrapperRef.current = wrapper;
      setAttribution(runtime.mapConfig.attribution);
      const configuredLayers = runtime.mapConfig.layers ?? MAP_LAYER_CATALOG;
      setLayers(configuredLayers);
      const initialLayer = preferredLayer(runtime.mapConfig.defaultLayer, configuredLayers);
      setLayer(initialLayer);
      return wrapper.mount(containerRef.current, itemsRef.current, filterRef.current ?? { kind: "all" }, onSelect, onRouteSelect)
        .then(() => {
          wrapper.setRouteGeoJson(routeGeoJsonRef.current);
          wrapper.selectItem(selectedItemRef.current ?? null);
          wrapper.setBaseLayer(initialLayer);
        });
    }).catch((error: unknown) => {
      if (!disposed) setRuntimeError(error instanceof Error ? error.message : "Map configuration is unavailable");
    });
    return () => { disposed = true; wrapperRef.current?.destroy(); wrapperRef.current = undefined; };
  }, [onRouteSelect, onSelect]);

  useEffect(() => { wrapperRef.current?.updateItems(items, filter ?? { kind: "all" }); }, [filter, items]);
  useEffect(() => { wrapperRef.current?.setRouteGeoJson(routeGeoJson); }, [routeGeoJson]);
  useEffect(() => { wrapperRef.current?.selectItem(selectedItemId ?? null); }, [selectedItemId]);
  useEffect(() => {
    wrapperRef.current?.setBaseLayer(layer);
    if (typeof window !== "undefined") window.localStorage.setItem("otr.map.basemap", layer);
  }, [layer]);

  const validPoints = items.filter(({ point }) => point);
  return <section className="realRouteMapShell" aria-label="在线地图">
    <div className="realRouteMapControls">
      <label>地图图层<select aria-label="地图图层" value={layer} onChange={(event) => setLayer(event.target.value as MapLayerId)}>
        {layers.filter(({ enabled }) => enabled).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select></label>
    </div>
    {runtimeError ? <p role="status">在线地图不可用，文字行程仍可编辑。{runtimeError}</p> : null}
    <div
      id="route-map-canvas"
      ref={containerRef}
      className={`realRouteMap${runtimeError ? " is-degraded" : ""}`}
      role="application"
      aria-label="Route map"
      data-marker-count={validPoints.length}
      data-route-count={routeGeoJson.features.length}
    >{runtimeError ? <div className="otr-map-grid" aria-label="中性网格" /> : null}</div>
    <small className="otr-map-attribution">{attribution}</small>
  </section>;
}

function preferredLayer(
  fallback: MapLayerId = "amap-street",
  catalog: readonly MapLayerCatalogEntry[] = MAP_LAYER_CATALOG,
): MapLayerId {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem("otr.map.basemap");
  return catalog.some(({ id }) => id === stored) ? stored as MapLayerId : fallback;
}

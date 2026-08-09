"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapLibreWrapper, type MapRuntimeFactory } from "./maplibre-wrapper";
import type { MapFilter, MapItem } from "./map-model";
import { loadMapLibreRuntime } from "./maplibre-runtime.mjs";
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
        properties: { color: style.color, dasharray: [...style.dasharray], selected: route.id === selectedRouteId },
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
  const selectedItemRef = useRef(selectedItemId);
  selectedItemRef.current = selectedItemId;
  const routeGeoJson = useMemo(
    () => buildPersistedRouteGeoJson(routes, transportModes, selectedRouteId),
    [routes, selectedRouteId, transportModes],
  );

  useEffect(() => {
    let disposed = false;
    void loadMapLibreRuntime({
      tileTemplate: "/api/map/tiles/{z}/{x}/{y}",
      attribution: "地图数据 © On The Road fixture",
    }).then((runtime) => {
      if (disposed || !containerRef.current) return;
      const wrapper = new MapLibreWrapper(runtime as unknown as MapRuntimeFactory);
      wrapperRef.current = wrapper;
      return wrapper.mount(containerRef.current, items, filter ?? { kind: "all" }, onSelect, onRouteSelect)
        .then(() => {
          wrapper.setRouteGeoJson(routeGeoJson);
          wrapper.selectItem(selectedItemRef.current ?? null);
        });
    });
    return () => { disposed = true; wrapperRef.current?.destroy(); wrapperRef.current = undefined; };
  }, [filter, items, onRouteSelect, onSelect]);

  useEffect(() => { wrapperRef.current?.setRouteGeoJson(routeGeoJson); }, [routeGeoJson]);
  useEffect(() => { wrapperRef.current?.selectItem(selectedItemId ?? null); }, [selectedItemId]);

  return <div ref={containerRef} className="realRouteMap" role="application" aria-label="真实地图路线" data-route-count={routeGeoJson.features.length} />;
}

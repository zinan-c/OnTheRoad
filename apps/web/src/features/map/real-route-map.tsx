"use client";

import { useEffect, useRef } from "react";
import { MapLibreWrapper, type MapRuntimeFactory } from "./maplibre-wrapper";
import type { MapItem } from "./map-model";
import { loadMapLibreRuntime } from "./maplibre-runtime.mjs";
import { routeStyle } from "./route-style";

type RouteMapItem = MapItem & { readonly transportModeCode?: string | null };

export function RealRouteMap({ items, onSelect }: { readonly items: readonly RouteMapItem[]; readonly onSelect: (itemId: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<MapLibreWrapper | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    void loadMapLibreRuntime().then((runtime) => {
      if (disposed || !containerRef.current) return;
      const wrapper = new MapLibreWrapper(runtime as unknown as MapRuntimeFactory);
      wrapperRef.current = wrapper;
      return wrapper.mount(containerRef.current, items, { kind: "all" }, onSelect);
    });
    return () => { disposed = true; wrapperRef.current?.destroy(); wrapperRef.current = undefined; };
  }, [items, onSelect]);

  useEffect(() => {
    const points = items.filter((item) => item.point);
    const features = points.slice(1).map((item, index) => {
      const from = points[index]!;
      const style = routeStyle({ ...(item.transportModeCode !== undefined ? { modeCode: item.transportModeCode } : {}), quality: "actual" });
      return { type: "Feature", id: `${from.id}-${item.id}`, geometry: { type: "LineString", coordinates: [[from.point!.longitude, from.point!.latitude], [item.point!.longitude, item.point!.latitude]] }, properties: { color: style.color } };
    });
    wrapperRef.current?.setRouteGeoJson({ type: "FeatureCollection", features });
  }, [items]);

  return <div ref={containerRef} className="realRouteMap" role="application" aria-label="真实地图路线" />;
}

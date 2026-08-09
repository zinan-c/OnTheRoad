"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { itineraryApi, type ProductDay, type ProductItem } from "../itinerary/itinerary-panel";
import type { TransportModeView } from "../trips/settings/transport-modes";
import { RealRouteMap, type PersistedRoute } from "./real-route-map";
import type { MapItem } from "./map-model";
import { routeStyle, type RouteQuality, type RouteStatus } from "./route-style";
import { MapTimelineSelectionStore } from "./store";

type LocationView = {
  readonly id: string;
  readonly name?: string | null;
  readonly inputText?: string | null;
  readonly geocodingStatus?: string;
  readonly point?: { readonly longitude: number; readonly latitude: number; readonly crs?: string } | null;
};

type RouteSegment = PersistedRoute & {
  readonly tripDayId: string;
  readonly kind: string;
  readonly fromItineraryItemId: string | null;
  readonly toItineraryItemId: string | null;
  readonly fromLocationId: string | null;
  readonly toLocationId: string | null;
  readonly provider: string | null;
  readonly status: RouteStatus;
  readonly sourceVersion: string;
  readonly sourceContext: Record<string, unknown>;
};

const DAY_COLORS = ["#2563eb", "#d9485f", "#0f766e", "#9333ea", "#c2410c"] as const;

export function RouteMapWorkspace({ tripId, transportModes }: {
  readonly tripId: string;
  readonly transportModes: readonly TransportModeView[];
}) {
  const [days, setDays] = useState<ProductDay[]>([]);
  const [items, setItems] = useState<ProductItem[]>([]);
  const [locations, setLocations] = useState<Record<string, LocationView>>({});
  const [routes, setRoutes] = useState<RouteSegment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectionStore = useMemo(() => new MapTimelineSelectionStore(), []);
  const selection = useSyncExternalStore(
    (listener) => selectionStore.subscribe(listener),
    () => selectionStore.state,
    () => selectionStore.state,
  );
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const loadedDays = await itineraryApi<ProductDay[]>(`/trips/${tripId}/days`);
      const itemGroups = await Promise.all(loadedDays.map((day) => itineraryApi<ProductItem[]>(`/trips/${tripId}/days/${day.id}/itinerary-items`)));
      const loadedItems = itemGroups.flat();
      const locationIds = [...new Set(loadedItems.flatMap((item) => [item.locationId, item.startLocationId, item.endLocationId]).filter((id): id is string => Boolean(id)))];
      const loadedLocations = await Promise.all(locationIds.map((id) => itineraryApi<LocationView>(`/trips/${tripId}/locations/${id}`)));
      const loadedRoutes = await itineraryApi<RouteSegment[]>(`/trips/${tripId}/routes`);
      setDays(loadedDays);
      setItems(loadedItems);
      setLocations(Object.fromEntries(loadedLocations.map((location) => [location.id, location])));
      setRoutes(loadedRoutes);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "路线载入失败");
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const dayById = useMemo(() => new Map(days.map((day) => [day.id, day])), [days]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const mapItems = useMemo<MapItem[]>(() => items.map((item) => {
    const day = dayById.get(item.tripDayId);
    const location = item.locationId ? locations[item.locationId] : undefined;
    return {
      id: item.id,
      dayId: item.tripDayId,
      dayNumber: day?.dayNumber ?? 1,
      dayColor: DAY_COLORS[((day?.dayNumber ?? 1) - 1) % DAY_COLORS.length]!,
      label: item.target ?? location?.name ?? location?.inputText ?? "未命名事项",
      ...(location?.point ? { point: { longitude: location.point.longitude, latitude: location.point.latitude, crs: "WGS84" } } : {}),
    };
  }), [dayById, items, locations]);
  const selectedItemId = selection.selected?.itemId ?? null;
  const selectedRoute = routes.find(({ id }) => id === selectedRouteId) ?? null;
  const isGenerating = items.length >= 2 && (routes.length === 0 || routes.some(({ status }) => status === "pending" || status === "resolving"));

  function itemLabel(id: string | null): string {
    if (!id) return "未知端点";
    const item = itemById.get(id);
    return item?.target ?? id;
  }

  return <section aria-label="路线地图" className="workspaceCard routeWorkspace">
    <header><h2>路线与时间线</h2><p>地图只绘制 Route API 返回的持久化 WGS84 几何。</p></header>
    {isGenerating ? <p role="status">路线生成中…</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {mapItems.some(({ point }) => point) ? <RealRouteMap
      items={mapItems}
      routes={routes}
      transportModes={transportModes}
      selectedRouteId={selectedRouteId}
      onSelect={(id) => { selectionStore.selectFromMarker(id); setSelectedRouteId(null); }}
      onRouteSelect={(id) => setSelectedRouteId(id)}
    /> : <p role="status">无有效坐标：请先确认地点</p>}
    <small className="otr-map-attribution">地图数据 © On The Road fixture</small>
    <ol aria-label="行程时间线" className="workspaceTimeline">{mapItems.map((item) => <li key={item.id}><button
      type="button"
      aria-pressed={selectedItemId === item.id}
      data-selected={selectedItemId === item.id}
      onClick={() => { selectionStore.selectFromTimeline(item.id, item.dayId); setSelectedRouteId(null); }}
    >{item.label}</button></li>)}</ol>
    {selectedItemId ? <p role="status">当前选择：{mapItems.find(({ id }) => id === selectedItemId)?.label ?? selectedItemId}</p> : null}
    {selectedRoute ? <aside aria-label="路线详情">
      <h3>{itemLabel(selectedRoute.fromItineraryItemId)} → {itemLabel(selectedRoute.toItineraryItemId)}</h3>
      <dl>
        <div><dt>交通方式</dt><dd>{routeStyle({ modeCode: selectedRoute.transportModeCode, quality: selectedRoute.quality ?? "unknown", ...(transportModes.find(({ code }) => code === selectedRoute.transportModeCode) ? { customMode: transportModes.find(({ code }) => code === selectedRoute.transportModeCode)! } : {}) }).label}</dd></div>
        <div><dt>Provider</dt><dd>{selectedRoute.provider ?? "尚未生成"}</dd></div>
        <div><dt>质量</dt><dd>{routeStyle({ quality: (selectedRoute.quality ?? "unknown") as RouteQuality }).qualityLabel}</dd></div>
        <div><dt>端点</dt><dd>{selectedRoute.fromLocationId ?? "未解析"} → {selectedRoute.toLocationId ?? "未解析"}</dd></div>
      </dl>
    </aside> : null}
  </section>;
}

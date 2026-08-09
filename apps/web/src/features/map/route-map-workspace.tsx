"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { itineraryApi, type ProductDay, type ProductItem } from "../itinerary/itinerary-panel";
import type { TransportModeView } from "../trips/settings/transport-modes";
import { RealRouteMap, type PersistedRoute } from "./real-route-map";
import type { MapItem } from "./map-model";
import { routeStyle, type RouteQuality, type RouteStatus } from "./route-style";
import { MapTimelineSelectionStore } from "./store";

export type LocationView = {
  readonly id: string;
  readonly name?: string | null;
  readonly inputText?: string | null;
  readonly geocodingStatus?: string;
  readonly point?: { readonly longitude: number; readonly latitude: number; readonly crs?: string } | null;
};

export type RouteSegment = PersistedRoute & {
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
const ROUTE_BLOCKER_LABELS: Readonly<Record<string, string>> = {
  LOCATION_MISSING: "地点缺失",
  LOCATION_NOT_CONFIRMED: "地点尚未确认",
};

export function buildRouteMapItems(
  items: readonly ProductItem[],
  days: readonly ProductDay[],
  locations: Readonly<Record<string, LocationView>>,
): MapItem[] {
  const dayById = new Map(days.map((day) => [day.id, day]));
  return items.flatMap((item) => {
    const day = dayById.get(item.tripDayId);
    const base = {
      dayId: item.tripDayId,
      dayNumber: day?.dayNumber ?? 1,
      dayColor: DAY_COLORS[((day?.dayNumber ?? 1) - 1) % DAY_COLORS.length]!,
    };
    const toMapItem = (id: string, label: string, locationId: string | null): MapItem => {
      const location = locationId ? locations[locationId] : undefined;
      return {
        ...base,
        id,
        label,
        ...(location?.point ? { point: { longitude: location.point.longitude, latitude: location.point.latitude, crs: "WGS84" } } : {}),
      };
    };
    if (item.itemType === "transport") {
      const label = item.target ?? "交通事项";
      return [
        toMapItem(`${item.id}:start`, `${label} · 起点`, item.startLocationId),
        toMapItem(`${item.id}:end`, `${label} · 终点`, item.endLocationId),
      ];
    }
    const location = item.locationId ? locations[item.locationId] : undefined;
    return [toMapItem(item.id, item.target ?? location?.name ?? location?.inputText ?? "未命名事项", item.locationId)];
  });
}

export function currentRouteSegments(routes: readonly RouteSegment[], dayId: string | null): RouteSegment[] {
  return dayId ? routes.filter((route) => route.tripDayId === dayId) : [...routes];
}

export function RouteMapWorkspace({ tripId, transportModes, refreshVersion = 0 }: {
  readonly tripId: string;
  readonly transportModes: readonly TransportModeView[];
  readonly refreshVersion?: number;
}) {
  const [days, setDays] = useState<ProductDay[]>([]);
  const [items, setItems] = useState<ProductItem[]>([]);
  const [locations, setLocations] = useState<Record<string, LocationView>>({});
  const [routes, setRoutes] = useState<RouteSegment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settledRefreshVersion, setSettledRefreshVersion] = useState(refreshVersion);
  const selectionStore = useMemo(() => new MapTimelineSelectionStore(), []);
  const selection = useSyncExternalStore(
    (listener) => selectionStore.subscribe(listener),
    () => selectionStore.state,
    () => selectionStore.state,
  );
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const selectMapItem = useCallback((id: string) => {
    selectionStore.selectFromMarker(id.split(":", 1)[0]!);
    setSelectedRouteId(null);
  }, [selectionStore]);
  const selectRoute = useCallback((id: string) => setSelectedRouteId(id), []);

  const refresh = useCallback(async () => {
    try {
      const loadedDays = await itineraryApi<ProductDay[]>(`/trips/${tripId}/days`);
      const itemGroups = await Promise.all(loadedDays.map((day) => itineraryApi<ProductItem[]>(`/trips/${tripId}/days/${day.id}/itinerary-items`)));
      const loadedItems = itemGroups.flat();
      const locationIds = [...new Set(loadedItems.flatMap((item) => [item.locationId, item.startLocationId, item.endLocationId]).filter((id): id is string => Boolean(id)))];
      const loadedLocations = await Promise.all(locationIds.map((id) => itineraryApi<LocationView>(`/trips/${tripId}/locations/${id}`)));
      const loadedRoutes = await itineraryApi<RouteSegment[]>(`/trips/${tripId}/routes`);
      setDays((current) => sameJson(current, loadedDays) ? current : loadedDays);
      setItems((current) => sameJson(current, loadedItems) ? current : loadedItems);
      const nextLocations = Object.fromEntries(loadedLocations.map((location) => [location.id, location]));
      setLocations((current) => sameJson(current, nextLocations) ? current : nextLocations);
      setRoutes((current) => sameJson(current, loadedRoutes) ? current : loadedRoutes);
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

  useEffect(() => {
    if (refreshVersion <= settledRefreshVersion) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void refresh().finally(() => {
        if (!cancelled) setSettledRefreshVersion(refreshVersion);
      });
    }, 750);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refresh, refreshVersion, settledRefreshVersion]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const mapItems = useMemo(() => buildRouteMapItems(items, days, locations), [days, items, locations]);
  const visibleRoutes = useMemo(() => currentRouteSegments(routes, selectedDayId), [routes, selectedDayId]);
  const visibleItems = useMemo(() => selectedDayId ? mapItems.filter(({ dayId }) => dayId === selectedDayId) : mapItems, [mapItems, selectedDayId]);
  const visibleTimelineItems = useMemo(() => selectedDayId ? items.filter(({ tripDayId }) => tripDayId === selectedDayId) : items, [items, selectedDayId]);
  const selectedItemId = selection.selected?.itemId ?? null;
  const selectedRoute = routes.find(({ id }) => id === selectedRouteId) ?? null;
  const isGenerating = settledRefreshVersion < refreshVersion || (items.length >= 2 && (routes.length === 0 || routes.some((route) => route.status === "resolving" || (route.status === "pending" && !Array.isArray(route.sourceContext.blockers)))));

  function itemLabel(id: string | null): string {
    if (!id) return "未知端点";
    const item = itemById.get(id);
    return item?.target ?? id;
  }

  const gaps = visibleRoutes.filter(({ geometry, status }) => !geometry && (status === "pending" || status === "failed"));
  const modeLegend = [...new Set(visibleRoutes.map(({ transportModeCode }) => transportModeCode ?? "OTHER"))].map((code) => {
    const customMode = transportModes.find((mode) => mode.code === code);
    return { code, style: routeStyle({ modeCode: code, quality: "actual", ...(customMode ? { customMode } : {}) }) };
  });

  return <section aria-label="路线地图" className="workspaceCard routeWorkspace">
    <header><h2>路线与时间线</h2><p>地图只绘制 Route API 返回的持久化 WGS84 几何。</p></header>
    {isGenerating ? <p role="status">路线生成中…</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    <nav aria-label="地图范围">
      <button type="button" aria-pressed={selectedDayId === null} onClick={() => setSelectedDayId(null)}>全局地图</button>
      {days.map((day) => <button key={day.id} type="button" aria-pressed={selectedDayId === day.id} onClick={() => setSelectedDayId(day.id)}>Day {day.dayNumber}</button>)}
    </nav>
    {visibleItems.some(({ point }) => point) ? <RealRouteMap
      items={visibleItems}
      routes={visibleRoutes}
      transportModes={transportModes}
      selectedRouteId={selectedRouteId}
      selectedItemId={selectedItemId}
      onSelect={selectMapItem}
      onRouteSelect={selectRoute}
    /> : <p role="status">无有效坐标：请先确认地点</p>}
    <small className="otr-map-attribution">地图数据 © On The Road fixture</small>
    {modeLegend.length > 0 ? <ul aria-label="路线交通方式图例">{modeLegend.map(({ code, style }) => <li key={code} data-line-style={style.dasharray.join(" ")}><span aria-hidden="true">{style.icon}</span> {style.label}{code === "OTHER" ? "（未指定交通方式，请确认）" : ""}</li>)}</ul> : null}
    {gaps.length > 0 ? <aside aria-label="路线缺口"><h3>路线缺口</h3><ul>{gaps.map((route) => {
      const blockers = Array.isArray(route.sourceContext.blockers)
        ? route.sourceContext.blockers.map((blocker) => ROUTE_BLOCKER_LABELS[String(blocker)] ?? String(blocker)).join("、")
        : "地点尚未确认";
      return <li key={route.id}>{itemLabel(route.fromItineraryItemId)} → {itemLabel(route.toItineraryItemId)}：{blockers}</li>;
    })}</ul></aside> : null}
    <ol aria-label="行程时间线" className="workspaceTimeline">{visibleTimelineItems.map((item) => <li key={item.id}><button
      type="button"
      aria-pressed={selectedItemId === item.id}
      data-selected={selectedItemId === item.id}
      onClick={() => { selectionStore.selectFromTimeline(item.id, item.tripDayId); setSelectedRouteId(null); }}
    >{item.target ?? "未命名事项"}</button></li>)}</ol>
    {selectedItemId ? <p role="status">当前选择：{itemLabel(selectedItemId)}</p> : null}
    {visibleRoutes.length > 0 ? <ol aria-label="路线列表">{visibleRoutes.map((route) => {
      const customMode = transportModes.find(({ code }) => code === route.transportModeCode);
      const style = routeStyle({ modeCode: route.transportModeCode, quality: route.quality ?? "unknown", ...(customMode ? { customMode } : {}) });
      return <li key={route.id}><button type="button" onClick={() => setSelectedRouteId(route.id)}>{route.kind === "item_transport" ? "Transport 内部路线" : "连接路线"}：{itemLabel(route.fromItineraryItemId)} → {itemLabel(route.toItineraryItemId)} · {style.label} · {style.qualityLabel}</button></li>;
    })}</ol> : null}
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

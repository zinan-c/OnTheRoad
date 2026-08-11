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
  LOCATION_MISSING: "Location missing",
  LOCATION_NOT_CONFIRMED: "Location not confirmed",
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
      const label = item.target ?? "Transport item";
      return [
        toMapItem(`${item.id}:start`, `${label} · Origin`, item.startLocationId),
        toMapItem(`${item.id}:end`, `${label} · Destination`, item.endLocationId),
      ];
    }
    const location = item.locationId ? locations[item.locationId] : undefined;
    return [toMapItem(item.id, item.target ?? location?.name ?? location?.inputText ?? "Untitled item", item.locationId)];
  });
}

export function currentRouteSegments(routes: readonly RouteSegment[], dayId: string | null): RouteSegment[] {
  return dayId ? routes.filter((route) => route.tripDayId === dayId) : [...routes];
}

export function RouteMapWorkspace({ tripId, transportModes, refreshVersion = 0, selectedDayId, onSelectGlobalMap }: {
  readonly tripId: string;
  readonly transportModes: readonly TransportModeView[];
  readonly refreshVersion?: number;
  readonly selectedDayId: string | null;
  readonly onSelectGlobalMap: () => void;
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
      setLoadError(error instanceof Error ? error.message : "Unable to load routes");
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
    if (!id) return "Unknown endpoint";
    const item = itemById.get(id);
    return item?.target ?? id;
  }

  const gaps = visibleRoutes.filter(({ geometry, status }) => !geometry && (status === "pending" || status === "failed"));
  const modeLegend = [...new Set(visibleRoutes.map(({ transportModeCode }) => transportModeCode ?? "OTHER"))].map((code) => {
    const customMode = transportModes.find((mode) => mode.code === code);
    return { code, style: routeStyle({ modeCode: code, quality: "actual", ...(customMode ? { customMode } : {}) }) };
  });

  const selectedDay = days.find(({ id }) => id === selectedDayId);

  return <section aria-label="Route map" className="workspaceCard routeWorkspace">
    <header><h2>{selectedDay ? `Day ${selectedDay.dayNumber} route` : "Route map"}</h2><p>The map uses persisted WGS84 geometry returned by the Route API.</p></header>
    <nav className="mapScopeActions" aria-label="Map scope">
      <button id="map-scope-global" type="button" aria-pressed={selectedDayId === null} onClick={onSelectGlobalMap}>Global map</button>
      {selectedDay ? <span role="status">Showing Day {selectedDay.dayNumber}</span> : <span role="status">Showing all days</span>}
    </nav>
    {isGenerating ? <p role="status">Generating routes…</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {visibleItems.some(({ point }) => point) ? <RealRouteMap
      items={visibleItems}
      routes={visibleRoutes}
      transportModes={transportModes}
      selectedRouteId={selectedRouteId}
      selectedItemId={selectedItemId}
      onSelect={selectMapItem}
      onRouteSelect={selectRoute}
    /> : <p role="status">No valid coordinates. Confirm a location to show it on the map.</p>}
    <small className="otr-map-attribution">Map data © On The Road fixture</small>
    {modeLegend.length > 0 ? <ul aria-label="Route mode legend">{modeLegend.map(({ code, style }) => <li key={code} data-line-style={style.dasharray.join(" ")}><span aria-hidden="true">{style.icon}</span> {style.label}{code === "OTHER" ? " (transport mode not specified)" : ""}</li>)}</ul> : null}
    {gaps.length > 0 ? <aside aria-label="Route gaps"><h3>Route gaps</h3><ul>{gaps.map((route) => {
      const blockers = Array.isArray(route.sourceContext.blockers)
        ? route.sourceContext.blockers.map((blocker) => ROUTE_BLOCKER_LABELS[String(blocker)] ?? String(blocker)).join(", ")
        : "Location not confirmed";
      return <li key={route.id}>{itemLabel(route.fromItineraryItemId)} → {itemLabel(route.toItineraryItemId)}: {blockers}</li>;
    })}</ul></aside> : null}
    <ol aria-label="Itinerary timeline" className="workspaceTimeline">{visibleTimelineItems.map((item) => <li key={item.id}><button
      type="button"
      aria-pressed={selectedItemId === item.id}
      data-selected={selectedItemId === item.id}
      onClick={() => { selectionStore.selectFromTimeline(item.id, item.tripDayId); setSelectedRouteId(null); }}
    >{item.target ?? "Untitled item"}</button></li>)}</ol>
    {selectedItemId ? <p role="status">Selected: {itemLabel(selectedItemId)}</p> : null}
    {visibleRoutes.length > 0 ? <ol aria-label="Route list">{visibleRoutes.map((route) => {
      const customMode = transportModes.find(({ code }) => code === route.transportModeCode);
      const style = routeStyle({ modeCode: route.transportModeCode, quality: route.quality ?? "unknown", ...(customMode ? { customMode } : {}) });
      return <li key={route.id}><button type="button" onClick={() => setSelectedRouteId(route.id)}>{route.kind === "item_transport" ? "Transport route" : "Connection route"}: {itemLabel(route.fromItineraryItemId)} → {itemLabel(route.toItineraryItemId)} · {style.label} · {style.qualityLabel}</button></li>;
    })}</ol> : null}
    {selectedRoute ? <aside aria-label="Route details">
      <h3>{itemLabel(selectedRoute.fromItineraryItemId)} → {itemLabel(selectedRoute.toItineraryItemId)}</h3>
      <dl>
        <div><dt>Transport mode</dt><dd>{routeStyle({ modeCode: selectedRoute.transportModeCode, quality: selectedRoute.quality ?? "unknown", ...(transportModes.find(({ code }) => code === selectedRoute.transportModeCode) ? { customMode: transportModes.find(({ code }) => code === selectedRoute.transportModeCode)! } : {}) }).label}</dd></div>
        <div><dt>Provider</dt><dd>{selectedRoute.provider ?? "Not generated"}</dd></div>
        <div><dt>Quality</dt><dd>{routeStyle({ quality: (selectedRoute.quality ?? "unknown") as RouteQuality }).qualityLabel}</dd></div>
        <div><dt>Endpoints</dt><dd>{selectedRoute.fromLocationId ?? "Unresolved"} → {selectedRoute.toLocationId ?? "Unresolved"}</dd></div>
      </dl>
    </aside> : null}
  </section>;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

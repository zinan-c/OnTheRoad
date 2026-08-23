"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

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

export type RouteGenerationStatus = "loading" | "done";

export type RouteStatusSnapshot = {
  readonly status: RouteGenerationStatus;
  readonly generations: readonly {
    readonly dayId: string;
    readonly dayNumber: number;
    readonly routeGeneration: number;
  }[];
  readonly pendingDays: number;
  readonly blockedSegments: number;
  readonly failedSegments: number;
  readonly pollAfterMs: number;
};

export const ROUTE_STATUS_POLL_INTERVAL_MS = 1_500;
export const ROUTE_STATUS_MAX_POLLS = 40;
export const ROUTE_STATUS_MAX_DURATION_MS = 60_000;

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

export function RouteMapWorkspace({ tripId, transportModes, refreshVersion = 0, selectedDayId, onSelectGlobalMap, compact = false, showTimeline = false }: {
  readonly tripId: string;
  readonly transportModes: readonly TransportModeView[];
  readonly refreshVersion?: number;
  readonly selectedDayId: string | null;
  readonly onSelectGlobalMap: () => void;
  readonly compact?: boolean;
  readonly showTimeline?: boolean;
}) {
  const [days, setDays] = useState<ProductDay[]>([]);
  const [items, setItems] = useState<ProductItem[]>([]);
  const [locations, setLocations] = useState<Record<string, LocationView>>({});
  const [routes, setRoutes] = useState<RouteSegment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<RouteStatusSnapshot | null>(null);
  const [routeStatusError, setRouteStatusError] = useState<string | null>(null);
  const [routeStatusRetryKey, setRouteStatusRetryKey] = useState(0);
  const routeStatusStartedAt = useRef(0);
  const routeStatusPolls = useRef(0);
  const selectionStore = useMemo(() => new MapTimelineSelectionStore(), []);
  const selection = useSyncExternalStore(
    (listener) => selectionStore.subscribe(listener),
    () => selectionStore.state,
    () => selectionStore.state,
  );
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const previousSelectedDayId = useRef(selectedDayId);
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

  const loadRouteStatus = useCallback(async (): Promise<RouteStatusSnapshot> => {
    const status = await itineraryApi<RouteStatusSnapshot>(`/trips/${tripId}/routes/status`);
    setRouteStatus(status);
    setRouteStatusError(null);
    return status;
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    routeStatusStartedAt.current = performance.now();
    routeStatusPolls.current = 0;
    setRouteStatus(null);
    setRouteStatusError(null);

    const poll = async () => {
      try {
        const status = await loadRouteStatus();
        if (cancelled) return;
        if (status.status === "done") {
          await refresh();
          return;
        }
        routeStatusPolls.current += 1;
        const timedOut = performance.now() - routeStatusStartedAt.current >= ROUTE_STATUS_MAX_DURATION_MS;
        const exhausted = routeStatusPolls.current >= ROUTE_STATUS_MAX_POLLS;
        if (timedOut || exhausted) {
          setRouteStatusError("Route generation is taking longer than expected. Refresh to check again.");
          return;
        }
        timer = window.setTimeout(() => void poll(), status.pollAfterMs || ROUTE_STATUS_POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        setRouteStatusError(error instanceof Error ? error.message : "Unable to load route status");
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadRouteStatus, refresh, refreshVersion, routeStatusRetryKey]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const mapItems = useMemo(() => buildRouteMapItems(items, days, locations), [days, items, locations]);
  const visibleRoutes = useMemo(() => currentRouteSegments(routes, selectedDayId), [routes, selectedDayId]);
  const visibleItems = useMemo(() => selectedDayId ? mapItems.filter(({ dayId }) => dayId === selectedDayId) : mapItems, [mapItems, selectedDayId]);
  const visibleTimelineItems = useMemo(() => selectedDayId ? items.filter(({ tripDayId }) => tripDayId === selectedDayId) : items, [items, selectedDayId]);
  const selectedItemId = selection.selected?.itemId ?? null;
  const selectedRoute = routes.find(({ id }) => id === selectedRouteId) ?? null;
  const isGenerating = routeStatus?.status === "loading";
  const hasDayScope = selectedDayId !== null;

  useEffect(() => {
    if (previousSelectedDayId.current === selectedDayId) return;
    previousSelectedDayId.current = selectedDayId;
    selectionStore.clear("filtered");
    setSelectedRouteId(null);
  }, [selectedDayId, selectionStore]);

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

  return <section aria-label="Route map" className={`workspaceCard routeWorkspace${compact ? " routeWorkspaceCompact" : ""}`}>
    <header><h2>{compact ? (selectedDay ? `Day ${selectedDay.dayNumber} map` : "Global map") : (selectedDay ? `Day ${selectedDay.dayNumber} route` : "Route map")}</h2>{compact ? null : <p>The map uses persisted WGS84 geometry returned by the Route API.</p>}</header>
    <nav className="mapScopeActions" aria-label="Map scope">
      <button id="map-scope-global" type="button" aria-pressed={selectedDayId === null} onClick={onSelectGlobalMap}>Global map</button>
      {selectedDay ? <span role="status">Showing Day {selectedDay.dayNumber}</span> : <span role="status">Showing all days</span>}
    </nav>
    {routeStatus === null ? <p role="status">Checking route status…</p> : isGenerating ? <p role="status">Generating routes…</p> : null}
    {routeStatusError ? <p role="alert">{routeStatusError}</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {routeStatusError ? <button type="button" onClick={() => setRouteStatusRetryKey((key) => key + 1)}>Refresh route status</button> : null}
    {visibleItems.some(({ point }) => point) ? <RealRouteMap
      items={visibleItems}
      routes={visibleRoutes}
      transportModes={transportModes}
      selectedRouteId={selectedRouteId}
      selectedItemId={showTimeline ? selectedItemId : null}
      onSelect={selectMapItem}
      onRouteSelect={selectRoute}
    /> : <p role="status">No valid coordinates. Confirm a location to show it on the map.</p>}
    {modeLegend.length > 0 ? <ul aria-label="Route mode legend">{modeLegend.map(({ code, style }) => <li
        key={code}
        data-mode-code={code}
        data-mode-label={style.label}
        data-mode-icon={style.icon}
        data-mode-color={style.color}
        data-line-style={style.lineStyle}
        style={{ color: style.color }}
      ><span aria-hidden="true">{style.icon}</span> {style.label} ({code}){code === "OTHER" ? " (transport mode not specified)" : ""}</li>)}</ul> : null}
    {gaps.length > 0 ? <aside aria-label="Route gaps"><h3>Route gaps</h3><ul>{gaps.map((route) => {
        const blockers = Array.isArray(route.sourceContext.blockers)
          ? route.sourceContext.blockers.map((blocker) => ROUTE_BLOCKER_LABELS[String(blocker)] ?? String(blocker)).join(", ")
          : "Location not confirmed";
        return <li key={route.id}>{itemLabel(route.fromItineraryItemId)} → {itemLabel(route.toItineraryItemId)}: {blockers}</li>;
      })}</ul></aside> : null}
    {showTimeline && hasDayScope ? <ol aria-label="Itinerary timeline" className="workspaceTimeline">{visibleTimelineItems.map((item) => <li key={item.id}><button
        type="button"
        aria-pressed={selectedItemId === item.id}
        data-selected={selectedItemId === item.id}
        onClick={() => { selectionStore.selectFromTimeline(item.id, item.tripDayId); setSelectedRouteId(null); }}
      >{item.target ?? "Untitled item"}</button></li>)}</ol> : null}
    {showTimeline && hasDayScope && selectedItemId ? <p role="status">Selected: {itemLabel(selectedItemId)}</p> : null}
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

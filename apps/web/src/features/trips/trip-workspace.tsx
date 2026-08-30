"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ExpenseWorkspace } from "../expenses/expense-workspace";
import { TripGalleryWorkspace } from "../attachments/trip-gallery";
import { ImportWorkspace } from "../imports/import-workspace";
import { ItineraryPanel, type ProductItem } from "../itinerary/itinerary-panel";
import { RouteMapWorkspace } from "../map/route-map-workspace";
import { formatTripDate } from "./trip-date";
import type { TransportModeView } from "./settings/transport-modes";

type Item = {
  readonly id: string;
  readonly target: string;
  readonly tripDayId?: string;
  readonly dayNumber?: number;
  readonly locationId?: string | null;
  readonly transportModeCode?: string | null;
};

type Day = {
  readonly id: string;
  readonly dayNumber: number;
  readonly date?: string;
  readonly version?: number;
  readonly items?: Item[];
};

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.json() as Promise<T>;
}

function flattenDays(days: Day[]): Item[] {
  return days.flatMap((day) => (day.items ?? []).map((item) => ({
    ...item,
    tripDayId: day.id,
    dayNumber: day.dayNumber,
  })));
}

function TripDayRail({
  days,
  selectedDayId,
  onSelect,
}: {
  readonly days: readonly Day[];
  readonly selectedDayId: string | null;
  readonly onSelect: (dayId: string | null) => void;
}) {
  return <aside className="tripDayRail" aria-label="Trip days">
    <div className="tripDayRailHeader">
      <p className="eyebrow">Days</p>
      <button className="tripDayAll" type="button" aria-pressed={selectedDayId === null} onClick={() => onSelect(null)}>
        <span>ALL</span>
        <small>Global map</small>
      </button>
    </div>
    <nav className="tripDayRailList" aria-label="Select day">
      {days.map((day) => <button
        className="tripDayButton"
        key={day.id}
        type="button"
        aria-label={`Day ${day.dayNumber}, ${formatTripDate(day.date)}`}
        aria-pressed={day.id === selectedDayId}
        onClick={() => onSelect(day.id)}
      >
        <span>Day {day.dayNumber}</span>
        <time dateTime={day.date}>{formatTripDate(day.date)}</time>
      </button>)}
    </nav>
  </aside>;
}

export function TripWorkspace({ tripId, showMapTimeline = false, showItineraryPanel = false }: {
  readonly tripId: string;
  readonly showMapTimeline?: boolean;
  readonly showItineraryPanel?: boolean;
}) {
  const [days, setDays] = useState<Day[]>([]);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [tripTransportModes, setTripTransportModes] = useState<TransportModeView[]>([]);
  const [routeRefreshVersion, setRouteRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDays([]);
    setSelectedDayId(null);
    void (async () => {
      const [loadedDays, loadedTransportModes] = await Promise.all([
        api<Day[]>(`/trips/${tripId}/days`).then(async (loaded) => Promise.all(
          loaded.map(async (day) => ({
            ...day,
            items: await api<Item[]>(`/trips/${tripId}/days/${day.id}/itinerary-items`),
          })),
        )),
        api<TransportModeView[]>(`/trips/${tripId}/transport-modes`).catch(() => []),
      ]);
      if (cancelled) return;
      setDays(loadedDays);
      setTripTransportModes(loadedTransportModes);
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  const items = useMemo(() => flattenDays(days), [days]);
  const handleItemsChange = useCallback((dayId: string, loadedItems: ProductItem[]) => {
    const workspaceItems = loadedItems.map((item) => ({
      ...item,
      target: item.target ?? item.description ?? "Untitled item",
    }));
    setDays((current) => current.map((day) => day.id === dayId
      ? { ...day, items: workspaceItems }
      : day));
  }, []);

  return <div className="tripWorkspace">
    <section className="tripDayWorkspace" aria-label="Daily itinerary and map">
      <TripDayRail days={days} selectedDayId={selectedDayId} onSelect={setSelectedDayId} />
      <div className="tripWorkspaceMain">
        <RouteMapWorkspace
          tripId={tripId}
          transportModes={tripTransportModes}
          refreshVersion={routeRefreshVersion}
          selectedDayId={selectedDayId}
          onSelectGlobalMap={() => setSelectedDayId(null)}
          showTimeline={showMapTimeline}
          compact
        />
        {showItineraryPanel && selectedDayId !== null ? <ItineraryPanel
            tripId={tripId}
            selectedDayId={selectedDayId}
            onSelectedDayChange={setSelectedDayId}
            onTransportModesChange={setTripTransportModes}
            onItemsChange={handleItemsChange}
            onRoutesInvalidated={() => setRouteRefreshVersion((version) => version + 1)}
            variant="workspace"
          /> : null}
      </div>
    </section>
    <ExpenseWorkspace
      tripId={tripId}
      days={days.map(({ id, dayNumber }) => ({ id, dayNumber }))}
      items={items}
    />
    <TripGalleryWorkspace tripId={tripId} items={items} />
    <ImportWorkspace tripId={tripId} />
  </div>;
}

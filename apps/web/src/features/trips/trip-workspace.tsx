"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ExpenseWorkspace } from "../expenses/expense-workspace";
import { ItineraryPanel, type ProductItem } from "../itinerary/itinerary-panel";
import { RouteMapWorkspace } from "../map/route-map-workspace";
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

export function TripWorkspace({ tripId }: { readonly tripId: string }) {
  const [days, setDays] = useState<Day[]>([]);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [mapDayId, setMapDayId] = useState<string | null>(null);
  const [tripTransportModes, setTripTransportModes] = useState<TransportModeView[]>([]);
  const [routeRefreshVersion, setRouteRefreshVersion] = useState(0);

  useEffect(() => {
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
      setDays(loadedDays);
      setSelectedDayId((current) => current ?? loadedDays[0]?.id ?? null);
      setTripTransportModes(loadedTransportModes);
    })();
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
    <section className="dayRouteWorkspace" aria-label="Daily itinerary and map">
      <ItineraryPanel
        tripId={tripId}
        selectedDayId={selectedDayId}
        onSelectedDayChange={setSelectedDayId}
        onDaySelect={setMapDayId}
        onTransportModesChange={setTripTransportModes}
        onItemsChange={handleItemsChange}
        onRoutesInvalidated={() => setRouteRefreshVersion((version) => version + 1)}
      />
      <RouteMapWorkspace
        tripId={tripId}
        transportModes={tripTransportModes}
        refreshVersion={routeRefreshVersion}
        selectedDayId={mapDayId}
        onSelectGlobalMap={() => setMapDayId(null)}
      />
    </section>
    <ExpenseWorkspace
      tripId={tripId}
      days={days.map(({ id, dayNumber }) => ({ id, dayNumber }))}
      items={items}
    />
  </div>;
}

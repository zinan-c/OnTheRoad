"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TripSettingsRecord } from "../../features/trips/trip-settings";

interface TripPage {
  readonly items: readonly TripSettingsRecord[];
}

export interface TripListGateway {
  list(status: "active" | "deleted"): Promise<readonly TripSettingsRecord[]>;
  restore(tripId: string, version: number): Promise<TripSettingsRecord>;
}

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
}

export function browserTripListGateway(): TripListGateway {
  const client = new OnTheRoadClient(apiOrigin());
  return {
    async list(status) {
      await client.request("createDevelopmentSession", {
        body: { subject: "browser-demo-owner" },
      });
      const response = await client.request("listTrips", { query: { status, limit: 100 } });
      return (response.data as TripPage).items;
    },
    async restore(tripId, version) {
      const response = await client.request("restoreTrip", {
        path: { tripId },
        headers: { "If-Match": String(version) },
      });
      return response.data as TripSettingsRecord;
    },
  };
}

export function TripList({ gateway }: { readonly gateway?: TripListGateway }) {
  const activeGateway = useMemo(() => gateway ?? browserTripListGateway(), [gateway]);
  const [view, setView] = useState<"active" | "deleted">("active");
  const [trips, setTrips] = useState<readonly TripSettingsRecord[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const load = useCallback(async (status: "active" | "deleted") => {
    setPending(true);
    setError(undefined);
    try {
      setTrips(await activeGateway.list(status));
    } catch {
      setError("Unable to load trips.");
    } finally {
      setPending(false);
    }
  }, [activeGateway]);

  useEffect(() => {
    void load(view);
  }, [load, view]);

  async function restore(trip: TripSettingsRecord) {
    setPending(true);
    setError(undefined);
    try {
      const restored = await activeGateway.restore(trip.id, trip.version);
      setMessage(`“${restored.name}” was restored with all related content.`);
      setView("active");
    } catch {
      setError("Restore failed. Reload Trash and try again.");
      setPending(false);
    }
  }

  return (
    <section className="tripListPage">
      <p className="eyebrow">Your journeys</p>
      <h1>Trips</h1>
      <div className="actions" role="tablist" aria-label="Trip list view">
        <button role="tab" aria-selected={view === "active"} onClick={() => setView("active")}>Active trips</button>
        <button role="tab" aria-selected={view === "deleted"} onClick={() => setView("deleted")}>Trash</button>
      </div>
      {message ? <p role="status" className="status statusReady">{message}</p> : null}
      {error ? <p role="alert" className="formError">{error}</p> : null}
      {pending ? <p className="status">Loading…</p> : null}
      {!pending && trips.length === 0 ? <p className="emptyState">No trips here yet.</p> : null}
      <ul className="tripList" aria-label={view === "active" ? "Active trips" : "Deleted trips"}>
        {trips.map((trip) => (
          <li key={trip.id} id={`trip-card-${trip.id}`}>
            <div>
              <h2>{trip.name}</h2>
              <p>{trip.startDate} — {trip.endDate} · {trip.totalDays} days</p>
            </div>
            {view === "active" ? (
              <a className="primary" href={`/trips/${trip.id}`}>Open trip</a>
            ) : (
              <button className="primary" disabled={pending} onClick={() => restore(trip)}>Restore trip</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

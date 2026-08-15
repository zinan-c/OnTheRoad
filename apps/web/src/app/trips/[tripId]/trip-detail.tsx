"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useCallback, useEffect, useState } from "react";
import type { TripSettingsRecord } from "../../../features/trips/trip-settings";
import { TripWorkspace } from "../../../features/trips/trip-workspace";

interface Trip extends TripSettingsRecord {}

const client = new OnTheRoadClient(
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001",
);

export function TripDetail({ tripId }: { readonly tripId: string }) {
  const [trip, setTrip] = useState<Trip>();
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "error">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await client.request("getTrip", { path: { tripId } });
      setTrip(response.data as Trip);
      setStatus("ready");
    } catch {
      setStatus("signed-out");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await client.request("deleteSession");
    setTrip(undefined);
    setStatus("signed-out");
  }

  async function login() {
    try {
      await client.request("createDevelopmentSession", {
        body: { subject: "browser-demo-owner" },
      });
      await load();
    } catch {
      setStatus("error");
    }
  }

  if (status === "loading") return <p className="status">Loading trip…</p>;
  if (status === "signed-out") {
    return (
      <section className="emptyState">
        <h1 data-testid="session-ended">Session ended</h1>
        <p>Sign in again to continue editing this trip.</p>
        <button className="primary" data-testid="sign-in-again" onClick={login}>Sign in again</button>
      </section>
    );
  }
  if (status === "error" || !trip) return <p role="alert">This trip is temporarily unavailable.</p>;
  return (
    <section className="tripSummary">
      <p className="eyebrow">Your journey</p>
      <h1 id="trip-title" data-testid="trip-title">{trip.name}</h1>
      <p className="lead">{trip.startDate} — {trip.endDate}</p>
      <div className="actions">
        <a className="secondary" href={`/trips/${tripId}/settings`}>Trip settings</a>
      </div>
      <p className="status statusReady">Saved · your changes persist after refresh</p>
      <TripWorkspace key={trip.version} tripId={tripId} showItineraryPanel />
      <button className="secondary" data-testid="sign-out" onClick={logout}>Sign out</button>
    </section>
  );
}

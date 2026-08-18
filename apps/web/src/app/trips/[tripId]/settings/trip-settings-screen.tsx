"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  TripSettings,
  type TripSettingsRecord,
} from "../../../../features/trips/trip-settings";
import { TransportModeManager } from "../../../../features/trips/settings/transport-mode-manager";

const client = new OnTheRoadClient(
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001",
);

export function TripSettingsScreen({ tripId }: { readonly tripId: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<TripSettingsRecord>();
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "error">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await client.request("getTrip", { path: { tripId } });
      setTrip(response.data as TripSettingsRecord);
      setStatus("ready");
    } catch {
      setStatus("signed-out");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (status === "loading") return <p className="status">Loading trip settings…</p>;
  if (status === "signed-out") return <section className="emptyState"><h1>Session ended</h1><p>Sign in again to manage this trip.</p><button className="primary" onClick={login}>Sign in again</button></section>;
  if (status === "error" || !trip) return <p role="alert">Trip settings are temporarily unavailable.</p>;

  return (
    <section className="settingsPage">
      <p className="eyebrow">Trip management</p>
      <h1 id="trip-settings-name">{trip.name}</h1>
      <TripSettings
        trip={trip}
        onTripChange={setTrip}
        onDeleted={() => router.push("/trips")}
      />
      <TransportModeManager tripId={trip.id} onCatalogChange={() => undefined} />
    </section>
  );
}

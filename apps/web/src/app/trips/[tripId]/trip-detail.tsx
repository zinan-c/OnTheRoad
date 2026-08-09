"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  TripSettings,
  type TripSettingsRecord,
} from "../../../features/trips/trip-settings";
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

  if (status === "loading") return <p className="status">正在载入旅行…</p>;
  if (status === "signed-out") {
    return (
      <section className="emptyState">
        <h1>会话已退出</h1>
        <p>重新登录后可以继续编辑同一段旅程。</p>
        <button className="primary" onClick={login}>重新登录</button>
      </section>
    );
  }
  if (status === "error" || !trip) return <p role="alert">旅行暂时无法载入。</p>;
  return (
    <section className="tripSummary">
      <p className="eyebrow">Your journey</p>
      <h1>{trip.name}</h1>
      <p className="lead">{trip.startDate} — {trip.endDate}</p>
      <p className="status statusReady">已保存 · 刷新页面不会丢失</p>
      <TripSettings trip={trip} onTripChange={(updated) => setTrip(updated as Trip)} />
      <TripWorkspace key={trip.version} tripId={tripId} />
      <button className="secondary" onClick={logout}>退出登录</button>
    </section>
  );
}

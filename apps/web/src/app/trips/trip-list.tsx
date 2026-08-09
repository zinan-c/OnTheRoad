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
      setError("旅行列表载入失败。");
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
      setMessage(`已恢复“${restored.name}”，原旅行和关联内容保持不变。`);
      setView("active");
    } catch {
      setError("恢复失败，请重新载入回收站后重试。");
      setPending(false);
    }
  }

  return (
    <section className="tripListPage">
      <p className="eyebrow">Your journeys</p>
      <h1>旅行列表</h1>
      <div className="actions" role="tablist" aria-label="旅行列表范围">
        <button role="tab" aria-selected={view === "active"} onClick={() => setView("active")}>进行中的旅行</button>
        <button role="tab" aria-selected={view === "deleted"} onClick={() => setView("deleted")}>回收站</button>
      </div>
      {message ? <p role="status" className="status statusReady">{message}</p> : null}
      {error ? <p role="alert" className="formError">{error}</p> : null}
      {pending ? <p className="status">正在载入…</p> : null}
      {!pending && trips.length === 0 ? <p className="emptyState">这里还没有旅行。</p> : null}
      <ul className="tripList" aria-label={view === "active" ? "进行中的旅行" : "已删除的旅行"}>
        {trips.map((trip) => (
          <li key={trip.id}>
            <div>
              <h2>{trip.name}</h2>
              <p>{trip.startDate} — {trip.endDate} · {trip.totalDays} 天</p>
            </div>
            {view === "active" ? (
              <a className="primary" href={`/trips/${trip.id}`}>打开旅行</a>
            ) : (
              <button className="primary" disabled={pending} onClick={() => restore(trip)}>恢复旅行</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

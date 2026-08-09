"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { type FormEvent, useMemo, useState } from "react";

export interface TripSettingsRecord {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly totalDays: number;
  readonly version: number;
}

interface TripDayRecord {
  readonly id: string;
  readonly dayNumber: number;
  readonly date: string;
}

interface DateChangeResult {
  readonly trip: TripSettingsRecord;
  readonly createdDayIds: readonly string[];
  readonly archivedDayIds: readonly string[];
}

export interface TripDateSettingsGateway {
  listDays(tripId: string): Promise<readonly TripDayRecord[]>;
  changeDates(
    tripId: string,
    input: { readonly startDate: string; readonly endDate: string },
    version: number,
  ): Promise<DateChangeResult>;
}

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
}

export function browserTripDateSettingsGateway(): TripDateSettingsGateway {
  const client = new OnTheRoadClient(apiOrigin());
  return {
    async listDays(tripId) {
      const response = await client.request("listTripDays", { path: { tripId } });
      return response.data as TripDayRecord[];
    },
    async changeDates(tripId, input, version) {
      const response = await client.request("changeTripDates", {
        path: { tripId },
        headers: {
          "If-Match": String(version),
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: { ...input, removedDayPolicy: "reject_non_empty" },
      });
      return response.data as DateChangeResult;
    },
  };
}

function datesBetween(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  return Array.from(
    { length: Math.floor((end - start) / 86_400_000) + 1 },
    (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export function TripSettings({
  trip,
  gateway = browserTripDateSettingsGateway(),
  onTripChange,
}: {
  readonly trip: TripSettingsRecord;
  readonly gateway?: TripDateSettingsGateway;
  readonly onTripChange: (trip: TripSettingsRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [days, setDays] = useState<readonly TripDayRecord[]>();
  const [previewed, setPreviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const preview = useMemo(() => {
    if (!days || !previewed) return undefined;
    const next = datesBetween(startDate, endDate);
    const currentDates = new Set(days.map(({ date }) => date));
    const nextDates = new Set(next);
    return {
      added: next.filter((date) => !currentDates.has(date)),
      retained: days.filter(({ date }) => nextDates.has(date)),
      removed: days.filter(({ date }) => !nextDates.has(date)),
      totalDays: next.length,
    };
  }, [days, endDate, previewed, startDate]);

  function changeDate(setter: (value: string) => void, value: string) {
    setter(value);
    setPreviewed(false);
    setMessage(undefined);
  }

  async function showPreview() {
    setPending(true);
    setError(undefined);
    try {
      setDays(await gateway.listDays(trip.id));
      setPreviewed(true);
    } catch {
      setError("日期变更预览载入失败。");
    } finally {
      setPending(false);
    }
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || preview.totalDays === 0) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await gateway.changeDates(
        trip.id,
        { startDate, endDate },
        trip.version,
      );
      onTripChange(result.trip);
      setDays(undefined);
      setPreviewed(false);
      setMessage(`日期已更新为 ${startDate} 至 ${endDate}，共 ${result.trip.totalDays} 天。`);
    } catch {
      setError("日期更新失败；包含内容的 Day 不会被移除，请刷新后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="workspaceCard tripSettings" aria-labelledby="trip-settings-title">
      <header>
        <div>
          <h2 id="trip-settings-title">旅行设置</h2>
          <p>修改日期前先预览新增、保留和移除的 Day。</p>
        </div>
        <button className="secondary" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "收起设置" : "打开旅行设置"}
        </button>
      </header>
      {open ? (
        <form className="tripForm" aria-label="旅行日期设置" onSubmit={apply}>
          <div className="formRow">
            <label>
              开始日期
              <input
                type="date"
                value={startDate}
                onChange={(event) => changeDate(setStartDate, event.currentTarget.value)}
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                value={endDate}
                onChange={(event) => changeDate(setEndDate, event.currentTarget.value)}
              />
            </label>
          </div>
          <button type="button" className="secondary" disabled={pending} onClick={showPreview}>
            预览日期变更
          </button>
          {preview ? (
            <section aria-label="日期变更预览">
              <p>变更后共 {preview.totalDays} 天</p>
              <p>新增 Day：{preview.added.length ? preview.added.join("、") : "无"}</p>
              <p>保留 Day：{preview.retained.length}</p>
              <p>移除 Day：{preview.removed.length ? preview.removed.map(({ date }) => date).join("、") : "无"}</p>
              <button className="primary" disabled={pending || preview.totalDays === 0}>
                确认应用日期变更
              </button>
            </section>
          ) : null}
          {message ? <p className="status statusReady" role="status">{message}</p> : null}
          {error ? <p className="formError" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}

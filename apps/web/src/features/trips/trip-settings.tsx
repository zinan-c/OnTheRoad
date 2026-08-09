"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { type FormEvent, useMemo, useState } from "react";
import { useReferenceData } from "../reference-data/use-reference-data";

export interface TripSettingsRecord {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly totalDays: number;
  readonly travelers: number;
  readonly defaultCurrency: string;
  readonly budget: string | null;
  readonly timezone: string;
  readonly mapProfile: "cn_primary" | "international_primary" | "hybrid";
  readonly description: string | null;
  readonly status: "draft" | "active" | "archived" | "deleted";
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

export interface TripSettingsGateway {
  listDays(tripId: string): Promise<readonly TripDayRecord[]>;
  changeDates(
    tripId: string,
    input: { readonly startDate: string; readonly endDate: string },
    version: number,
  ): Promise<DateChangeResult>;
  update(
    tripId: string,
    input: Record<string, unknown>,
    version: number,
  ): Promise<TripSettingsRecord>;
  delete(tripId: string, version: number): Promise<TripSettingsRecord>;
}

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
}

export function browserTripSettingsGateway(): TripSettingsGateway {
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
    async update(tripId, input, version) {
      const response = await client.request("updateTrip", {
        path: { tripId },
        headers: { "If-Match": String(version) },
        body: input,
      });
      return response.data as TripSettingsRecord;
    },
    async delete(tripId, version) {
      const response = await client.request("deleteTrip", {
        path: { tripId },
        headers: { "If-Match": String(version) },
      });
      return response.data as TripSettingsRecord;
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
  gateway = browserTripSettingsGateway(),
  onTripChange,
  onDeleted,
}: {
  readonly trip: TripSettingsRecord;
  readonly gateway?: TripSettingsGateway;
  readonly onTripChange: (trip: TripSettingsRecord) => void;
  readonly onDeleted?: (trip: TripSettingsRecord) => void;
}) {
  const { currencies } = useReferenceData();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [days, setDays] = useState<readonly TripDayRecord[]>();
  const [previewed, setPreviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  async function updateBasics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const updated = await gateway.update(trip.id, {
        name: String(data.get("name") ?? "").trim(),
        description: String(data.get("description") ?? "").trim() || null,
        travelers: Number(data.get("travelers")),
        budget: String(data.get("budget") ?? "").trim() || null,
        defaultCurrency: String(data.get("defaultCurrency")),
        timezone: String(data.get("timezone")),
        mapProfile: String(data.get("mapProfile")),
      }, trip.version);
      onTripChange(updated);
      setMessage(`基本设置已保存，当前版本 ${updated.version}。`);
    } catch {
      setError("旅行设置保存失败，请刷新后重试。");
    } finally {
      setPending(false);
    }
  }

  async function deleteTrip() {
    setPending(true);
    setError(undefined);
    try {
      const deleted = await gateway.delete(trip.id, trip.version);
      onDeleted?.(deleted);
    } catch {
      setError("删除失败，请刷新后重试。");
      setPending(false);
      setConfirmingDelete(false);
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
        <div className="tripSettingsForms">
        <form className="tripForm" aria-label="旅行基本设置" onSubmit={updateBasics}>
          <label>
            旅行名称
            <input name="name" required minLength={2} defaultValue={trip.name} />
          </label>
          <label>
            旅行描述
            <textarea name="description" defaultValue={trip.description ?? ""} />
          </label>
          <div className="formRow">
            <label>
              同行人数
              <input name="travelers" type="number" min="1" max="99" defaultValue={trip.travelers} />
            </label>
            <label>
              预算
              <input name="budget" inputMode="decimal" defaultValue={trip.budget ?? ""} />
            </label>
          </div>
          <div className="formRow">
            <label>
              默认币种
              <select name="defaultCurrency" defaultValue={trip.defaultCurrency}>
                {currencies.map(({ code, label }) => (
                  <option key={code} value={code}>{code} · {label}</option>
                ))}
              </select>
            </label>
            <label>
              时区
              <input name="timezone" defaultValue={trip.timezone} />
            </label>
          </div>
          <label>
            地图配置
            <select name="mapProfile" defaultValue={trip.mapProfile}>
              <option value="cn_primary">中国大陆优先</option>
              <option value="international_primary">国际优先</option>
              <option value="hybrid">混合</option>
            </select>
          </label>
          <button className="primary" disabled={pending}>保存基本设置</button>
        </form>
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
        <section className="dangerZone" aria-label="删除旅行">
          <h3>删除旅行</h3>
          <p>旅行会进入回收站，关联 Day、Item、地点和费用会保留。</p>
          {confirmingDelete ? (
            <div className="actions">
              <button type="button" disabled={pending} onClick={deleteTrip}>确认删除</button>
              <button type="button" disabled={pending} onClick={() => setConfirmingDelete(false)}>取消</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)}>删除旅行</button>
          )}
        </section>
        </div>
      ) : null}
    </section>
  );
}

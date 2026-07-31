"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

export interface CreatedTrip {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface TripCreationGateway {
  create(input: Record<string, unknown>): Promise<CreatedTrip>;
}

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
}

export function browserTripCreationGateway(): TripCreationGateway {
  const client = new OnTheRoadClient(apiOrigin());
  return {
    async create(input) {
      await client.request("createDevelopmentSession", {
        body: { subject: "browser-demo-owner" },
      });
      const response = await client.request("createTrip", {
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: input,
      });
      return response.data as CreatedTrip;
    },
  };
}

function inclusiveDays(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function TripCreateForm({
  gateway = browserTripCreationGateway(),
  navigate,
}: {
  readonly gateway?: TripCreationGateway;
  readonly navigate?: (trip: CreatedTrip) => void;
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState("2026-10-01");
  const [endDate, setEndDate] = useState("2026-10-05");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const totalDays = useMemo(
    () => inclusiveDays(startDate, endDate),
    [endDate, startDate],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || totalDays === null) return;
    setSubmitting(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const trip = await gateway.create({
        name: String(data.get("name") ?? "").trim(),
        startDate,
        endDate,
        travelers: Number(data.get("travelers")),
        defaultCurrency: String(data.get("defaultCurrency")),
        timezone: "Asia/Shanghai",
        mapProfile: "cn_primary",
        destinations: String(data.get("destinations") ?? "")
          .split(/[、,，]/u)
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => ({ name, countryCode: "CN" })),
      });
      if (navigate) navigate(trip);
      else router.push(`/trips/${trip.id}`);
    } catch {
      setError("创建失败，请检查服务连接后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="tripForm" onSubmit={submit} aria-label="新建旅行">
      <label>
        旅行名称
        <input name="name" required minLength={2} defaultValue="上海与舟山五日" />
      </label>
      <div className="formRow">
        <label>
          开始日期
          <input
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
        </label>
        <label>
          结束日期
          <input
            name="endDate"
            type="date"
            required
            value={endDate}
            onChange={(event) => setEndDate(event.currentTarget.value)}
          />
        </label>
      </div>
      <p className={totalDays === null ? "formError" : "formHint"} aria-live="polite">
        {totalDays === null ? "结束日期不能早于开始日期。" : `将自动生成 ${totalDays} 天计划`}
      </p>
      <label>
        目的地
        <input name="destinations" required defaultValue="上海、舟山" />
      </label>
      <div className="formRow">
        <label>
          同行人数
          <input name="travelers" type="number" min="1" max="99" defaultValue="2" />
        </label>
        <label>
          默认币种
          <select name="defaultCurrency" defaultValue="CNY">
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
            <option value="JPY">JPY</option>
          </select>
        </label>
      </div>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary formSubmit" disabled={submitting || totalDays === null}>
        {submitting ? "正在创建…" : "创建旅行"}
      </button>
    </form>
  );
}

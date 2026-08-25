"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { useReferenceData } from "../reference-data/use-reference-data";

export interface CreatedTrip {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface TripCreationGateway {
  create(
    input: Record<string, unknown>,
    options: { readonly idempotencyKey: string },
  ): Promise<CreatedTrip>;
}

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
}

export function browserTripCreationGateway(): TripCreationGateway {
  const client = new OnTheRoadClient(apiOrigin());
  return {
    async create(input, { idempotencyKey }) {
      const response = await client.request("createTrip", {
        headers: { "Idempotency-Key": idempotencyKey },
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
  const { currencies } = useReferenceData();
  const [startDate, setStartDate] = useState("2026-10-01");
  const [endDate, setEndDate] = useState("2026-10-05");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const submittingRef = useRef(false);
  const retryRef = useRef<{
    readonly fingerprint: string;
    readonly idempotencyKey: string;
  } | undefined>(undefined);
  const totalDays = useMemo(
    () => inclusiveDays(startDate, endDate),
    [endDate, startDate],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || totalDays === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const status = submitter instanceof HTMLButtonElement && submitter.value === "draft"
      ? "draft"
      : "active";
    const defaultCurrency = String(data.get("defaultCurrency"));
    const input = {
      name: String(data.get("name") ?? "").trim(),
      startDate,
      endDate,
      travelers: Number(data.get("travelers")),
      defaultCurrency,
      timezone: "Asia/Shanghai",
      mapProfile: defaultCurrency === "CNY" ? "cn_primary" : "international_primary",
      status,
      destinations: String(data.get("destinations") ?? "")
        .split(/[、,，]/u)
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name, countryCode: "CN" })),
    };
    const fingerprint = JSON.stringify(input);
    const retry = retryRef.current?.fingerprint === fingerprint
      ? retryRef.current
      : { fingerprint, idempotencyKey: crypto.randomUUID() };
    retryRef.current = retry;
    try {
      const trip = await gateway.create(input, {
        idempotencyKey: retry.idempotencyKey,
      });
      retryRef.current = undefined;
      if (navigate) navigate(trip);
      else router.push(`/trips/${trip.id}`);
    } catch {
      setError("Unable to create the trip. Check the service connection and try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="tripForm" onSubmit={submit} aria-label="New trip" data-testid="trip-create-form">
      <label>
        Trip name
        <input name="name" required minLength={2} defaultValue="Shanghai and Zhoushan" data-testid="trip-name-input" />
      </label>
      <div className="formRow">
        <label>
          Start date
          <input
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
        </label>
        <label>
          End date
          <input
            name="endDate"
            type="date"
            data-testid="trip-end-date-input"
            required
            value={endDate}
            onChange={(event) => setEndDate(event.currentTarget.value)}
          />
        </label>
      </div>
      <p className={totalDays === null ? "formError" : "formHint"} aria-live="polite" data-testid="trip-duration-hint">
        {totalDays === null ? "The end date cannot be earlier than the start date." : `${totalDays} daily ${totalDays === 1 ? "plan" : "plans"} will be created automatically.`}
      </p>
      <label>
        Destinations
        <input name="destinations" required defaultValue="Shanghai, Zhoushan" />
      </label>
      <div className="formRow">
        <label>
          Travelers
          <input name="travelers" type="number" min="1" max="99" defaultValue="2" />
        </label>
        <label>
          Default currency
          <select name="defaultCurrency" defaultValue="CNY">
            {currencies.map(({ code }) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <div className="actions">
        <button className="secondary formSubmit" name="status" value="draft" disabled={submitting || totalDays === null}>
          {submitting ? "Saving…" : "Save draft"}
        </button>
        <button className="primary formSubmit" name="status" value="active" disabled={submitting || totalDays === null} data-testid="create-trip-submit">
          {submitting ? "Creating…" : "Create trip"}
        </button>
      </div>
    </form>
  );
}

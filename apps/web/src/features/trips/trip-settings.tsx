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
  readonly lastActivityAt?: string;
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
  const [editing, setEditing] = useState(false);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [defaultCurrency, setDefaultCurrency] = useState(trip.defaultCurrency);
  const [mapProfile, setMapProfile] = useState(trip.mapProfile);
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
      setError("Unable to load the date-change preview.");
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
      setMessage(`Dates updated to ${startDate} – ${endDate} (${result.trip.totalDays} days).`);
      setEditing(false);
    } catch {
      setError("Date update failed. Days with content were preserved; refresh and try again.");
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
        defaultCurrency,
        timezone: String(data.get("timezone")),
        mapProfile,
      }, trip.version);
      onTripChange(updated);
      setMessage(`Trip settings saved at version ${updated.version}.`);
      setEditing(false);
    } catch {
      setError("Unable to save trip settings. Refresh and try again.");
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
      setError("Unable to delete this trip. Refresh and try again.");
      setPending(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <section className="workspaceCard tripSettings" aria-labelledby="trip-settings-title">
      <header>
        <div>
          <h2 id="trip-settings-title">Trip settings</h2>
          <p>Manage trip details, dates, and deletion from this dedicated page.</p>
        </div>
        {!editing ? <button className="primary" type="button" onClick={() => {
          setDefaultCurrency(trip.defaultCurrency);
          setMapProfile(trip.mapProfile);
          setEditing(true);
          setMessage(undefined);
          setError(undefined);
        }}>Edit trip</button> : null}
      </header>
      {editing ? (
        <div className="tripSettingsForms">
        <form className="tripForm" aria-label="Trip details" onSubmit={updateBasics}>
          <label>
            Trip name
            <input name="name" required minLength={2} defaultValue={trip.name} />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={trip.description ?? ""} />
          </label>
          <div className="formRow">
            <label>
              Travelers
              <input name="travelers" type="number" min="1" max="99" defaultValue={trip.travelers} />
            </label>
            <label>
              Budget
              <input name="budget" inputMode="decimal" defaultValue={trip.budget ?? ""} />
            </label>
          </div>
          <div className="formRow">
            <label>
              Default currency
              <select
                name="defaultCurrency"
                value={defaultCurrency}
                onChange={(event) => {
                  const currency = event.currentTarget.value;
                  setDefaultCurrency(currency);
                  setMapProfile(currency === "CNY" ? "cn_primary" : "international_primary");
                }}
              >
                {currencies.map(({ code }) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </label>
            <label>
              Timezone
              <input name="timezone" defaultValue={trip.timezone} />
            </label>
          </div>
          <label>
            Map profile
            <select
              name="mapProfile"
              value={mapProfile}
              onChange={(event) => setMapProfile(event.currentTarget.value as TripSettingsRecord["mapProfile"])}
            >
              <option value="cn_primary">Mainland China</option>
              <option value="international_primary">International</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <div className="actions">
            <button className="primary" disabled={pending}>Save changes</button>
            <button className="secondary" type="button" disabled={pending} onClick={() => {
              setStartDate(trip.startDate);
              setEndDate(trip.endDate);
              setDefaultCurrency(trip.defaultCurrency);
              setMapProfile(trip.mapProfile);
              setPreviewed(false);
              setEditing(false);
            }}>Cancel</button>
          </div>
        </form>
        <form className="tripForm" aria-label="Trip dates" onSubmit={apply}>
          <div className="formRow">
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(event) => changeDate(setStartDate, event.currentTarget.value)}
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(event) => changeDate(setEndDate, event.currentTarget.value)}
              />
            </label>
          </div>
          <button type="button" className="secondary" disabled={pending} onClick={showPreview}>
            Preview date changes
          </button>
          {preview ? (
            <section aria-label="Date change preview">
              <p>{preview.totalDays} days after this change</p>
              <p>Days added: {preview.added.length ? preview.added.join(", ") : "None"}</p>
              <p>Days retained: {preview.retained.length}</p>
              <p>Days removed: {preview.removed.length ? preview.removed.map(({ date }) => date).join(", ") : "None"}</p>
              <button className="primary" disabled={pending || preview.totalDays === 0}>
                Apply date changes
              </button>
            </section>
          ) : null}
        </form>
        </div>
      ) : <dl className="settingsSummary">
        <div><dt>Dates</dt><dd>{trip.startDate} – {trip.endDate}</dd></div>
        <div><dt>Travelers</dt><dd>{trip.travelers}</dd></div>
        <div><dt>Default currency</dt><dd>{trip.defaultCurrency}</dd></div>
        <div><dt>Timezone</dt><dd>{trip.timezone}</dd></div>
        <div><dt>Map profile</dt><dd>{trip.mapProfile}</dd></div>
      </dl>}
      {message ? <p className="status statusReady" role="status">{message}</p> : null}
      {error ? <p className="formError" role="alert">{error}</p> : null}
        <section className="dangerZone" aria-label="Delete trip">
          <h3>Delete trip</h3>
          <p>The trip moves to Trash. Its days, items, locations, and expenses remain recoverable.</p>
          {confirmingDelete ? (
            <div className="actions">
              <button type="button" disabled={pending} onClick={deleteTrip}>Confirm delete</button>
              <button type="button" disabled={pending} onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)}>Delete trip</button>
          )}
        </section>
    </section>
  );
}

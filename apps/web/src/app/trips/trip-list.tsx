"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TripSettingsRecord } from "../../features/trips/trip-settings";

export type TripListStatus = "active" | "deleted";
export type TripListSort = "lastActivityAt" | "createdAt" | "updatedAt" | "startDate" | "name";
export type TripListOrder = "asc" | "desc";

export interface TripListQuery {
  readonly status: TripListStatus;
  readonly search: string;
  readonly sort: TripListSort;
  readonly order: TripListOrder;
  readonly cursor?: string;
}

export interface TripPage {
  readonly items: readonly TripSettingsRecord[];
  readonly nextCursor: string | null;
}

export interface TripListGateway {
  list(query: TripListQuery): Promise<TripPage>;
  restore(tripId: string, version: number): Promise<TripSettingsRecord>;
}

const DEFAULT_QUERY: TripListQuery = {
  status: "active",
  search: "",
  sort: "lastActivityAt",
  order: "desc",
};

function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
}

export function browserTripListGateway(): TripListGateway {
  const client = new OnTheRoadClient(apiOrigin());
  return {
    async list(query) {
      const response = await client.request("listTrips", {
        query: {
          status: query.status,
          limit: 20,
          ...(query.search ? { search: query.search } : {}),
          sort: query.sort,
          order: query.order,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
      });
      return response.data as TripPage;
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

function asStatus(value: string | null): TripListStatus {
  return value === "deleted" ? "deleted" : "active";
}

function asSort(value: string | null): TripListSort {
  if (value === "createdAt" || value === "updatedAt" || value === "startDate" || value === "name") return value;
  return "lastActivityAt";
}

function asOrder(value: string | null): TripListOrder {
  return value === "asc" ? "asc" : "desc";
}

export function parseTripListQuery(params: Pick<URLSearchParams, "get">): TripListQuery {
  const search = (params.get("search") ?? "").trim().slice(0, 160);
  const cursor = params.get("cursor")?.trim() || undefined;
  return {
    status: asStatus(params.get("view") ?? params.get("status")),
    search,
    sort: asSort(params.get("sort")),
    order: asOrder(params.get("order")),
    ...(cursor ? { cursor } : {}),
  };
}

function resetCursor(query: TripListQuery): TripListQuery {
  const { cursor: _cursor, ...withoutCursor } = query;
  return withoutCursor;
}

export function tripListUrl(query: TripListQuery): string {
  const params = new URLSearchParams();
  if (query.status !== DEFAULT_QUERY.status) params.set("view", query.status);
  if (query.search) params.set("search", query.search);
  if (query.sort !== DEFAULT_QUERY.sort) params.set("sort", query.sort);
  if (query.order !== DEFAULT_QUERY.order) params.set("order", query.order);
  if (query.cursor) params.set("cursor", query.cursor);
  const suffix = params.toString();
  return suffix ? `/trips?${suffix}` : "/trips";
}

export function TripList({ gateway }: { readonly gateway?: TripListGateway }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeGateway = useMemo(() => gateway ?? browserTripListGateway(), [gateway]);
  const query = useMemo(() => parseTripListQuery(searchParams), [searchParams]);
  const [draftSearch, setDraftSearch] = useState(query.search);
  const [page, setPage] = useState<TripPage>({ items: [], nextCursor: null });
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [previousCursors, setPreviousCursors] = useState<readonly string[]>([]);
  const requestSequence = useRef(0);
  const queryKey = tripListUrl(query);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string>();

  useEffect(() => {
    setDraftSearch(query.search);
  }, [query.search]);

  const replaceQuery = useCallback((next: TripListQuery) => {
    router.replace(tripListUrl(next), { scroll: false });
  }, [router]);

  const load = useCallback(async (nextQuery: TripListQuery) => {
    const requestId = ++requestSequence.current;
    setPending(true);
    setError(undefined);
    try {
      const loaded = await activeGateway.list(nextQuery);
      if (requestId !== requestSequence.current) return;
      setPage(loaded);
      setLoadedQueryKey(tripListUrl(nextQuery));
    } catch {
      if (requestId !== requestSequence.current) return;
      setError("Unable to load trips.");
    } finally {
      if (requestId !== requestSequence.current) return;
      setPending(false);
    }
  }, [activeGateway]);

  useEffect(() => {
    setLoadedQueryKey(undefined);
    void load(query);
  }, [load, query]);

  useEffect(() => {
    setPreviousCursors([]);
  }, [query.status, query.search, query.sort, query.order]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviousCursors([]);
    replaceQuery({ ...resetCursor(query), search: draftSearch.trim().slice(0, 160) });
  }

  function chooseView(status: TripListStatus) {
    setPreviousCursors([]);
    replaceQuery({ ...resetCursor(query), status });
  }

  function chooseSort(sort: TripListSort) {
    setPreviousCursors([]);
    replaceQuery({ ...resetCursor(query), sort });
  }

  function chooseOrder(order: TripListOrder) {
    setPreviousCursors([]);
    replaceQuery({ ...resetCursor(query), order });
  }

  function nextPage() {
    if (!visiblePage.nextCursor || pending) return;
    setPreviousCursors((current) => [...current, query.cursor ?? ""]);
    replaceQuery({ ...query, cursor: visiblePage.nextCursor });
  }

  function previousPage() {
    const previous = previousCursors.at(-1);
    if (previous === undefined || pending) return;
    setPreviousCursors((current) => current.slice(0, -1));
    replaceQuery(previous ? { ...query, cursor: previous } : resetCursor(query));
  }

  async function restore(trip: TripSettingsRecord) {
    const requestId = ++requestSequence.current;
    setPending(true);
    setError(undefined);
    try {
      const restored = await activeGateway.restore(trip.id, trip.version);
      if (requestId !== requestSequence.current) return;
      setMessage(`“${restored.name}” was restored with all related content.`);
      setPage({ items: [], nextCursor: null });
      setLoadedQueryKey(undefined);
      setPreviousCursors([]);
      replaceQuery({ ...resetCursor(query), status: "active" });
    } catch {
      if (requestId !== requestSequence.current) return;
      setError("Restore failed. Reload Trash and try again.");
      setPending(false);
    }
  }

  const visiblePage = loadedQueryKey === queryKey ? page : { items: [], nextCursor: null };
  const pageLabel = query.cursor ? "More trips" : "Recent trips";
  return (
    <section className="tripListPage">
      <p className="eyebrow">Your journeys</p>
      <h1>Trips</h1>
      <div className="actions" role="tablist" aria-label="Trip list view">
        <button role="tab" aria-selected={query.status === "active"} onClick={() => chooseView("active")}>Active trips</button>
        <button role="tab" aria-selected={query.status === "deleted"} onClick={() => chooseView("deleted")}>Trash</button>
      </div>
      <form className="tripListControls" onSubmit={submitSearch} role="search">
        <label>
          Search trips
          <input
            aria-label="Search trips"
            value={draftSearch}
            maxLength={160}
            onChange={(event) => setDraftSearch(event.currentTarget.value)}
          />
        </label>
        <button className="secondary" type="submit">Search</button>
        <label>
          Sort by
          <select aria-label="Sort trips" value={query.sort} onChange={(event) => chooseSort(event.currentTarget.value as TripListSort)}>
            <option value="lastActivityAt">Recent activity</option>
            <option value="createdAt">Created date</option>
            <option value="updatedAt">Updated date</option>
            <option value="startDate">Start date</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label>
          Order
          <select aria-label="Sort order" value={query.order} onChange={(event) => chooseOrder(event.currentTarget.value as TripListOrder)}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
      </form>
      {message ? <p role="status" className="status statusReady">{message}</p> : null}
      {error ? <p role="alert" className="formError">{error}</p> : null}
      {pending ? <p className="status">Loading…</p> : null}
      {!pending && visiblePage.items.length === 0 ? <p className="emptyState">No trips here yet.</p> : null}
      <p className="tripListPageLabel">{pageLabel}</p>
      <ul className="tripList" aria-label={query.status === "active" ? "Active trips" : "Deleted trips"}>
        {visiblePage.items.map((trip) => (
          <li key={trip.id} id={`trip-card-${trip.id}`}>
            <div>
              <h2>{trip.name}</h2>
              <p>{trip.startDate} — {trip.endDate} · {trip.totalDays} days</p>
            </div>
            {query.status === "active" ? (
              <a className="primary" href={`/trips/${trip.id}`}>Open trip</a>
            ) : (
              <button className="primary" disabled={pending} onClick={() => restore(trip)}>Restore trip</button>
            )}
          </li>
        ))}
      </ul>
      <nav className="tripListPagination" aria-label="Trip pages">
        <button className="secondary" disabled={pending || previousCursors.length === 0} onClick={previousPage}>Previous</button>
        <button className="primary" disabled={pending || !visiblePage.nextCursor} onClick={nextPage}>Next</button>
      </nav>
    </section>
  );
}

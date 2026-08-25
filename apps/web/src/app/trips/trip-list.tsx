"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TripSettingsRecord } from "../../features/trips/trip-settings";

export type TripListStatus = "draft" | "active" | "archived" | "deleted";
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
  readonly previousCursor: string | null;
  readonly nextCursor: string | null;
}

export interface TripListGateway {
  list(query: TripListQuery, options?: { readonly signal?: AbortSignal }): Promise<TripPage>;
  restore(tripId: string, version: number): Promise<TripSettingsRecord>;
  transition(tripId: string, version: number, status: Exclude<TripListStatus, "deleted">): Promise<TripSettingsRecord>;
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
    async list(query, options) {
      const response = await client.request("listTrips", {
        query: {
          status: query.status,
          limit: 20,
          ...(query.search ? { search: query.search } : {}),
          sort: query.sort,
          order: query.order,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
        ...(options?.signal ? { signal: options.signal } : {}),
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
    async transition(tripId, version, status) {
      const response = await client.request("transitionTripStatus", {
        path: { tripId },
        headers: { "If-Match": String(version) },
        body: { status },
      });
      return response.data as TripSettingsRecord;
    },
  };
}

function asStatus(value: string | null): TripListStatus {
  if (value === "draft" || value === "archived" || value === "deleted") return value;
  return "active";
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
  if (query.order !== DEFAULT_QUERY.order || query.sort !== DEFAULT_QUERY.sort) {
    params.set("order", query.order);
  }
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
  const [page, setPage] = useState<TripPage>({ items: [], previousCursor: null, nextCursor: null });
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const requestSequence = useRef(0);
  const queryKey = tripListUrl(query);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string>();

  useEffect(() => {
    setDraftSearch(query.search);
  }, [query.search]);

  const pushQuery = useCallback((next: TripListQuery, explicitStatus = false) => {
    const canonicalUrl = tripListUrl(next);
    const navigationUrl = explicitStatus && next.status === "active"
      ? `${canonicalUrl}${canonicalUrl.includes("?") ? "&" : "?"}view=active`
      : canonicalUrl;
    window.history.pushState(null, "", navigationUrl);
  }, []);

  useEffect(() => {
    const canonicalUrl = tripListUrl(query);
    const currentSearch = searchParams.toString();
    const canonicalSearch = canonicalUrl.includes("?") ? canonicalUrl.slice(canonicalUrl.indexOf("?") + 1) : "";
    const currentWithoutExplicitActive = new URLSearchParams(currentSearch);
    if (query.status === "active" && currentWithoutExplicitActive.get("view") === "active") {
      currentWithoutExplicitActive.delete("view");
    }
    if (
      currentSearch !== canonicalSearch
      && currentWithoutExplicitActive.toString() !== canonicalSearch
    ) {
      router.replace(canonicalUrl, { scroll: false });
    }
  }, [query, router, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestSequence.current;
    setLoadedQueryKey(undefined);
    setPending(true);
    setError(undefined);
    void activeGateway.list(query, { signal: controller.signal }).then((loaded) => {
      if (controller.signal.aborted || requestId !== requestSequence.current) return;
      setPage(loaded);
      setLoadedQueryKey(queryKey);
    }).catch(() => {
      if (controller.signal.aborted || requestId !== requestSequence.current) return;
      setError("Unable to load trips.");
    }).finally(() => {
      if (controller.signal.aborted || requestId !== requestSequence.current) return;
      setPending(false);
    });
    return () => controller.abort();
  }, [activeGateway, query, queryKey]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pushQuery({ ...resetCursor(query), search: draftSearch.trim().slice(0, 160) });
  }

  function chooseView(status: TripListStatus) {
    pushQuery({ ...resetCursor(query), status }, true);
  }

  function chooseSort(sort: TripListSort) {
    pushQuery({ ...resetCursor(query), sort });
  }

  function chooseOrder(order: TripListOrder) {
    pushQuery({ ...resetCursor(query), order });
  }

  function nextPage() {
    if (!visiblePage.nextCursor || pending) return;
    pushQuery({ ...query, cursor: visiblePage.nextCursor });
  }

  function previousPage() {
    if (!visiblePage.previousCursor || pending) return;
    pushQuery({ ...query, cursor: visiblePage.previousCursor });
  }

  async function restore(trip: TripSettingsRecord) {
    const requestId = ++requestSequence.current;
    setPending(true);
    setError(undefined);
    try {
      const restored = await activeGateway.restore(trip.id, trip.version);
      if (requestId !== requestSequence.current) return;
      setMessage(`“${restored.name}” was restored with all related content.`);
      setPage({ items: [], previousCursor: null, nextCursor: null });
      setLoadedQueryKey(undefined);
      pushQuery({
        ...resetCursor(query),
        status: restored.status === "deleted" ? "active" : restored.status,
      }, true);
    } catch {
      if (requestId !== requestSequence.current) return;
      setError("Restore failed. Reload Trash and try again.");
      setPending(false);
    }
  }

  async function transition(trip: TripSettingsRecord, status: Exclude<TripListStatus, "deleted">) {
    const requestId = ++requestSequence.current;
    setPending(true);
    setError(undefined);
    try {
      const updated = await activeGateway.transition(trip.id, trip.version, status);
      if (requestId !== requestSequence.current) return;
      setMessage(`“${updated.name}” is now ${status}.`);
      setPage({ items: [], previousCursor: null, nextCursor: null });
      setLoadedQueryKey(undefined);
      pushQuery({ ...resetCursor(query), status }, true);
    } catch {
      if (requestId !== requestSequence.current) return;
      setError("Trip status update failed. Reload and try again.");
      setPending(false);
    }
  }

  const visiblePage = loadedQueryKey === queryKey
    ? page
    : { items: [], previousCursor: null, nextCursor: null };
  const pageLabel = query.cursor ? "More trips" : "Recent trips";
  const tabs: readonly { status: TripListStatus; label: string }[] = [
    { status: "active", label: "Active trips" },
    { status: "draft", label: "Drafts" },
    { status: "archived", label: "Archived" },
    { status: "deleted", label: "Trash" },
  ];
  return (
    <section className="tripListPage">
      <p className="eyebrow">Your journeys</p>
      <h1>Trips</h1>
      <div className="actions" role="tablist" aria-label="Trip list view">
        {tabs.map((tab) => (
          <button key={tab.status} role="tab" aria-selected={query.status === tab.status} onClick={() => chooseView(tab.status)}>{tab.label}</button>
        ))}
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
      <ul className="tripList" aria-label={tabs.find((tab) => tab.status === query.status)?.label ?? "Trips"}>
        {visiblePage.items.map((trip) => (
          <li key={trip.id} id={`trip-card-${trip.id}`}>
            <div>
              <h2>{trip.name}</h2>
              <p>{trip.startDate} — {trip.endDate} · {trip.totalDays} days</p>
            </div>
            {query.status !== "deleted" ? (
              <div className="tripListActions">
                <a className="primary" href={`/trips/${trip.id}`}>Open trip</a>
                {query.status === "active" ? (
                  <button className="secondary" disabled={pending} onClick={() => transition(trip, "archived")}>Archive</button>
                ) : (
                  <button className="secondary" disabled={pending} onClick={() => transition(trip, "active")}>Activate</button>
                )}
              </div>
            ) : (
              <button className="primary" disabled={pending} onClick={() => restore(trip)}>Restore trip</button>
            )}
          </li>
        ))}
      </ul>
      <nav className="tripListPagination" aria-label="Trip pages">
        <button className="secondary" disabled={pending || !visiblePage.previousCursor} onClick={previousPage}>Previous</button>
        <button className="primary" disabled={pending || !visiblePage.nextCursor} onClick={nextPage}>Next</button>
      </nav>
    </section>
  );
}

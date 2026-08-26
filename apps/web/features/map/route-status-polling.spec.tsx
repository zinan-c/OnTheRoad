// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ROUTE_STATUS_MAX_POLLS,
  ROUTE_STATUS_POLL_INTERVAL_MS,
  RouteMapWorkspace,
  type RouteStatusSnapshot,
} from "../../src/features/map/route-map-workspace";

const done: RouteStatusSnapshot = {
  status: "done",
  generations: [],
  pendingDays: 0,
  blockedSegments: 0,
  failedSegments: 0,
  failedDays: 0,
  pollAfterMs: ROUTE_STATUS_POLL_INTERVAL_MS,
};

const loading: RouteStatusSnapshot = {
  ...done,
  status: "loading",
  pendingDays: 1,
};

const failed: RouteStatusSnapshot = {
  ...done,
  status: "failed",
  failedDays: 1,
  failedSegments: 2,
};

const partial: RouteStatusSnapshot = {
  ...done,
  status: "partial",
  blockedSegments: 2,
  failedDays: 1,
  failedSegments: 8,
};

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

type RefreshFixture = {
  readonly days?: readonly { id: string; dayNumber: number }[];
  readonly items?: readonly {
    id: string;
    tripDayId: string;
    itemType: "activity";
    target: string;
    locationId: null;
    startLocationId: null;
    endLocationId: null;
  }[];
};

function installFetch(statuses: RouteStatusSnapshot[], fixture: RefreshFixture = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/routes/status")) {
      return Response.json(statuses.shift() ?? done);
    }
    if (url.endsWith("/days")) return Response.json(fixture.days ?? []);
    if (url.includes("/itinerary-items")) return Response.json(fixture.items ?? []);
    if (url.endsWith("/routes")) return Response.json([]);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function statusRequestCount(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/routes/status")).length;
}

function renderWorkspace(
  refreshVersion = 0,
  selectedDayId: string | null = null,
  showTimeline = false,
) {
  return render(
    <RouteMapWorkspace
      tripId="trip-1"
      transportModes={[]}
      refreshVersion={refreshVersion}
      selectedDayId={selectedDayId}
      onSelectGlobalMap={vi.fn()}
      showTimeline={showTimeline}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("finite route status polling", () => {
  test("loads itinerary and persisted routes while generation is still loading", async () => {
    const fetchMock = installFetch([loading]);
    renderWorkspace();
    await screen.findByText("Generating routes…");

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.endsWith("/days"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/routes"))).toBe(true);
  });

  test("does not poll again after the first done response", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetch([done]);
    renderWorkspace();
    await flushPromises();

    expect(statusRequestCount(fetchMock)).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * ROUTE_STATUS_POLL_INTERVAL_MS);
    });
    expect(statusRequestCount(fetchMock)).toBe(1);
  });

  test("stops polling on a terminal failure while keeping the workspace visible", async () => {
    const fetchMock = installFetch([failed]);
    renderWorkspace();
    expect(await screen.findByText("Route generation failed. Endpoint locations remain visible.")).toBeTruthy();
    expect(statusRequestCount(fetchMock)).toBe(1);
  });

  test("stops polling on partial completion and explains that some segments failed", async () => {
    const fetchMock = installFetch([partial]);
    renderWorkspace();
    expect(await screen.findByText("Route generation partially completed. Some route segments failed; endpoint locations remain visible.")).toBeTruthy();
    expect(statusRequestCount(fetchMock)).toBe(1);
  });

test("map timeline is opt-in and stays hidden by default", async () => {
    const fixture: RefreshFixture = {
      days: [{ id: "day-1", dayNumber: 1 }],
      items: [{
        id: "item-1",
        tripDayId: "day-1",
        itemType: "activity",
        target: "Global stop",
        locationId: null,
        startLocationId: null,
        endLocationId: null,
      }],
    };
    installFetch([done], fixture);
    const view = renderWorkspace(0, null);
    await screen.findByText("No valid coordinates. Confirm a location to show it on the map.");

    expect(screen.queryByRole("list", { name: "Itinerary timeline" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Route list" })).toBeNull();

    view.rerender(
      <RouteMapWorkspace
        tripId="trip-1"
        transportModes={[]}
        selectedDayId="day-1"
        onSelectGlobalMap={vi.fn()}
        showTimeline
      />,
    );
    expect(await screen.findByRole("button", { name: "Global stop" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Itinerary timeline" })).toBeTruthy();
  });

  test("polls loading until done, then stops", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetch([loading, done]);
    renderWorkspace();
    await flushPromises();
    expect(statusRequestCount(fetchMock)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_STATUS_POLL_INTERVAL_MS);
    });
    await flushPromises();
    expect(statusRequestCount(fetchMock)).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * ROUTE_STATUS_POLL_INTERVAL_MS);
    });
    expect(statusRequestCount(fetchMock)).toBe(2);
  });

  test("restarts with a new generation after the caller invalidates routes", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetch([done, loading, done]);
    const view = renderWorkspace();
    await flushPromises();
    expect(statusRequestCount(fetchMock)).toBe(1);

    view.rerender(
      <RouteMapWorkspace
        tripId="trip-1"
        transportModes={[]}
        refreshVersion={1}
        selectedDayId={null}
        onSelectGlobalMap={vi.fn()}
      />,
    );
    await flushPromises();
    expect(statusRequestCount(fetchMock)).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_STATUS_POLL_INTERVAL_MS);
    });
    await flushPromises();
    expect(statusRequestCount(fetchMock)).toBe(3);
  });

  test("stops after the bounded retry budget", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetch(Array.from({ length: ROUTE_STATUS_MAX_POLLS + 1 }, () => loading));
    renderWorkspace();
    await flushPromises();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUTE_STATUS_MAX_POLLS * ROUTE_STATUS_POLL_INTERVAL_MS);
    });
    await flushPromises();

    expect(statusRequestCount(fetchMock)).toBe(ROUTE_STATUS_MAX_POLLS);
  });
});

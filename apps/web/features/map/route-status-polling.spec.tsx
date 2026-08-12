// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
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
  pollAfterMs: ROUTE_STATUS_POLL_INTERVAL_MS,
};

const loading: RouteStatusSnapshot = {
  ...done,
  status: "loading",
  pendingDays: 1,
};

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function installFetch(statuses: RouteStatusSnapshot[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/routes/status")) {
      return Response.json(statuses.shift() ?? done);
    }
    if (url.endsWith("/days")) return Response.json([]);
    if (url.endsWith("/routes")) return Response.json([]);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function statusRequestCount(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/routes/status")).length;
}

function renderWorkspace(refreshVersion = 0) {
  return render(
    <RouteMapWorkspace
      tripId="trip-1"
      transportModes={[]}
      refreshVersion={refreshVersion}
      selectedDayId={null}
      onSelectGlobalMap={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("finite route status polling", () => {
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

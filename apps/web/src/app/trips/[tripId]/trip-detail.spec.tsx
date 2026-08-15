// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@on-the-road/contracts", () => ({
  OnTheRoadClient: class {
    request = mocks.request;
  },
}));

vi.mock("../../../features/trips/trip-workspace", () => ({
  TripWorkspace: ({
    showItineraryPanel,
    showMapTimeline,
  }: {
    readonly showItineraryPanel?: boolean;
    readonly showMapTimeline?: boolean;
  }) => (
    <div
      data-testid="trip-workspace"
      data-itinerary-panel={String(showItineraryPanel)}
      data-map-timeline={String(showMapTimeline)}
    />
  ),
}));

import { TripDetail } from "./trip-detail";

afterEach(() => {
  cleanup();
  mocks.request.mockReset();
});

test("production trip detail enables itinerary editing and the map timeline", async () => {
  mocks.request.mockResolvedValue({
    data: {
      id: "trip-1",
      name: "East China Sea",
      startDate: "2026-08-15",
      endDate: "2026-08-16",
      defaultCurrency: "CNY",
      mapProfile: "fixture",
      status: "draft",
      travelers: 1,
      destinations: [],
      deletedAt: null,
      version: 1,
    },
  });

  render(<TripDetail tripId="trip-1" />);

  const workspace = await screen.findByTestId("trip-workspace");
  expect(workspace.getAttribute("data-itinerary-panel")).toBe("true");
  expect(workspace.getAttribute("data-map-timeline")).toBe("true");
});

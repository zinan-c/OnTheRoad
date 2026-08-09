// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ItineraryPanel } from "../../src/features/itinerary/itinerary-panel";

afterEach(() => vi.unstubAllGlobals());

test("E2E-009 exposes all six Item types and creates through the public API", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    [{ id: "day-1", dayNumber: 1, version: 1 }],
    [],
    {
      id: "item-1", tripDayId: "day-1", itemType: "other", target: "自由安排",
      description: null, timeKind: "unscheduled", startTime: null, endTime: null,
      endDayOffset: 0, timePeriod: null, durationMinutes: null, locationId: null,
      startLocationId: null, endLocationId: null, transportModeCode: null,
      bookingInfo: null, contactInfo: null, remark: null, dining: null,
      accommodation: null, version: 1,
    },
    [{
      id: "item-1", tripDayId: "day-1", itemType: "other", target: "自由安排",
      description: null, timeKind: "unscheduled", startTime: null, endTime: null,
      endDayOffset: 0, timePeriod: null, durationMinutes: null, locationId: null,
      startLocationId: null, endLocationId: null, transportModeCode: null,
      bookingInfo: null, contactInfo: null, remark: null, dining: null,
      accommodation: null, version: 1,
    }],
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(JSON.stringify(responses.shift()), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  for (const kind of ["activity", "attraction", "dining", "accommodation", "transport", "other"]) {
    expect(await screen.findByRole("button", { name: `新增 ${kind}` })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "新增 other" }));
  fireEvent.change(screen.getByLabelText("事项名称"), { target: { value: "自由安排" } });
  fireEvent.click(screen.getByRole("button", { name: "保存事项" }));

  await screen.findByText("已保存");
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/trips/trip-1/days/day-1/itinerary-items")
    && init?.method === "POST"
    && JSON.parse(String(init.body)).itemType === "other",
  )).toBe(true));
});

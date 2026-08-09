// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ItineraryPanel } from "../../src/features/itinerary/itinerary-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

test("E2E-010 debounces edits, persists the final value and warns while dirty", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const item = {
    id: "item-1", tripDayId: "day-1", itemType: "attraction" as const,
    target: "外滩", description: "旧描述", timeKind: "period" as const,
    startTime: null, endTime: null, endDayOffset: 0, timePeriod: "morning",
    durationMinutes: 60, locationId: null, startLocationId: null,
    endLocationId: null, transportModeCode: null, bookingInfo: null,
    contactInfo: null, remark: null, dining: null, accommodation: null, version: 1,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const body = init?.method === "PATCH"
      ? { ...item, description: JSON.parse(String(init.body)).description, version: 2 }
      : url.endsWith("/days") ? [{ id: "day-1", dayNumber: 1, version: 1 }] : [item];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  fireEvent.click((await screen.findByText("外滩")).closest("button")!);
  const description = screen.getByLabelText("描述");
  fireEvent.change(description, { target: { value: "第一次" } });
  fireEvent.change(description, { target: { value: "第二次" } });
  fireEvent.change(description, { target: { value: "最终描述" } });
  expect(screen.getByText("有未保存更改")).toBeTruthy();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);

  await screen.findByText("已保存", {}, { timeout: 1_500 });
  const patches = calls.filter(({ init }) => init?.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(JSON.parse(String(patches[0]!.init!.body)).description).toBe("最终描述");
});

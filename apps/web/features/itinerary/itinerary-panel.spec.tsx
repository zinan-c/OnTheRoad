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

test("E2E-011 exposes copy and confirmed soft-delete operations", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const item = {
    id: "item-1", tripDayId: "day-1", itemType: "dining" as const,
    target: "早餐", description: null, timeKind: "clock" as const,
    startTime: "08:00", endTime: null, endDayOffset: 0, timePeriod: null,
    durationMinutes: 30, locationId: null, startLocationId: null,
    endLocationId: null, transportModeCode: null, bookingInfo: null,
    contactInfo: null, remark: null, dining: { name: "早餐店", mealType: "breakfast" },
    accommodation: null, version: 1,
  };
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const body = url.endsWith("/days")
      ? [{ id: "day-1", dayNumber: 1, version: 1 }, { id: "day-2", dayNumber: 2, version: 1 }]
      : init?.method === "POST" ? { ...item, id: "item-2", tripDayId: "day-2" } : [item];
    return new Response(JSON.stringify(init?.method === "DELETE"
      ? { ...item, deletedAt: "2026-08-09T00:00:00.000Z" }
      : body), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  fireEvent.change(await screen.findByLabelText("复制 早餐 到"), { target: { value: "day-2" } });
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/itinerary-items/item-1/copy")
    && init?.method === "POST"
    && JSON.parse(String(init.body)).targetTripDayId === "day-2",
  )).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "删除 早餐" }));
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/itinerary-items/item-1")
    && init?.method === "DELETE"
    && new Headers(init.headers).get("if-match") === "1",
  )).toBe(true));
  await waitFor(() => expect(screen.queryByText("早餐")).toBeNull());
});

test("E2E-012 persists the complete Day order with its current version", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const makeItem = (id: string, target: string) => ({
    id, tripDayId: "day-1", itemType: "activity" as const, target,
    description: null, timeKind: "unscheduled" as const, startTime: null,
    endTime: null, endDayOffset: 0, timePeriod: null, durationMinutes: null,
    locationId: null, startLocationId: null, endLocationId: null,
    transportModeCode: null, bookingInfo: null, contactInfo: null, remark: null,
    dining: null, accommodation: null, version: 1,
  });
  const items = [makeItem("a", "外滩"), makeItem("b", "午餐"), makeItem("c", "码头")];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const body = url.endsWith("/days")
      ? [{ id: "day-1", dayNumber: 1, version: 7 }]
      : url.endsWith("/reorder")
        ? { tripDayId: "day-1", version: 8, orderedIds: ["b", "a", "c"] }
        : items;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "下移 外滩" }));

  await waitFor(() => expect(calls.some(({ url, init }) => {
    if (!url.endsWith("/trips/trip-1/days/day-1/itinerary-items/reorder") || init?.method !== "POST") return false;
    return JSON.stringify(JSON.parse(String(init.body))) === JSON.stringify({
      baseVersion: 7,
      orderedIds: ["b", "a", "c"],
    });
  })).toBe(true));
  await screen.findByText("已保存");
  expect(screen.getByRole("button", { name: "拖动 午餐" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "上移 外滩" })).toBeTruthy();
});

test("E2E-013 makes a newly persisted custom Mode immediately selectable", async () => {
  let created = false;
  const custom = {
    id: "mode-1", tripId: "trip-1", ownerId: "owner-1",
    code: "CABLE_SHUTTLE_CUSTOM", label: "缆车接驳", icon: "cable-car",
    color: "#123456", lineStyle: "dotted", isSystem: false, enabled: true,
    referenced: false, version: 1,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/transport-modes") && init?.method === "POST") created = true;
    const body = url.endsWith("/days")
      ? [{ id: "day-1", dayNumber: 1, version: 1 }]
      : url.endsWith("/transport-modes")
        ? init?.method === "POST" ? custom : created ? [custom] : []
        : [];
    return new Response(JSON.stringify(body), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  await screen.findByRole("button", { name: "新增 transport" });
  fireEvent.click(screen.getByRole("button", { name: "交通方式设置" }));
  fireEvent.change(await screen.findByLabelText("交通方式 Code"), { target: { value: custom.code } });
  fireEvent.change(screen.getByLabelText("交通方式名称"), { target: { value: custom.label } });
  fireEvent.change(screen.getByLabelText("交通方式图标"), { target: { value: custom.icon } });
  fireEvent.change(screen.getByLabelText("交通方式颜色"), { target: { value: custom.color } });
  fireEvent.change(screen.getByLabelText("交通方式线型"), { target: { value: custom.lineStyle } });
  fireEvent.click(screen.getByRole("button", { name: "新增交通方式" }));
  await screen.findByText(custom.code);
  fireEvent.click(screen.getByRole("button", { name: "新增 transport" }));
  expect(await screen.findByRole("option", { name: custom.label })).toBeTruthy();
});

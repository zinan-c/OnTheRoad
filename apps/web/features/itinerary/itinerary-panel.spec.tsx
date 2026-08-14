// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ItineraryPanel } from "../../src/features/itinerary/itinerary-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("E2E-009 creates every Item type through one category-driven form", async () => {
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
  const addButton = await screen.findByRole("button", { name: "Add item" });
  expect(screen.getAllByRole("button", { name: "Add item" })).toHaveLength(1);
  fireEvent.click(addButton);
  const itemType = screen.getByLabelText("Item type") as HTMLSelectElement;
  expect([...itemType.options].map(({ value }) => value)).toEqual([
    "activity", "attraction", "dining", "accommodation", "transport", "other",
  ]);
  fireEvent.change(itemType, { target: { value: "other" } });
  fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "自由安排" } });
  fireEvent.click(screen.getByRole("button", { name: "Save item" }));

  await screen.findByText("Saved");
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/trips/trip-1/days/day-1/itinerary-items")
    && init?.method === "POST"
    && JSON.parse(String(init.body)).itemType === "other",
  )).toBe(true));
});

test("E2E-009 persists and reloads the complete Hotel schedule and accommodation details", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let saved: Record<string, unknown> | null = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.endsWith("/days")) {
      return Response.json([{ id: "day-1", dayNumber: 1, version: 1 }]);
    }
    if (init?.method === "POST") {
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      const accommodation = payload.accommodation as Record<string, unknown>;
      saved = {
        id: "hotel-1", tripDayId: "day-1", ...payload,
        itemType: "hotel", target: "夜宿酒店", locationId: null,
        checkInAt: null, startLocationId: null, endLocationId: null,
        bookingInfo: null, contactInfo: null, remark: null, dining: null,
        accommodation: {
          ...accommodation,
          checkInAt: `${String(accommodation.checkInDate)}T00:00:00.000Z`,
          checkOutAt: `${String(accommodation.checkOutDate)}T00:00:00.000Z`,
        },
        version: 1,
      };
      return Response.json(saved, { status: 201 });
    }
    return Response.json(saved ? [saved] : []);
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
  fireEvent.change(screen.getByLabelText("Item type"), { target: { value: "accommodation" } });
  fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "夜宿酒店" } });
  fireEvent.change(screen.getByLabelText("Time type"), { target: { value: "range" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "22:30" } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "07:30" } });
  fireEvent.click(screen.getByLabelText("Crosses midnight"));
  fireEvent.change(screen.getByLabelText("Property name"), { target: { value: "山间酒店" } });
  fireEvent.change(screen.getByLabelText("Details"), { target: { value: "大床房" } });
  fireEvent.change(screen.getByLabelText("Check-in date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Check-out date"), { target: { value: "2026-10-02" } });
  fireEvent.click(screen.getByRole("button", { name: "Save item" }));

  await screen.findByText("Saved");
  const create = calls.find(({ url, init }) => url.endsWith("/itinerary-items") && init?.method === "POST");
  expect(JSON.parse(String(create?.init?.body))).toMatchObject({
    itemType: "hotel", timeKind: "range", startTime: "22:30", endTime: "07:30", endDayOffset: 1,
    accommodation: { name: "山间酒店", details: "大床房", checkInDate: "2026-10-01", checkOutDate: "2026-10-02" },
  });
  expect(screen.getByLabelText("Details")).toHaveProperty("value", "大床房");
});

test("E2E-010 explicitly saves the final edit and warns while dirty", async () => {
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
    if (url.endsWith("/days")) return Response.json([{ id: "day-1", dayNumber: 1, version: 1 }]);
    if (url.endsWith("/item-1/expenses")) return Response.json([]);
    if (url.endsWith("/expenses") && init?.method === "POST") {
      return Response.json({
        id: "expense-1", itineraryItemId: "item-1", originalAmount: "88.0000",
        currency: "CNY", categoryCode: "OTHER", remark: null, version: 1,
      }, { status: 201 });
    }
    const body = init?.method === "PATCH"
      ? { ...item, ...JSON.parse(String(init.body)), version: 2 }
      : [item];
    return Response.json(body);
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  fireEvent.click((await screen.findByText("外滩")).closest("button")!);
  await waitFor(() => expect((screen.getByLabelText("Amount") as HTMLInputElement).disabled).toBe(false));
  const description = screen.getByLabelText("Description");
  fireEvent.change(description, { target: { value: "第一次" } });
  fireEvent.change(description, { target: { value: "第二次" } });
  fireEvent.change(description, { target: { value: "最终描述" } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "88" } });
  fireEvent.change(screen.getByLabelText("Expense remark"), { target: { value: "Sunrise tickets" } });
  const notes = screen.getByLabelText("Notes") as HTMLTextAreaElement;
  expect(notes.rows).toBe(6);
  expect(notes.closest("label")?.classList.contains("itemNotesField")).toBe(true);
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);

  expect(calls.filter(({ init }) => init?.method === "PATCH")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save item" }));
  await screen.findByText("Saved", {}, { timeout: 1_500 });
  const patches = calls.filter(({ init }) => init?.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(JSON.parse(String(patches[0]!.init!.body)).description).toBe("最终描述");
  const expense = calls.find(({ url, init }) => url.endsWith("/expenses") && init?.method === "POST");
  expect(JSON.parse(String(expense?.init?.body))).toEqual({
    itineraryItemId: "item-1", amount: "88", currency: "CNY", remark: "Sunrise tickets",
  });
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
  fireEvent.change(await screen.findByLabelText("Copy 早餐 to"), { target: { value: "day-2" } });
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/itinerary-items/item-1/copy")
    && init?.method === "POST"
    && JSON.parse(String(init.body)).targetTripDayId === "day-2",
  )).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Delete 早餐" }));
  expect(screen.getByTestId("delete-item-dialog")).toBeTruthy();
  fireEvent.click(screen.getByTestId("cancel-delete-item"));
  expect(screen.queryByTestId("delete-item-dialog")).toBeNull();
  expect(calls.some(({ init }) => init?.method === "DELETE")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Delete 早餐" }));
  fireEvent.click(screen.getByTestId("confirm-delete-item"));
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/itinerary-items/item-1")
    && init?.method === "DELETE"
    && new Headers(init.headers).get("if-match") === "1",
  )).toBe(true));
  await waitFor(() => expect(screen.queryByText("早餐")).toBeNull());
});

test("workspace edit keeps drag handles, hides arrow controls, and confirms item delete", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const items = [
    {
      id: "item-1", tripDayId: "day-1", itemType: "attraction" as const,
      target: "外滩", description: null, timeKind: "unscheduled" as const,
      startTime: null, endTime: null, endDayOffset: 0, timePeriod: null,
      durationMinutes: null, locationId: null, startLocationId: null,
      endLocationId: null, transportModeCode: null, bookingInfo: null,
      contactInfo: null, remark: null, dining: null, accommodation: null, version: 1,
    },
    {
      id: "item-2", tripDayId: "day-1", itemType: "dining" as const,
      target: "午餐", description: null, timeKind: "unscheduled" as const,
      startTime: null, endTime: null, endDayOffset: 0, timePeriod: null,
      durationMinutes: null, locationId: null, startLocationId: null,
      endLocationId: null, transportModeCode: null, bookingInfo: null,
      contactInfo: null, remark: null, dining: { name: "午餐", mealType: "lunch" }, accommodation: null, version: 1,
    },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.endsWith("/days")) return Response.json([{ id: "day-1", dayNumber: 1, date: "2026-08-14", version: 4 }]);
    if (url.endsWith("/days/day-1/itinerary-items")) return Response.json(items);
    if (url.endsWith("/itinerary-items/item-1/expenses") || url.endsWith("/itinerary-items/item-2/expenses")) return Response.json([]);
    if (url.endsWith("/itinerary-items/item-1") && init?.method === "DELETE") return Response.json({ ...items[0], deletedAt: "2026-08-14T00:00:00.000Z", version: 2 });
    return Response.json([]);
  }));

  render(<ItineraryPanel tripId="trip-1" selectedDayId="day-1" variant="workspace" />);
  await screen.findByText("外滩");
  fireEvent.click(screen.getByTestId("edit-itinerary"));

  const firstCard = screen.getAllByTestId("itinerary-item").find((card) => card.textContent?.includes("外滩"));
  expect(firstCard).toBeTruthy();
  expect(screen.getByRole("button", { name: "Drag 外滩" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Move 外滩 up" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Move 外滩 down" })).toBeNull();
  expect(within(firstCard!).getByRole("button", { name: "Item edit 外滩" })).toBeTruthy();
  expect(within(firstCard!).getByRole("button", { name: "Item delete 外滩" })).toBeTruthy();
  expect(within(firstCard!).getAllByRole("button").map(({ textContent }) => textContent)).toEqual(["Item edit", "Item delete"]);

  fireEvent.click(within(firstCard!).getByRole("button", { name: "Item delete 外滩" }));
  expect(screen.getByRole("dialog", { name: "Delete item?" })).toBeTruthy();
  fireEvent.click(screen.getByTestId("cancel-delete-item"));
  expect(screen.queryByTestId("delete-item-dialog")).toBeNull();
  expect(calls.some(({ init }) => init?.method === "DELETE")).toBe(false);

  const cardAfterCancel = screen.getAllByTestId("itinerary-item").find((card) => card.textContent?.includes("外滩"));
  expect(cardAfterCancel).toBeTruthy();
  fireEvent.click(within(cardAfterCancel!).getByRole("button", { name: "Item delete 外滩" }));
  fireEvent.click(screen.getByTestId("confirm-delete-item"));
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/itinerary-items/item-1")
    && init?.method === "DELETE"
    && new Headers(init.headers).get("if-match") === "1",
  )).toBe(true));
  await waitFor(() => expect(screen.queryByText("外滩")).toBeNull());
});

test("workspace global scope hides all-day itinerary cards until a day is selected", async () => {
  const calls: string[] = [];
  const item = {
    id: "item-1", tripDayId: "day-1", itemType: "attraction" as const,
    target: "外滩", description: null, timeKind: "unscheduled" as const,
    startTime: null, endTime: null, endDayOffset: 0, timePeriod: null,
    durationMinutes: null, locationId: null, startLocationId: null,
    endLocationId: null, transportModeCode: null, bookingInfo: null,
    contactInfo: null, remark: null, dining: null, accommodation: null, version: 1,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith("/days")) return Response.json([
      { id: "day-1", dayNumber: 1, date: "2026-08-14", version: 1 },
      { id: "day-2", dayNumber: 2, date: "2026-08-15", version: 1 },
    ]);
    if (url.endsWith("/days/day-1/itinerary-items")) return Response.json([item]);
    if (url.endsWith("/itinerary-items/item-1/expenses")) return Response.json([]);
    return Response.json([]);
  }));

  const { rerender } = render(<ItineraryPanel tripId="trip-1" selectedDayId={null} variant="workspace" />);
  await screen.findByTestId("all-days-itinerary-hint");
  expect(screen.queryByTestId("itinerary-item")).toBeNull();
  expect(calls.some((url) => url.endsWith("/days/day-1/itinerary-items"))).toBe(false);

  rerender(<ItineraryPanel tripId="trip-1" selectedDayId="day-1" variant="workspace" />);
  await screen.findByText("外滩");
  expect(calls.some((url) => url.endsWith("/days/day-1/itinerary-items"))).toBe(true);
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
  fireEvent.click(await screen.findByRole("button", { name: "Move 外滩 down" }));

  await waitFor(() => expect(calls.some(({ url, init }) => {
    if (!url.endsWith("/trips/trip-1/days/day-1/itinerary-items/reorder") || init?.method !== "POST") return false;
    return JSON.stringify(JSON.parse(String(init.body))) === JSON.stringify({
      baseVersion: 7,
      orderedIds: ["b", "a", "c"],
    });
  })).toBe(true));
  await screen.findByText("Saved");
  expect(screen.getByText("外滩 moved to position 2").getAttribute("aria-live")).toBe("polite");
  expect(screen.getByRole("button", { name: "Drag 午餐" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Move 外滩 up" })).toBeTruthy();
});

test("E2E-013 exposes built-in Modes without a settings surface", async () => {
  const builtIn = {
    id: "system:CABLE_CAR", tripId: null, ownerId: null,
    code: "CABLE_CAR", label: "Cable car", icon: "cable-car",
    color: "#123456", lineStyle: "dotted", isSystem: true, enabled: true,
    referenced: false, version: 1,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = url.endsWith("/days")
      ? [{ id: "day-1", dayNumber: 1, version: 1 }]
      : url.endsWith("/transport-modes")
        ? [builtIn]
        : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));

  render(<ItineraryPanel tripId="trip-1" />);
  expect(screen.queryByRole("button", { name: "Transport modes" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
  fireEvent.change(screen.getByLabelText("Item type"), { target: { value: "transport" } });
  expect(await screen.findByRole("option", { name: builtIn.code })).toBeTruthy();
});

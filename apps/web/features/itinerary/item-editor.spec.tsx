import { describe, expect, test } from "vitest";

import {
  ItemEditor,
  editorGroups,
  workspaceLayout,
} from "../../src/features/itinerary/item-editor.js";

describe("TC-B06-01 editor field groups", () => {
  test("desktop editor validates all core groups and emits the frozen API payload", () => {
    const editor = new ItemEditor({
      tripId: "trip-1",
      dayId: "day-1",
      kind: "dining",
    });
    editor.update({
      target: "南翔馒头店",
      description: "午餐",
      startTime: "12:00",
      endTime: "13:15",
      durationMinutes: 75,
      locationText: "豫园路 85 号",
      locationId: "location-1",
      transportModeId: "walk",
      transportOrigin: "外滩",
      transportDestination: "豫园",
      diningName: "南翔馒头店",
      mealType: "lunch",
      reservationReference: "CN-2026-10",
      contactName: "前台",
      contactPhone: "+86 21 0000 0000",
      costAmount: "168.50",
      costCurrency: "CNY",
      costCategory: "food",
      notes: "靠窗座位",
    });

    expect(editorGroups).toEqual([
      "time",
      "location",
      "transport",
      "hospitality",
      "cost",
      "notes",
    ]);
    expect(editor.payload()).toEqual({
      contract: "b06-frozen-v1",
      tripId: "trip-1",
      tripDayId: "day-1",
      kind: "dining",
      target: "南翔馒头店",
      description: "午餐",
      schedule: {
        startTime: "12:00",
        endTime: "13:15",
        crossesMidnight: false,
        durationMinutes: 75,
      },
      location: { text: "豫园路 85 号", locationId: "location-1" },
      transport: {
        modeId: "walk",
        origin: "外滩",
        destination: "豫园",
      },
      hospitality: {
        dining: { name: "南翔馒头店", mealType: "lunch" },
        reservationReference: "CN-2026-10",
        contactName: "前台",
        contactPhone: "+86 21 0000 0000",
      },
      cost: { amount: "168.50", currency: "CNY", category: "food" },
      notes: "靠窗座位",
    });
    expect(workspaceLayout(1_440)).toBe("desktop");
  });

  test("mobile editor keeps the core path and supports accommodation/overnight fields", () => {
    const editor = new ItemEditor({
      tripId: "trip-1",
      dayId: "day-2",
      kind: "accommodation",
    });
    editor.update({
      target: "山间酒店",
      startTime: "22:30",
      endTime: "07:30",
      crossesMidnight: true,
      hotelName: "山间酒店",
      accommodationType: "hotel",
      checkInDate: "2026-10-02",
      checkOutDate: "2026-10-03",
      costAmount: "688",
      costCurrency: "CNY",
      notes: "手机端完成",
    });

    expect(editor.validate()).toEqual({});
    expect(editor.payload()).toMatchObject({
      kind: "accommodation",
      schedule: { crossesMidnight: true },
      hospitality: {
        accommodation: {
          name: "山间酒店",
          type: "hotel",
          checkInDate: "2026-10-02",
          checkOutDate: "2026-10-03",
        },
      },
    });
    expect(workspaceLayout(390)).toBe("mobile");
    expect(workspaceLayout(900)).toBe("tablet");
  });

  test("rejects invalid time, transport, money and oversized text before submission", () => {
    const editor = new ItemEditor({
      tripId: "trip-1",
      dayId: "day-1",
      kind: "transport",
    });
    editor.update({
      target: "机场接驳",
      startTime: "25:00",
      endTime: "08:00",
      transportModeId: "",
      costAmount: "12.345",
      costCurrency: "rmb",
      notes: "长".repeat(20_001),
    });
    expect(editor.validate()).toMatchObject({
      startTime: expect.any(String),
      transportModeId: expect.any(String),
      costAmount: expect.any(String),
      costCurrency: expect.any(String),
      notes: expect.any(String),
    });
    expect(() => editor.payload()).toThrow(/validation/i);
  });
});

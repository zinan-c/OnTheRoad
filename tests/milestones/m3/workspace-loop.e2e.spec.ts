import { describe, expect, test } from "vitest";

import {
  generateRouteWindow,
} from "../../../packages/domain/src/routing/index.mjs";
import {
  AttachmentGalleryService,
  InMemoryAttachmentGalleryRepository,
} from "../../../apps/api/src/modules/attachments/gallery.mjs";
import { summarizeExpenses } from "../../../apps/api/src/modules/expenses/summary.mjs";
import { routeLayerModel } from "../../../apps/web/src/features/map/route-layer-failure.js";
import { MapTimelineSelectionStore } from "../../../apps/web/src/features/map/store.js";

const location = (id: string, longitude: number, latitude: number) => ({
  id,
  version: 1,
  geocodingStatus: "resolved",
  point: { longitude, latitude, crs: "WGS84" as const },
});

describe("TC-M3-INT-01 Route/gallery/cost workspace", () => {
  test("keeps route, selection, gallery and cost facts consistent after workspace changes", () => {
    const day1 = "day-1";
    const day2 = "day-2";
    const a = {
      id: "item-a",
      tripDayId: day1,
      dayNumber: 1,
      sortOrder: 0,
      version: 1,
      itemType: "activity",
      location: location("loc-a", 121.47, 31.23),
    };
    const b = {
      id: "item-b",
      tripDayId: day1,
      dayNumber: 1,
      sortOrder: 1,
      version: 1,
      itemType: "activity",
      location: location("loc-b", 121.50, 31.24),
      transportModeCode: "WALK",
    };
    const c = {
      id: "item-c",
      tripDayId: day2,
      dayNumber: 2,
      sortOrder: 0,
      version: 1,
      itemType: "activity",
      location: location("loc-c", 122.00, 30.00),
      transportModeCode: "FERRY",
    };

    const route = generateRouteWindow({
      items: [c, b, a],
      routeGenerations: { [day1]: 2, [day2]: 1 },
    });
    expect(route).toHaveLength(2);
    expect(route.map(({ toItineraryItemId }) => toItineraryItemId)).toEqual(["item-b", "item-c"]);
    expect(route[1]).toMatchObject({ arrivalDayId: day2, transportModeCode: "FERRY" });

    const visual = routeLayerModel({
      modeCode: route[1]?.transportModeCode,
      quality: "approximate",
      status: "resolved",
      geometry: [[121.5, 31.24], [122, 30]],
    });
    expect(visual).toMatchObject({ visible: true, style: { label: "轮渡" } });

    const selection = new MapTimelineSelectionStore();
    selection.setMapReady(true);
    selection.selectFromTimeline("item-b", day1);
    expect(selection.consumeFocus()).toEqual({ type: "focus-marker", id: "item-b", pan: true });
    selection.selectFromMarker("item-b", day1);
    expect(selection.consumeFocus()).toMatchObject({ type: "focus-timeline", id: "item-b" });

    const gallery = new AttachmentGalleryService(new InMemoryAttachmentGalleryRepository([
      { id: "photo-a", ownerId: "owner", itemId: "item-b", status: "ready", sortOrder: 0, version: 1, caption: "抵达", isCover: true },
      { id: "photo-b", ownerId: "owner", itemId: "item-b", status: "ready", sortOrder: 1, version: 1, caption: "街景", isCover: false },
    ]));
    expect(gallery.update("owner", "photo-b", 1, { caption: "夜景" })).toMatchObject({ caption: "夜景", version: 2 });
    expect(gallery.update("owner", "photo-a", 1, { caption: "抵达" })).toMatchObject({ version: 2 });
    expect(gallery.reorder("owner", "item-b", 2, ["photo-b", "photo-a"]).map(({ id }) => id)).toEqual(["photo-b", "photo-a"]);

    const costs = summarizeExpenses([
      { tripDayId: day1, destinationId: "destination-1", categoryCode: "DINING", transportModeCode: "WALK", currency: "CNY", originalAmount: "80.0000", settledAmount: "80.0000", settlementCurrency: "CNY" },
      { tripDayId: day2, destinationId: "destination-2", categoryCode: "TRANSPORT", transportModeCode: "FERRY", currency: "USD", originalAmount: "10.0000", settledAmount: null, settlementCurrency: "CNY" },
    ], "CNY");
    expect(costs.breakdowns.day[day1]?.settledTotal).toBe("80.0000");
    expect(costs.breakdowns.mode.FERRY?.unconverted).toBe("1");
    expect(costs.settledActualTotal).toBe("80.0000");
  });
});

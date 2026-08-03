import { describe, expect, test } from "vitest";

import { selectionFromMarker, selectionFromUrl, selectionUrl } from "../../src/features/map/interaction.js";
import { MapTimelineSelectionStore } from "../../src/features/map/store.js";

describe("TC-C09-01 shared map/timeline selection", () => {
  test("uses one selection and emits the opposite-view focus command", () => {
    const store = new MapTimelineSelectionStore();
    store.setMapReady(true);
    store.selectFromTimeline("item-1", "day-1");
    expect(store.state.selected).toMatchObject({ kind: "item", itemId: "item-1" });
    expect(store.consumeFocus()).toEqual({ type: "focus-marker", id: "item-1", pan: true });

    store.setMountedTimelineItemIds(["item-1"]);
    store.selectFromMarker("item-1", "day-1");
    expect(store.consumeFocus()).toEqual({ type: "focus-timeline", id: "item-1", preventScroll: true });
  });

  test("round-trips URL state and maps marker identity to an item", () => {
    const marker = selectionFromMarker({ id: "marker-1", itemId: "item-1", dayId: "day-1" });
    const url = selectionUrl("trip-1", marker);
    expect(selectionFromUrl(url)).toEqual(marker);
  });
});

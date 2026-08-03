import { describe, expect, test } from "vitest";

import { MapTimelineSelectionStore } from "../../src/features/map/store.js";

describe("TC-C09-02 missing/filtered/not-ready selection", () => {
  test("clears stale selections and never requests an unavailable pan", () => {
    const store = new MapTimelineSelectionStore();
    store.selectFromTimeline("missing-item");
    expect(store.consumeFocus()).toEqual({
      type: "focus-marker",
      id: "missing-item",
      pan: false,
    });

    store.setVisibleItemIds(["visible-item"]);
    expect(store.state.selected).toBeNull();
    expect(store.consumeFocus()).toEqual({
      type: "clear-selection",
      reason: "filtered",
    });

    store.selectFromMarker("visible-item");
    expect(store.consumeFocus()).toEqual({
      type: "focus-timeline",
      id: "visible-item",
      preventScroll: false,
    });
    store.setMapReady(false);
    expect(store.state.selected).toBeNull();
    expect(store.consumeFocus()).toEqual({
      type: "clear-selection",
      reason: "unavailable",
    });
  });

  test("keeps only the last selection during rapid interaction", () => {
    const store = new MapTimelineSelectionStore();
    store.setMapReady(true);
    store.selectFromTimeline("item-1");
    store.selectFromMarker("item-2");
    store.selectSegment("segment-3");
    expect(store.state.selected).toEqual({
      kind: "segment",
      id: "segment-3",
    });
    expect(store.consumeFocus()).toEqual({
      type: "focus-segment",
      id: "segment-3",
    });
  });
});

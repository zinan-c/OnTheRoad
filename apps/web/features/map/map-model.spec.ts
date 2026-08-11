import { describe, expect, test } from "vitest";

import {
  buildMapModel,
  filterMapItems,
  fitPlan,
} from "../../src/features/map/map-model.js";

const items = [
  point("item-1", 1, "day-1", "#155EEF", 121.4906, 31.2413, "外滩", "dest-sh"),
  point("item-2", 1, "day-1", "#155EEF", 121.501, 31.235, "豫园", "dest-sh"),
  point("item-3", 2, "day-2", "#7A5AF8", 122.1069, 30.0198, "舟山码头", "dest-zs"),
  point("invalid", 2, "day-2", "#7A5AF8", 181, 30, "非法点", "dest-zs"),
  { id: "unresolved", dayNumber: 2, dayId: "day-2", dayColor: "#7A5AF8", label: "待确认" },
];

describe("TC-C05-01 marker and fit selector", () => {
  test("builds valid WGS84 GeoJSON with Day color rings and per-Day sequence labels", () => {
    const model = buildMapModel(items);
    expect(model.geojson).toEqual({
      type: "FeatureCollection",
      features: [
        expect.objectContaining({
          id: "item-1",
          geometry: { type: "Point", coordinates: [121.4906, 31.2413] },
          properties: expect.objectContaining({
            dayNumber: 1,
            daySequence: 1,
            markerLabel: "Day 1 · 1",
            dayColor: "#155EEF",
            label: "外滩",
          }),
        }),
        expect.objectContaining({
          id: "item-2",
          properties: expect.objectContaining({
            dayNumber: 1,
            daySequence: 2,
            markerLabel: "Day 1 · 2",
          }),
        }),
        expect.objectContaining({
          id: "item-3",
          properties: expect.objectContaining({
            dayNumber: 2,
            daySequence: 1,
            markerLabel: "Day 2 · 1",
            dayColor: "#7A5AF8",
          }),
        }),
      ],
    });
    expect(model.invalidItemIds).toEqual(["invalid"]);
    expect(model.unresolvedItemIds).toEqual(["unresolved"]);
    expect(model.legend).toEqual([
      { dayNumber: 1, color: "#155EEF", label: "Day 1" },
      { dayNumber: 2, color: "#7A5AF8", label: "Day 2" },
    ]);
  });

  test("handles empty, single, same and multiple points without a fake default", () => {
    expect(fitPlan([])).toEqual({
      kind: "empty",
      bounds: null,
      message: "No valid coordinates. Confirm a location first.",
    });
    expect(fitPlan([[121.5, 31.2]])).toMatchObject({
      kind: "single",
      bounds: [[121.45, 31.15], [121.55, 31.25]],
    });
    expect(fitPlan([[121.5, 31.2], [121.5, 31.2]])).toMatchObject({
      kind: "same",
      bounds: [[121.45, 31.15], [121.55, 31.25]],
    });
    expect(fitPlan([[121.47, 31.23], [122.1, 30.02]])).toEqual({
      kind: "bounds",
      bounds: [[121.47, 30.02], [122.1, 31.23]],
      message: "Fitted all valid coordinates",
    });
  });

  test("filters all/day/destination without mutating source order", () => {
    expect(filterMapItems(items, { kind: "all" })).toHaveLength(5);
    expect(filterMapItems(items, { kind: "day", dayId: "day-2" })
      .map(({ id }) => id)).toEqual(["item-3", "invalid", "unresolved"]);
    expect(filterMapItems(items, {
      kind: "destination",
      destinationId: "dest-sh",
    }).map(({ id }) => id)).toEqual(["item-1", "item-2"]);
    expect(items[0]?.id).toBe("item-1");
  });

  test("fans out markers that share a dense global-map coordinate", () => {
    const model = buildMapModel([
      point("same-a", 1, "day-1", "#155EEF", 123.761, 9.5506, "阿罗娜", "dest-bohol"),
      point("same-b", 2, "day-2", "#7A5AF8", 123.761, 9.5506, "阿罗娜酒店", "dest-bohol"),
    ]);

    expect(model.markers.map(({ offset }) => offset)).toEqual([
      [0, -22],
      [0, 22],
    ]);
    expect(model.geojson.features.map(({ geometry }) => geometry.coordinates)).toEqual([
      [123.761, 9.5506],
      [123.761, 9.5506],
    ]);
  });
});

function point(
  id: string,
  dayNumber: number,
  dayId: string,
  dayColor: string,
  longitude: number,
  latitude: number,
  label: string,
  destinationId: string,
) {
  return {
    id,
    dayNumber,
    dayId,
    dayColor,
    label,
    destinationId,
    destinationLabel: destinationId === "dest-sh" ? "上海" : "舟山",
    point: { longitude, latitude, crs: "WGS84" as const },
  };
}

import { describe, expect, test, vi } from "vitest";

import {
  MapLibreWrapper,
  renderMapShell,
} from "../src/features/map/maplibre-wrapper.js";

const fixture = [
  point("item-1", 1, "day-1", "#155EEF", 121.4906, 31.2413, "外滩", "dest-sh"),
  point("item-2", 1, "day-1", "#155EEF", 121.501, 31.235, "豫园", "dest-sh"),
  point("item-3", 2, "day-2", "#7A5AF8", 122.1069, 30.0198, "舟山码头", "dest-zs"),
];

describe("TC-C05-03 marker, tooltip and map filtering", () => {
  test("updates GeoJSON and fit bounds for all/day/destination filters", async () => {
    const setGeoJson = vi.fn();
    const setMarkers = vi.fn();
    const fitBounds = vi.fn();
    const wrapper = new MapLibreWrapper({
      createMap: () => ({
        setGeoJson,
        setMarkers,
        fitBounds,
        resize: vi.fn(),
        destroy: vi.fn(),
      }),
    });

    await wrapper.mount({}, fixture);
    expect(wrapper.state.markerCount).toBe(3);
    expect(setMarkers.mock.calls.at(-1)?.[0].map((marker) => marker.markerLabel))
      .toEqual(["Day 1 · 1", "Day 1 · 2", "Day 2 · 1"]);

    wrapper.updateItems(fixture.filter(({ dayId }) => dayId === "day-2"));
    expect(wrapper.state.markerCount).toBe(1);
    expect(setGeoJson.mock.calls.at(-1)?.[0].features.map((feature) => feature.id))
      .toEqual(["item-3"]);

    wrapper.updateItems(fixture);
    wrapper.setFilter({ kind: "day", dayId: "day-2" });
    expect(setGeoJson.mock.calls.at(-1)?.[0].features.map((feature) => feature.id))
      .toEqual(["item-3"]);

    wrapper.setFilter({ kind: "destination", destinationId: "dest-sh" });
    expect(wrapper.state.markerCount).toBe(2);
    expect(fitBounds.mock.calls.at(-1)?.[0]).toEqual([
      [121.4906, 31.235],
      [121.501, 31.2413],
    ]);

    const html = renderMapShell(wrapper.state);
    expect(html).toContain("Day 1 · 1 · 外滩");
    expect(html).toContain("按 Day");
    expect(html).toContain("按目的地");
    expect(html).toContain("地图数据 © On The Road fixture");
  });

  test("does not create a map or jump to a fake center with no valid points", async () => {
    const createMap = vi.fn();
    const wrapper = new MapLibreWrapper({ createMap });
    await wrapper.mount({}, [{
      id: "pending",
      dayNumber: 1,
      dayId: "day-1",
      dayColor: "#155EEF",
      label: "待确认地点",
    }]);

    expect(createMap).not.toHaveBeenCalled();
    expect(wrapper.state).toMatchObject({
      mode: "empty",
      markerCount: 0,
      textEditingAvailable: true,
    });
    expect(renderMapShell(wrapper.state)).toContain("No valid coordinates. Confirm a location first.");
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

import { describe, expect, test, vi } from "vitest";

import {
  MapLibreWrapper,
  renderMapShell,
} from "../src/features/map/maplibre-wrapper.js";

const fixture = [
  {
    id: "item-1",
    dayNumber: 1,
    dayId: "day-1",
    dayColor: "#155EEF",
    label: "外滩",
    destinationId: "dest-sh",
    destinationLabel: "上海",
    point: { longitude: 121.4906, latitude: 31.2413, crs: "WGS84" as const },
  },
];

describe("TC-C05-02 tile/WebGL/fullscreen failure", () => {
  test("WebGL failure switches to neutral grid and never blocks text editing", async () => {
    const wrapper = new MapLibreWrapper({
      createMap() {
        throw new Error("WebGL context unavailable");
      },
    });
    await wrapper.mount({}, fixture);

    expect(wrapper.state).toMatchObject({
      mode: "neutral-grid",
      mapAvailable: false,
      textEditingAvailable: true,
      markerCount: 1,
    });
    const html = renderMapShell(wrapper.state);
    expect(html).toContain("WebGL 不可用");
    expect(html).toContain("中性网格");
    expect(html).toContain("Day 1 · 1");
    expect(html).toContain("地图不可用不影响文字行程编辑");
    expect(html).toContain("地图数据 © On The Road fixture");
  });

  test("tile failure preserves overlays; resize and Escape exit fullscreen", async () => {
    const resize = vi.fn();
    const fitBounds = vi.fn();
    let tileFailure!: (error: Error) => void;
    const wrapper = new MapLibreWrapper({
      createMap(options) {
        tileFailure = options.onTileError;
        return {
          setGeoJson: vi.fn(),
          setMarkers: vi.fn(),
          fitBounds,
          resize,
          destroy: vi.fn(),
        };
      },
    });
    await wrapper.mount({}, fixture);
    tileFailure(new Error("tile 503"));
    expect(wrapper.state).toMatchObject({
      mode: "neutral-grid",
      mapAvailable: true,
      markerCount: 1,
      degradationReason: "底图不可用",
    });
    expect(fitBounds).toHaveBeenCalled();

    wrapper.resize();
    expect(resize).toHaveBeenCalledOnce();
    wrapper.enterFullscreen();
    expect(wrapper.state.fullscreen).toBe(true);
    expect(wrapper.handleKey("Escape")).toBe(true);
    expect(wrapper.state.fullscreen).toBe(false);
    expect(renderMapShell(wrapper.state)).toContain("进入全屏");
    expect(renderMapShell(wrapper.state)).toContain("图例");
  });
});

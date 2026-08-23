// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import { wgs84ToGcj02 } from "@on-the-road/providers/coordinates";
import { createAMapRuntime, type AMapNamespace } from "../../src/features/map/amap-runtime";

class FakeMap {
  static current: FakeMap;
  readonly handlers = new Map<string, (event: Record<string, unknown>) => void>();
  readonly layers: readonly unknown[][] = [];
  bounds: unknown;
  constructor(public readonly container: unknown) { FakeMap.current = this; }
  on(event: string, handler: (payload: Record<string, unknown>) => void) { this.handlers.set(event, handler); }
  setLayers(layers: readonly unknown[]) { (this.layers as unknown as unknown[][]).push(layers); }
  setBounds(bounds: unknown) { this.bounds = bounds; }
  resize() {}
  destroy() {}
}

class FakeMarker {
  static all: FakeMarker[] = [];
  readonly handlers = new Map<string, (event: Record<string, unknown>) => void>();
  readonly content: HTMLElement;
  readonly position: readonly [number, number];
  constructor(public readonly options: Record<string, unknown>) {
    this.content = options.content as HTMLElement;
    this.position = options.position as readonly [number, number];
    FakeMarker.all.push(this);
  }
  on(event: string, handler: (payload: Record<string, unknown>) => void) { this.handlers.set(event, handler); }
  getPosition() { return { lng: this.position[0], lat: this.position[1] }; }
  getContent() { return this.content; }
  setMap() {}
  emit(event: string, payload: Record<string, unknown>) { this.handlers.get(event)?.(payload); }
}

class FakePolyline {
  constructor(public readonly options: Record<string, unknown>) {}
  setMap() {}
}

class FakeLayer { constructor(public readonly options: Record<string, unknown>) {} }
class FakeLngLat { constructor(public readonly lng: number, public readonly lat: number) {} }
class FakeBounds { constructor(public readonly southwest: unknown, public readonly northeast: unknown) {} }

const TileLayer = Object.assign(FakeLayer, { Satellite: FakeLayer, RoadNet: FakeLayer });
const amap = {
  Map: FakeMap,
  Marker: FakeMarker,
  Polyline: FakePolyline,
  TileLayer,
  LngLat: FakeLngLat,
  Bounds: FakeBounds,
} as unknown as AMapNamespace;

const config = {
  provider: "amap" as const,
  engine: "amap-js" as const,
  jsApiKey: "public-js-key",
  securityJsCode: "public-security-code",
  defaultLayer: "amap-street" as const,
  attribution: "© 高德地图",
};

describe("AMap JS runtime boundary", () => {
  test("converts markers, route paths, fit bounds, map clicks and drags at the edge", () => {
    const onMapClick = vi.fn();
    const onMarkerDragEnd = vi.fn();
    const factory = createAMapRuntime(amap, config);
    const handle = factory.createMap({
      container: document.createElement("div"),
      onTileError: vi.fn(),
      onMapClick,
      onMarkerDragEnd,
      draggableMarkers: true,
    });
    const wgs = { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" as const };
    const gcj = wgs84ToGcj02(wgs);
    handle.setMarkers([{
      id: "item-1", itemId: "item-1", dayId: "day-1", dayNumber: 1, daySequence: 1,
      dayColor: "#2563eb", markerLabel: "Day 1 · 1", label: "外滩", coordinate: [wgs.longitude, wgs.latitude], tooltip: "外滩",
    }]);
    expect(FakeMarker.all.at(-1)?.position[0]).toBeCloseTo(gcj.longitude, 6);
    expect(FakeMarker.all.at(-1)?.position[1]).toBeCloseTo(gcj.latitude, 6);

    handle.setRouteGeoJson({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[wgs.longitude, wgs.latitude], [121.49, 31.24]] }, properties: {} }] });
    expect((handle as unknown as { setRouteGeoJson: (value: unknown) => void })).toBeTruthy();
    handle.fitBounds([[121.47, 31.22], [121.5, 31.25]], { padding: 48, maxZoom: 14 });
    expect(FakeMap.current.bounds).toBeInstanceOf(FakeBounds);
    expect((FakeMap.current.bounds as FakeBounds).southwest).toMatchObject({ lng: expect.any(Number), lat: expect.any(Number) });

    FakeMap.current.handlers.get("click")?.({ lnglat: { lng: gcj.longitude, lat: gcj.latitude } });
    expect(onMapClick).toHaveBeenCalledWith(expect.objectContaining({ crs: "WGS84", longitude: expect.closeTo(wgs.longitude, 6) }));
    FakeMarker.all.at(-1)?.emit("dragend", { lnglat: { lng: gcj.longitude, lat: gcj.latitude }, originalEvent: { pointerType: "touch" } });
    expect(onMarkerDragEnd).toHaveBeenCalledWith("item-1", expect.objectContaining({ crs: "WGS84" }), "touch");
    handle.setBaseLayer?.("amap-satellite-labels");
    expect(FakeMap.current.layers.at(-1)).toHaveLength(2);
  });
});

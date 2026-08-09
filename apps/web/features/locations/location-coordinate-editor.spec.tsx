// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { LocationCoordinateEditor } from "../../src/features/locations/location-coordinate-editor";
import type { ProductLocation } from "../../src/features/locations/location-product-picker";

type TestPoint = { longitude: number; latitude: number; crs: "WGS84" };
type TestMapOptions = {
  onMapClick?: (point: TestPoint) => void;
  onMarkerDragEnd?: (id: string, point: TestPoint, inputMode: "mouse" | "touch") => void;
};
const mapRuntime = vi.hoisted(() => ({ options: null as TestMapOptions | null }));

vi.mock("../../src/features/map/maplibre-runtime.mjs", () => ({
  loadMapLibreRuntime: async () => ({
    createMap: async (options: TestMapOptions) => {
      mapRuntime.options = options;
      return { setGeoJson: vi.fn(), setMarkers: vi.fn(), setRouteGeoJson: vi.fn(), fitBounds: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
    },
  }),
}));

afterEach(() => {
  cleanup();
  mapRuntime.options = null;
  vi.unstubAllGlobals();
});

test("E2E-015 persists map pick, Marker drag and final manual WGS84 coordinates with successive ETags", async () => {
  const calls: Array<{ body: Record<string, unknown>; ifMatch: string | null }> = [];
  let server: ProductLocation = {
    id: "location-1", tripId: "trip-1", inputText: "外滩附近", name: "外滩附近",
    formattedAddress: null, city: null, district: null, point: null, provider: "none",
    attribution: null, status: "unresolved", manuallyAdjusted: false, version: 1,
  };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ body, ifMatch: new Headers(init?.headers).get("if-match") });
    server = {
      ...server,
      point: { longitude: Number(body.longitude), latitude: Number(body.latitude), crs: "WGS84" },
      provider: "manual", status: "resolved", manuallyAdjusted: true, version: server.version + 1,
    };
    return Response.json(server);
  }));

  function Harness() {
    const [location, setLocation] = useState(server);
    return <LocationCoordinateEditor tripId="trip-1" location={location} onSaved={setLocation} />;
  }
  render(<Harness />);
  await waitFor(() => expect(mapRuntime.options).not.toBeNull());

  await act(async () => mapRuntime.options!.onMapClick!({ longitude: 121.49, latitude: 31.24, crs: "WGS84" }));
  await screen.findByText(/version 2/u);
  await act(async () => mapRuntime.options!.onMarkerDragEnd!("location-1", { longitude: 121.5, latitude: 31.23, crs: "WGS84" }, "touch"));
  await screen.findByText(/version 3/u);
  fireEvent.change(screen.getByLabelText("手工 longitude"), { target: { value: "121.5100" } });
  fireEvent.change(screen.getByLabelText("手工 latitude"), { target: { value: "31.2200" } });
  fireEvent.click(screen.getByRole("button", { name: "保存手工坐标" }));
  await screen.findByText(/version 4.*121\.51, 31\.22.*人工调整/u);

  expect(calls).toEqual([
    { body: { longitude: 121.49, latitude: 31.24, adjustmentKind: "map-pick", inputMode: "mouse" }, ifMatch: "\"1\"" },
    { body: { longitude: 121.5, latitude: 31.23, adjustmentKind: "marker-drag", inputMode: "touch" }, ifMatch: "\"2\"" },
    { body: { longitude: 121.51, latitude: 31.22, adjustmentKind: "manual", inputMode: "manual" }, ifMatch: "\"3\"" },
  ]);
});

test("E2E-015 surfaces a Location version conflict", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "LOCATION_VERSION_CONFLICT", title: "version conflict" }, { status: 409 })));
  const location: ProductLocation = {
    id: "location-1", tripId: "trip-1", inputText: "外滩附近", name: "外滩附近",
    formattedAddress: null, city: null, district: null, point: null, provider: "none",
    attribution: null, status: "unresolved", manuallyAdjusted: false, version: 1,
  };
  render(<LocationCoordinateEditor tripId="trip-1" location={location} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "保存地图点选" }));
  expect((await screen.findByRole("alert")).textContent).toContain("版本冲突");
});

test("E2E-015 does not mislabel another 409 as a version conflict", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    code: "INVALID_LOCATION_TRANSITION", detail: "Location cannot transition from failed to resolved.",
  }, { status: 409 })));
  const location: ProductLocation = {
    id: "location-1", tripId: "trip-1", inputText: "外滩附近", name: "外滩附近",
    formattedAddress: null, city: null, district: null, point: null, provider: "none",
    attribution: null, status: "failed", manuallyAdjusted: false, version: 3,
  };
  render(<LocationCoordinateEditor tripId="trip-1" location={location} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "保存地图点选" }));
  expect((await screen.findByRole("alert")).textContent).toContain("failed to resolved");
});

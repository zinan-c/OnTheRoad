// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { LocationProductPicker } from "../../src/features/locations/location-product-picker";

vi.mock("../../src/features/map/maplibre-runtime.mjs", () => ({
  loadMapLibreRuntime: async () => ({
    createMap: async () => ({ setGeoJson: vi.fn(), setMarkers: vi.fn(), setRouteGeoJson: vi.fn(), fitBounds: vi.fn(), resize: vi.fn(), destroy: vi.fn() }),
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("E2E-015 saves plain Location text without starting geocoding", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const unresolved = {
    id: "location-text", tripId: "trip-1", inputText: "外滩附近", name: "外滩附近",
    formattedAddress: null, city: null, district: null, point: null, provider: null,
    attribution: null, status: "unresolved", manuallyAdjusted: false, version: 1,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return Response.json(unresolved, { status: 201 });
  }));
  const onLocationChange = vi.fn();
  render(<LocationProductPicker tripId="trip-1" locationId="" onLocationChange={onLocationChange} />);

  fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "外滩附近" } });
  fireEvent.click(screen.getByRole("button", { name: "Save text only" }));

  await screen.findByText("Location status: unresolved");
  expect(onLocationChange).toHaveBeenLastCalledWith("location-text", "外滩附近");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url.endsWith("/trips/trip-1/locations")).toBe(true);
  expect(calls[0]?.init?.method).toBe("POST");
});

test("E2E-014 explicitly confirms a signed candidate and reloads the resolved Location", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const unresolved = {
    id: "location-1", tripId: "trip-1", inputText: "人民广场", name: "人民广场",
    formattedAddress: null, city: null, district: null, point: null, provider: "none",
    attribution: null, status: "unresolved", manuallyAdjusted: false, version: 1,
  };
  const offered = { ...unresolved, status: "ambiguous", version: 3 };
  const resolved = {
    ...unresolved, name: "人民广场", formattedAddress: "上海市黄浦区人民大道人民广场",
    city: "上海", district: "黄浦区", point: { longitude: 121.4752, latitude: 31.2304, crs: "WGS84" },
    provider: "fixture", attribution: "On The Road fixture", status: "resolved", version: 4,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    let body: unknown;
    if (url.endsWith("/locations") && init?.method === "POST") body = unresolved;
    else if (url.endsWith("/search") && init?.method === "POST") body = {
      location: offered, job: { id: "job-1", status: "ambiguous" }, mapProfile: "cn_primary",
      candidates: [
        { label: "人民广场", formattedAddress: resolved.formattedAddress, city: "上海", district: "黄浦区", point: resolved.point, provider: "fixture", attribution: "On The Road fixture", selected: false, candidateToken: "signed-shanghai" },
        { label: "人民广场", formattedAddress: "重庆市渝中区人民路人民广场", city: "重庆", district: "渝中区", point: { longitude: 106.5528, latitude: 29.5637, crs: "WGS84" }, provider: "fixture", attribution: "On The Road fixture", selected: false, candidateToken: "signed-chongqing" },
      ],
    };
    else if (url.endsWith("/candidate") && init?.method === "POST") body = resolved;
    else body = resolved;
    return new Response(JSON.stringify(body), { status: init?.method === "POST" && url.endsWith("/locations") ? 201 : 200, headers: { "content-type": "application/json" } });
  }));
  const onLocationChange = vi.fn();
  const view = render(<LocationProductPicker tripId="trip-1" locationId="" onLocationChange={onLocationChange} />);
  fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "人民广场" } });
  fireEvent.click(screen.getByRole("button", { name: "Search location" }));

  const choices = await screen.findAllByRole("radio");
  expect(choices).toHaveLength(2);
  expect(choices.every((choice) => !(choice as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /上海.*黄浦区/u }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm location" }));
  await screen.findByText(/Location status: resolved/u);
  await waitFor(() => expect(calls.some(({ url, init }) => {
    if (!url.endsWith("/candidate") || init?.method !== "POST") return false;
    const submitted = JSON.parse(String(init.body));
    return submitted.jobId === "job-1" && submitted.candidateToken === "signed-shanghai" && submitted.point === undefined;
  })).toBe(true));
  expect(onLocationChange).toHaveBeenLastCalledWith("location-1", "人民广场");

  view.unmount();
  render(<LocationProductPicker tripId="trip-1" locationId="location-1" onLocationChange={vi.fn()} />);
  expect(await screen.findByText(/上海市黄浦区人民大道人民广场/u)).toBeTruthy();
  expect(calls.filter(({ url, init }) => url.endsWith("/locations/location-1") && !init?.method)).toHaveLength(1);
});

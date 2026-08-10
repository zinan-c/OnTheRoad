// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { TransportModeManager } from "../../../src/features/trips/settings/transport-mode-manager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("E2E-013 creates and deactivates a custom Mode through the public API", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const custom = {
    id: "mode-1", tripId: "trip-1", ownerId: "owner-1",
    code: "CABLE_SHUTTLE_CUSTOM", label: "缆车接驳", icon: "cable-car",
    color: "#123456", lineStyle: "dotted" as const, isSystem: false,
    enabled: true, referenced: false, version: 1,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const body = init?.method === "POST"
      ? custom
      : init?.method === "DELETE" ? { ...custom, enabled: false, referenced: true, version: 2 } : [];
    return new Response(JSON.stringify(body), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }));
  const catalog = vi.fn();
  render(<TransportModeManager tripId="trip-1" onCatalogChange={catalog} />);
  await waitFor(() => expect(calls.some(({ url, init }) => url.endsWith("/trips/trip-1/transport-modes") && !init?.method)).toBe(true));

  fireEvent.change(screen.getByLabelText("Transport mode code"), { target: { value: "CABLE_SHUTTLE_CUSTOM" } });
  fireEvent.change(screen.getByLabelText("Transport mode name"), { target: { value: "缆车接驳" } });
  fireEvent.change(screen.getByLabelText("Transport mode icon"), { target: { value: "cable-car" } });
  fireEvent.change(screen.getByLabelText("Transport mode color"), { target: { value: "#123456" } });
  fireEvent.change(screen.getByLabelText("Transport mode line style"), { target: { value: "dotted" } });
  fireEvent.click(screen.getByRole("button", { name: "Add transport mode" }));

  expect(await screen.findByText("CABLE_SHUTTLE_CUSTOM")).toBeTruthy();
  expect(catalog).toHaveBeenLastCalledWith([custom]);
  fireEvent.click(screen.getByRole("button", { name: "Deactivate 缆车接驳" }));
  await waitFor(() => expect(calls.some(({ url, init }) =>
    url.endsWith("/transport-modes/mode-1")
    && init?.method === "DELETE"
    && new Headers(init.headers).get("if-match") === "1",
  )).toBe(true));
  await waitFor(() => expect(catalog).toHaveBeenLastCalledWith([
    expect.objectContaining({ code: "CABLE_SHUTTLE_CUSTOM", enabled: false, referenced: true }),
  ]));
});

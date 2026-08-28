// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockChildren = vi.hoisted(() => ({
  routeMap: vi.fn(),
  itinerary: vi.fn(),
}));

vi.mock("../../src/features/map/route-map-workspace", () => ({
  RouteMapWorkspace: (props: { readonly selectedDayId: string | null }) => {
    mockChildren.routeMap(props);
    return <div data-testid="route-map" data-selected-day={props.selectedDayId ?? "all"} />;
  },
}));

vi.mock("../../src/features/itinerary/itinerary-panel", () => ({
  ItineraryPanel: (props: { readonly selectedDayId: string | null }) => {
    mockChildren.itinerary(props);
    return <div data-testid="itinerary" data-selected-day={props.selectedDayId ?? "all"} />;
  },
}));

vi.mock("../../src/features/expenses/expense-workspace", () => ({
  ExpenseWorkspace: () => null,
}));

vi.mock("../../src/features/attachments/trip-gallery", () => ({
  TripGalleryWorkspace: () => null,
}));

vi.mock("../../src/features/imports/import-workspace", () => ({
  ImportWorkspace: () => null,
}));

import { TripWorkspace } from "../../src/features/trips/trip-workspace";

const days = Array.from({ length: 14 }, (_, index) => ({
  id: `day-${index + 1}`,
  dayNumber: index + 1,
  date: `2026-08-${String(index + 1).padStart(2, "0")}`,
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/days")) return Response.json(days);
    if (url.includes("/itinerary-items")) return Response.json([]);
    if (url.endsWith("/transport-modes")) return Response.json([]);
    throw new Error(`Unexpected request: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockChildren.routeMap.mockReset();
  mockChildren.itinerary.mockReset();
});

describe("TripWorkspace independent day navigation", () => {
  test("ignores a previous Trip load that finishes after the current Trip", async () => {
    let resolveOldDays!: (response: Response) => void;
    let resolveNewDays!: (response: Response) => void;
    const oldDays = new Promise<Response>((resolveResponse) => { resolveOldDays = resolveResponse; });
    const newDays = new Promise<Response>((resolveResponse) => { resolveNewDays = resolveResponse; });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/trips/trip-old/days")) return oldDays;
      if (url.endsWith("/trips/trip-new/days")) return newDays;
      if (url.includes("/itinerary-items") || url.endsWith("/transport-modes")) return Response.json([]);
      throw new Error(`Unexpected request: ${url}`);
    }));

    const view = render(<TripWorkspace tripId="trip-old" showItineraryPanel />);
    view.rerender(<TripWorkspace tripId="trip-new" showItineraryPanel />);
    resolveNewDays(Response.json([{ id: "new-day", dayNumber: 1, date: "2026-09-01" }]));

    const newDay = await screen.findByRole("button", { name: /Day 1, 9\/1/u });
    await userEvent.setup().click(newDay);
    expect(screen.getByTestId("itinerary").getAttribute("data-selected-day")).toBe("new-day");

    resolveOldDays(Response.json([{ id: "old-day", dayNumber: 9, date: "2026-08-09" }]));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Day 9/u })).toBeNull());
    expect(screen.getByRole("button", { name: /Day 1, 9\/1/u }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("itinerary").getAttribute("data-selected-day")).toBe("new-day");
  });

  test("keeps 13+ days in a dedicated list and preserves its scroll position when selecting Day 13", async () => {
    render(<TripWorkspace tripId="trip-1" showItineraryPanel />);

    const dayList = await screen.findByRole("navigation", { name: "Select day" });
    const dayButtons = within(dayList).getAllByRole("button");
    expect(dayButtons).toHaveLength(14);
    expect(dayList.className).toContain("tripDayRailList");
    expect(screen.getByRole("button", { name: /ALL.*Global map/ })).toBeTruthy();

    Object.defineProperty(dayList, "scrollTop", { configurable: true, writable: true, value: 96 });
    await userEvent.setup().click(screen.getByRole("button", { name: /Day 13/ }));

    expect(dayList.scrollTop).toBe(96);
    expect(screen.getByRole("button", { name: /Day 13/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("route-map").getAttribute("data-selected-day")).toBe("day-13");
    expect(screen.getByTestId("itinerary").getAttribute("data-selected-day")).toBe("day-13");
  });

  test("keeps the mobile day strip horizontal instead of creating a wrapping grid", async () => {
    render(<TripWorkspace tripId="trip-1" />);
    const dayList = await screen.findByRole("navigation", { name: "Select day" });
    const stylesPath = existsSync(resolve(process.cwd(), "src/app/styles.css"))
      ? resolve(process.cwd(), "src/app/styles.css")
      : resolve(process.cwd(), "apps/web/src/app/styles.css");
    const styles = readFileSync(stylesPath, "utf8");

    expect(styles).toContain(".tripDayRailList");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain("overscroll-behavior-y: contain");
    expect(styles).toContain("@media (max-width: 720px)");
    const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 720px)"));
    const mobileDayListRule = mobileStyles.match(/\.tripDayRailList \{[^}]*\}/)?.[0] ?? "";
    expect(mobileDayListRule).toContain("overflow-x: auto");
    expect(mobileDayListRule).toContain("flex-wrap: nowrap");
    expect(mobileDayListRule).toContain("overscroll-behavior-x: contain");
    expect(mobileDayListRule).toContain("overscroll-behavior-y: auto");
    expect(mobileDayListRule).toContain("touch-action: pan-x pan-y");
    expect(mobileDayListRule).not.toContain("overscroll-behavior-y: none");
    expect(mobileDayListRule).not.toContain("touch-action: pan-x;");
    expect(dayList.className).toContain("tripDayRailList");
  });

  test("does not programmatically scroll the page when a day is selected", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    render(<TripWorkspace tripId="trip-1" showItineraryPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Day 13/ })).toBeTruthy());
    await userEvent.setup().click(screen.getByRole("button", { name: /Day 13/ }));

    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });
});

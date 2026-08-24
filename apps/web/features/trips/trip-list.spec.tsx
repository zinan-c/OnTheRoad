// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  search: "",
  subscribers: new Set<(value: string) => void>(),
}));

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({
      replace(url: string) {
        navigation.search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
        for (const subscriber of navigation.subscribers) subscriber(navigation.search);
      },
    }),
    useSearchParams: () => {
      const [value, setValue] = React.useState(navigation.search);
      React.useEffect(() => {
        navigation.subscribers.add(setValue);
        return () => navigation.subscribers.delete(setValue);
      }, []);
      return React.useMemo(() => new URLSearchParams(value), [value]);
    },
  };
});

import {
  parseTripListQuery,
  TripList,
  tripListUrl,
  type TripListGateway,
} from "../../src/app/trips/trip-list";

afterEach(() => {
  cleanup();
  navigation.search = "";
  navigation.subscribers.clear();
});

const deletedTrip = {
  id: "trip-8",
  name: "已确认旅行",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  totalDays: 3,
  travelers: 4,
  defaultCurrency: "EUR",
  budget: "12000.50",
  timezone: "Asia/Shanghai",
  mapProfile: "cn_primary" as const,
  description: "中英文 mixed",
  status: "deleted" as const,
  version: 3,
};

describe("E2E-008 Trip list and recycle bin", () => {
  test("ignores stale responses and isolates cached pages by query", async () => {
    const activeTrip = { ...deletedTrip, id: "active-1", name: "Active result", status: "active" as const };
    const first = deferred<{ items: readonly typeof activeTrip[]; nextCursor: string | null }>();
    const second = deferred<{ items: readonly typeof activeTrip[]; nextCursor: string | null }>();
    const trash = deferred<{ items: readonly typeof activeTrip[]; nextCursor: string | null }>();
    const list = vi.fn((query: Parameters<TripListGateway["list"]>[0]) => {
      if (query.status === "deleted") return trash.promise;
      if (query.search === "first") return first.promise;
      if (query.search === "second") return second.promise;
      return Promise.resolve({ items: [activeTrip], nextCursor: null });
    });
    const gateway: TripListGateway = { list, restore: vi.fn(), transition: vi.fn() };
    render(<TripList gateway={gateway} />);
    const user = userEvent.setup();
    expect(await screen.findByText("Active result")).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Search trips" }), "first");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.clear(screen.getByRole("textbox", { name: "Search trips" }));
    await user.type(screen.getByRole("textbox", { name: "Search trips" }), "second");
    await user.click(screen.getByRole("button", { name: "Search" }));
    second.resolve({ items: [{ ...activeTrip, name: "Second result" }], nextCursor: null });
    expect(await screen.findByText("Second result")).toBeTruthy();
    first.resolve({ items: [{ ...activeTrip, name: "Stale result" }], nextCursor: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Stale result")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Trash" }));
    await waitFor(() => expect(screen.queryByText("Second result")).toBeNull());
    trash.resolve({ items: [{ ...activeTrip, name: "Trash result", status: "deleted" }], nextCursor: null });
    expect(await screen.findByText("Trash result")).toBeTruthy();
  });

  test("keeps list state in the URL and resets the cursor for a new search", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: "cursor-page-2" }));
    const gateway: TripListGateway = {
      list,
      restore: vi.fn(),
    };
    render(<TripList gateway={gateway} />);
    const user = userEvent.setup();
    await screen.findByText("No trips here yet.");
    await user.type(screen.getByRole("textbox", { name: "Search trips" }), "beach");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "beach" }));
    expect(tripListUrl({
      status: "active",
      search: "beach",
      sort: "lastActivityAt",
      order: "desc",
    })).toBe("/trips?search=beach");
    expect(parseTripListQuery(new URLSearchParams("view=deleted&sort=name&order=asc&search=x"))).toEqual({
      status: "deleted",
      search: "x",
      sort: "name",
      order: "asc",
    });
  });

  test("exposes draft and archived tabs with safe activation controls", async () => {
    const draftTrip = { ...deletedTrip, id: "draft-1", name: "Draft trip", status: "draft" as const };
    const list = vi.fn(async (query: Parameters<TripListGateway["list"]>[0]) => ({
      items: query.status === "draft" ? [draftTrip] : [],
      nextCursor: null,
    }));
    const transition = vi.fn().mockResolvedValue({ ...draftTrip, status: "active" as const });
    const gateway: TripListGateway = { list, restore: vi.fn(), transition };
    render(<TripList gateway={gateway} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(await screen.findByText("Draft trip")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Activate" }));
    expect(transition).toHaveBeenCalledWith("draft-1", 3, "active");
  });

  test("keeps deleted trips out of the default list and restores the same id", async () => {
    const list = vi.fn(async (query: Parameters<TripListGateway["list"]>[0]) => ({
      items: query.status === "deleted" ? [deletedTrip] : [],
      nextCursor: null,
    }));
    const gateway: TripListGateway = {
      list,
      restore: vi.fn().mockResolvedValue({ ...deletedTrip, status: "active", version: 4 }),
      transition: vi.fn(),
    };
    render(<TripList gateway={gateway} />);
    const user = userEvent.setup();

    expect(await screen.findByText("No trips here yet.")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Trash" }));
    expect(await screen.findByText("已确认旅行")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore trip" }));

    expect(gateway.restore).toHaveBeenCalledWith("trip-8", 3);
    expect((await screen.findByRole("status")).textContent).toContain("was restored");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: "active", sort: "lastActivityAt", order: "desc" }));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

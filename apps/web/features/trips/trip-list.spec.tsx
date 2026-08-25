// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  search: "",
  pushes: [] as string[],
  replacements: [] as string[],
  subscribers: new Set<(value: string) => void>(),
}));

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({
      push(url: string) {
        navigation.pushes.push(url);
        navigation.search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
        for (const subscriber of navigation.subscribers) subscriber(navigation.search);
      },
      replace(url: string) {
        navigation.replacements.push(url);
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

beforeEach(() => {
  vi.spyOn(window.history, "pushState").mockImplementation((_state, _unused, url) => {
    const value = String(url ?? "");
    navigation.pushes.push(value);
    navigation.search = value.includes("?") ? value.slice(value.indexOf("?") + 1) : "";
    for (const subscriber of navigation.subscribers) subscriber(navigation.search);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigation.search = "";
  navigation.pushes = [];
  navigation.replacements = [];
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
    const first = deferred<{ items: readonly typeof activeTrip[]; previousCursor: string | null; nextCursor: string | null }>();
    const second = deferred<{ items: readonly typeof activeTrip[]; previousCursor: string | null; nextCursor: string | null }>();
    const trash = deferred<{ items: readonly typeof activeTrip[]; previousCursor: string | null; nextCursor: string | null }>();
    const signals: AbortSignal[] = [];
    const list = vi.fn((query: Parameters<TripListGateway["list"]>[0], options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      if (query.status === "deleted") return trash.promise;
      if (query.search === "first") return first.promise;
      if (query.search === "second") return second.promise;
      return Promise.resolve({ items: [activeTrip], previousCursor: null, nextCursor: null });
    });
    const gateway: TripListGateway = { list, restore: vi.fn(), transition: vi.fn() };
    render(<TripList gateway={gateway} />);
    const user = userEvent.setup();
    expect(await screen.findByText("Active result")).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Search trips" }), "first");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(signals.at(-2)?.aborted).toBe(true);
    await user.clear(screen.getByRole("textbox", { name: "Search trips" }));
    await user.type(screen.getByRole("textbox", { name: "Search trips" }), "second");
    await user.click(screen.getByRole("button", { name: "Search" }));
    second.resolve({ items: [{ ...activeTrip, name: "Second result" }], previousCursor: null, nextCursor: null });
    expect(await screen.findByText("Second result")).toBeTruthy();
    first.resolve({ items: [{ ...activeTrip, name: "Stale result" }], previousCursor: null, nextCursor: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Stale result")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Trash" }));
    expect(signals.at(-2)?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByText("Second result")).toBeNull());
    trash.resolve({ items: [{ ...activeTrip, name: "Trash result", status: "deleted" }], previousCursor: null, nextCursor: null });
    expect(await screen.findByText("Trash result")).toBeTruthy();
  });

  test("keeps list state in the URL and resets the cursor for a new search", async () => {
    const list = vi.fn(async () => ({ items: [], previousCursor: null, nextCursor: "cursor-page-2" }));
    const gateway: TripListGateway = {
      list,
      restore: vi.fn(),
    };
    render(<TripList gateway={gateway} />);
    const user = userEvent.setup();
    await screen.findByText("No trips here yet.");
    await user.type(screen.getByRole("textbox", { name: "Search trips" }), "beach");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "beach" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(navigation.pushes).toContain("/trips?search=beach");
    expect(tripListUrl({
      status: "active",
      search: "beach",
      sort: "lastActivityAt",
      order: "desc",
    })).toBe("/trips?search=beach");
    expect(tripListUrl({
      status: "active",
      search: "beach",
      sort: "name",
      order: "desc",
    })).toBe("/trips?search=beach&sort=name&order=desc");
    expect(parseTripListQuery(new URLSearchParams("view=deleted&sort=name&order=asc&search=x"))).toEqual({
      status: "deleted",
      search: "x",
      sort: "name",
      order: "asc",
    });
  });

  test("restores a copied page URL with a working server-provided Previous cursor", async () => {
    navigation.search = "sort=name&order=asc&cursor=copied-page-2";
    const list = vi.fn(async (query: Parameters<TripListGateway["list"]>[0]) => ({
      items: [],
      previousCursor: query.cursor ? "page-1-boundary" : null,
      nextCursor: null,
    }));
    render(<TripList gateway={{ list, restore: vi.fn(), transition: vi.fn() }} />);
    const user = userEvent.setup();

    await screen.findByText("No trips here yet.");
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "name", order: "asc", cursor: "copied-page-2" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(navigation.pushes.at(-1)).toBe("/trips?sort=name&order=asc&cursor=page-1-boundary");
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "page-1-boundary" }),
      expect.any(Object),
    );
  });

  test("canonicalizes invalid URL values with replace rather than a user-history push", async () => {
    navigation.search = "status=unknown&sort=ownerId&order=sideways";
    const list = vi.fn(async () => ({ items: [], previousCursor: null, nextCursor: null }));
    render(<TripList gateway={{ list, restore: vi.fn(), transition: vi.fn() }} />);

    await screen.findByText("No trips here yet.");
    expect(navigation.replacements).toContain("/trips");
    expect(navigation.pushes).toEqual([]);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "active", sort: "lastActivityAt", order: "desc" }),
      expect.any(Object),
    );
  });

  test("exposes draft and archived tabs with safe activation controls", async () => {
    const draftTrip = { ...deletedTrip, id: "draft-1", name: "Draft trip", status: "draft" as const };
    const list = vi.fn(async (query: Parameters<TripListGateway["list"]>[0]) => ({
      items: query.status === "draft" ? [draftTrip] : [],
      previousCursor: null,
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
    expect(navigation.pushes).toContain("/trips?view=active");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Active trips" }).getAttribute("aria-selected")).toBe("true"));
  });

  test("keeps deleted trips out of the default list and restores the same id", async () => {
    const list = vi.fn(async (query: Parameters<TripListGateway["list"]>[0]) => ({
      items: query.status === "deleted" ? [deletedTrip] : [],
      previousCursor: null,
      nextCursor: null,
    }));
    const gateway: TripListGateway = {
      list,
      restore: vi.fn().mockResolvedValue({ ...deletedTrip, status: "archived", version: 4 }),
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
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived", sort: "lastActivityAt", order: "desc" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

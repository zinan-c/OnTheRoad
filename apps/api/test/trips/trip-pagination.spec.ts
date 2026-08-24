import { describe, expect, test, vi } from "vitest";

import { PostgresTripRepository } from "../../src/modules/trips/postgres-repository.mjs";
import { TripListQueryError, TripService } from "../../src/modules/trips/service.mjs";
import {
  decodeTripCursor,
  encodeTripCursor,
  tripListQueryKey,
} from "../../src/modules/trips/cursor.mjs";

const firstId = "106144e2-4d65-4bd0-a67d-43edbc88ac8d";
const secondId = "206144e2-4d65-4bd0-a67d-43edbc88ac8d";

describe("trip cursor pagination", () => {
  test("round-trips an opaque keyset cursor and rejects tampering", () => {
    const queryKey = tripListQueryKey({ status: "active" });
    const encoded = encodeTripCursor({
      sort: "lastActivityAt",
      order: "desc",
      value: "2026-08-24T12:00:00.123456Z",
      id: firstId,
      queryKey,
    });
    expect(decodeTripCursor(encoded)).toEqual({
      sort: "lastActivityAt",
      order: "desc",
      value: "2026-08-24T12:00:00.123456Z",
      id: firstId,
      queryKey,
    });
    expect(() => decodeTripCursor(`${encoded.slice(0, -1)}!`)).toThrowError(
      expect.objectContaining({ code: "TRIP_CURSOR_INVALID", status: 400 }),
    );
  });

  test("uses the default twenty-item recent-activity query and emits nextCursor", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          trip: { id: firstId },
          cursor_value: "2026-08-24T12:00:00.123456Z",
          cursor_id: firstId,
        },
        {
          trip: { id: secondId },
          cursor_value: "2026-08-23T12:00:00.123456Z",
          cursor_id: secondId,
        },
      ],
    });
    const repository = new PostgresTripRepository({
      executor: { query, json: vi.fn(), close: vi.fn() },
    });
    const page = await repository.list("owner-a", {
      status: "active",
      sort: "lastActivityAt",
      order: "desc",
      limit: 1,
      queryKey: tripListQueryKey({ status: "active" }),
    });
    expect(page.items).toEqual([{ id: firstId }]);
    expect(page.nextCursor).toBeTypeOf("string");
    expect(decodeTripCursor(page.nextCursor!)).toMatchObject({
      sort: "lastActivityAt",
      order: "desc",
      id: firstId,
    });
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY t.last_activity_at DESC, t.id DESC");
    expect(query.mock.calls[0]?.[1]).toEqual(["owner-a", "", "", "active", 2]);
  });

  test("normalizes and whitelists service list filters", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const service = new TripService({ list });
    await service.listTrips("owner-a", { search: "  beach ", currency: "cny" });
    expect(list).toHaveBeenCalledWith("owner-a", expect.objectContaining({
      search: "beach",
      currency: "CNY",
      status: "active",
      sort: "lastActivityAt",
      order: "desc",
      limit: 20,
      cursor: null,
    }));
    expect(() => service.listTrips("owner-a", { sort: "ownerId" })).toThrowError(
      expect.objectContaining({ code: "TRIP_LIST_QUERY_INVALID", status: 400 }),
    );
  });
});

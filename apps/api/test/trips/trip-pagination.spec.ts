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
const thirdId = "306144e2-4d65-4bd0-a67d-43edbc88ac8d";

describe("trip cursor pagination", () => {
  test("round-trips an opaque keyset cursor and rejects tampering", () => {
    const queryKey = tripListQueryKey({ status: "active" });
    const encoded = encodeTripCursor({
      sort: "lastActivityAt",
      order: "desc",
      direction: "next",
      value: "2026-08-24T12:00:00.123456Z",
      id: firstId,
      queryKey,
    });
    expect(decodeTripCursor(encoded)).toEqual({
      sort: "lastActivityAt",
      order: "desc",
      direction: "next",
      value: "2026-08-24T12:00:00.123456Z",
      id: firstId,
      queryKey,
    });
    expect(() => decodeTripCursor(`${encoded.slice(0, -1)}!`)).toThrowError(
      expect.objectContaining({ code: "TRIP_CURSOR_INVALID", status: 400 }),
    );
    const legacy = Buffer.from(JSON.stringify({
      v: 1,
      sort: "lastActivityAt",
      order: "desc",
      value: "2026-08-24T12:00:00.123456Z",
      id: firstId,
      queryKey,
    })).toString("base64url");
    expect(decodeTripCursor(legacy)).toMatchObject({ direction: "next", id: firstId });
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
    expect(page.previousCursor).toBeNull();
    expect(page.nextCursor).toBeTypeOf("string");
    expect(decodeTripCursor(page.nextCursor!)).toMatchObject({
      sort: "lastActivityAt",
      order: "desc",
      direction: "next",
      id: firstId,
    });
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY t.last_activity_at DESC, t.id DESC");
    expect(query.mock.calls[0]?.[1]).toEqual(["owner-a", "", "", "active", 2]);
  });

  test("queries backwards, restores display order, and emits both page directions", async () => {
    const queryKey = tripListQueryKey({ status: "active", sort: "name", order: "asc" });
    const query = vi.fn().mockResolvedValue({
      rows: [
        { trip: { id: thirdId, name: "Charlie" }, cursor_value: "Charlie", cursor_id: thirdId },
        { trip: { id: secondId, name: "Bravo" }, cursor_value: "Bravo", cursor_id: secondId },
        { trip: { id: firstId, name: "Alpha" }, cursor_value: "Alpha", cursor_id: firstId },
      ],
    });
    const repository = new PostgresTripRepository({
      executor: { query, json: vi.fn(), close: vi.fn() },
    });
    const page = await repository.list("owner-a", {
      status: "active",
      sort: "name",
      order: "asc",
      limit: 2,
      queryKey,
      cursor: {
        sort: "name",
        order: "asc",
        direction: "previous",
        value: "Delta",
        id: "406144e2-4d65-4bd0-a67d-43edbc88ac8d",
        queryKey,
      },
    });

    expect(page.items).toEqual([
      { id: secondId, name: "Bravo" },
      { id: thirdId, name: "Charlie" },
    ]);
    expect(decodeTripCursor(page.previousCursor!)).toMatchObject({
      direction: "previous",
      value: "Bravo",
      id: secondId,
    });
    expect(decodeTripCursor(page.nextCursor!)).toMatchObject({
      direction: "next",
      value: "Charlie",
      id: thirdId,
    });
    expect(query.mock.calls[0]?.[0]).toContain("t.name < $6::text");
    expect(query.mock.calls[0]?.[0]).toContain("t.id < $7::uuid");
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY t.name DESC, t.id DESC");
  });

  test("normalizes and whitelists service list filters", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], previousCursor: null, nextCursor: null });
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
    const beachCursor = encodeTripCursor({
      sort: "name",
      order: "asc",
      direction: "next",
      value: "Beach",
      id: firstId,
      queryKey: tripListQueryKey({ search: "beach", status: "active", sort: "name", order: "asc" }),
    });
    expect(() => service.listTrips("owner-a", {
      search: "mountain",
      sort: "name",
      order: "asc",
      cursor: beachCursor,
    })).toThrowError(expect.objectContaining({
      code: "TRIP_LIST_QUERY_INVALID",
      message: "cursor does not match the requested list",
    }));
  });
});

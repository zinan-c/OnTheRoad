import { describe, expect, test, vi } from "vitest";

import { TripListQueryError, TripService } from "../../src/modules/trips/service.mjs";

describe("trip lifecycle service", () => {
  test("supports draft/archive transitions and restores with the database sentinel", async () => {
    const transition = vi.fn().mockResolvedValue({ id: "trip-1" });
    const service = new TripService({ transition });
    await service.transitionTrip("owner-1", "trip-1", "draft", { expectedVersion: 2 });
    await service.transitionTrip("owner-1", "trip-1", "archived", { expectedVersion: 3 });
    await service.restoreTrip("owner-1", "trip-1", { expectedVersion: 4 });
    expect(transition.mock.calls).toEqual([
      ["owner-1", "trip-1", 2, "draft"],
      ["owner-1", "trip-1", 3, "archived"],
      ["owner-1", "trip-1", 4, "restore"],
    ]);
  });

  test("rejects unknown lifecycle states before touching the repository", () => {
    const transition = vi.fn();
    const service = new TripService({ transition });
    expect(() => service.transitionTrip("owner-1", "trip-1", "deleted", { expectedVersion: 1 }))
      .toThrowError(expect.objectContaining({ code: "TRIP_LIST_QUERY_INVALID", status: 400 } satisfies Partial<TripListQueryError>));
    expect(transition).not.toHaveBeenCalled();
  });
});

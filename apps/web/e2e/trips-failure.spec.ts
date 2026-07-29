import { describe, expect, test } from "vitest";

import { TripsController, tripListLayout } from "../src/features/trips/trips-controller.js";

function validTrip() {
  return {
    name: "海岛五日",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    travelers: 2,
    defaultCurrency: "CNY",
    budget: "9000.00",
    timezone: "Asia/Shanghai",
    mapProfile: "cn_primary",
    destinations: [{ name: "上海" }, { name: "舟山" }],
  };
}

describe("TC-B04-02 failure and destructive-action behavior", () => {
  test("double-submit performs one request and retry recovers from a network error", async () => {
    let calls = 0;
    let rejectFirst = true;
    const gateway = {
      async createTrip(input: unknown) {
        calls += 1;
        await Promise.resolve();
        if (rejectFirst) {
          rejectFirst = false;
          throw new Error("network unavailable");
        }
        return { id: "trip-1", totalDays: 5, ...input as object };
      },
    };
    const controller = new TripsController(gateway);

    const first = controller.submit(validTrip(), "create-1");
    const duplicate = controller.submit(validTrip(), "create-1");
    await expect(first).rejects.toThrow(/network unavailable/i);
    await expect(duplicate).rejects.toThrow(/network unavailable/i);
    expect(calls).toBe(1);
    expect(controller.state.error).toMatch(/network unavailable/i);

    await expect(controller.retry()).resolves.toMatchObject({ id: "trip-1" });
    expect(calls).toBe(2);
    expect(controller.state.error).toBeNull();
  });

  test("delete requires confirmation and restore remains available", async () => {
    const actions: string[] = [];
    const gateway = {
      async deleteTrip(id: string) {
        actions.push(`delete:${id}`);
        return { id, status: "deleted", version: 2 };
      },
      async restoreTrip(id: string) {
        actions.push(`restore:${id}`);
        return { id, status: "active", version: 3 };
      },
    };
    const controller = new TripsController(gateway);

    controller.requestDelete("trip-1");
    expect(actions).toEqual([]);
    await controller.confirmDelete("different-trip");
    expect(actions).toEqual([]);
    await controller.confirmDelete("trip-1");
    await controller.restore("trip-1");
    expect(actions).toEqual(["delete:trip-1", "restore:trip-1"]);
    expect(tripListLayout(390)).toBe("compact");
    expect(tripListLayout(1_200)).toBe("grid");
  });
});

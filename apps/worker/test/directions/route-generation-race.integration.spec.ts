import { describe, expect, test } from "vitest";

import { generateRouteWindow } from "@on-the-road/domain/routing";

type RouteCandidate = ReturnType<typeof generateRouteWindow>[number];

function item(id: string, sortOrder: number, longitude: number) {
  return {
    id,
    tripDayId: "day-01",
    dayNumber: 1,
    sortOrder,
    version: 1,
    itemType: "attraction",
    location: {
      id: `location-${id}`,
      version: 1,
      geocodingStatus: "resolved",
      point: { longitude, latitude: 31.2 },
    },
  };
}

/**
 * This is deliberately a test-local rebuild coordinator. It records the
 * concurrency contract C07 requires until a production route worker/repository
 * is wired: an older generation may finish, but it cannot replace a newer
 * generation's active result.
 */
class RebuildRaceHarness {
  #generation = 0;
  #active: RouteCandidate[] = [];

  async rebuild(items: object[], delayMs: number): Promise<"committed" | "discarded"> {
    const generation = ++this.#generation;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const candidate = generateRouteWindow({
      items,
      routeGenerations: { "day-01": generation },
    });
    if (generation !== this.#generation) return "discarded";
    this.#active = candidate;
    return "committed";
  }

  active(): RouteCandidate[] {
    return this.#active;
  }
}

describe("C07 route generation race/rebuild contract", () => {
  test("discards an older rebuild when a newer generation wins the race", async () => {
    const harness = new RebuildRaceHarness();
    const first = [item("item-a", 0, 121.48), item("item-b", 1, 121.49)];
    const second = [item("item-a", 0, 121.48), item("item-b", 1, 121.50)];

    const oldBuild = harness.rebuild(first, 30);
    const newBuild = harness.rebuild(second, 1);

    await expect(Promise.all([oldBuild, newBuild])).resolves.toEqual([
      "discarded",
      "committed",
    ]);
    expect(harness.active()).toHaveLength(1);
    expect(harness.active()[0]?.sourceContext.routeGenerations).toEqual({
      "day-01": 2,
    });
    expect(harness.active()[0]?.toLocation?.point.longitude).toBe(121.5);
  });
});

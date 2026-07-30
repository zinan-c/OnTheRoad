import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import fc from "fast-check";

import {
  ItineraryOrderError,
  assertBaseDayVersion,
  assertCompleteDayOrder,
} from "../src/itinerary/order.mjs";

describe("TC-B07-01 Ordered-set property", () => {
  test("accepts every permutation of the complete same-Day ID set", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 10_000 }),
        (ids, seed) => {
          const orderedIds = [...ids];
          for (let index = orderedIds.length - 1; index > 0; index -= 1) {
            const target = (seed + index * 17) % (index + 1);
            [orderedIds[index], orderedIds[target]] = [
              orderedIds[target]!,
              orderedIds[index]!,
            ];
          }
          expect(assertCompleteDayOrder(ids, orderedIds)).toEqual(orderedIds);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("rejects missing, extra, duplicate, and cross-Day IDs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 20 }),
        (ids) => {
          const extra = randomUUID();
          const invalidOrders = [
            ids.slice(1),
            [...ids, extra],
            [ids[0]!, ids[0]!, ...ids.slice(1)],
            [extra, ...ids.slice(1)],
          ];
          for (const orderedIds of invalidOrders) {
            expect(() => assertCompleteDayOrder(ids, orderedIds)).toThrow(
              ItineraryOrderError,
            );
            try {
              assertCompleteDayOrder(ids, orderedIds);
            } catch (error) {
              expect(error).toMatchObject({
                code: "ITINERARY_ORDER_SET_MISMATCH",
                status: 422,
              });
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test("rejects non-arrays, invalid IDs, and invalid base versions", () => {
    expect(() => assertCompleteDayOrder([randomUUID()], "not-an-array" as never))
      .toThrow(/array/u);
    expect(() => assertCompleteDayOrder([randomUUID()], ["not-a-uuid"]))
      .toThrow(/UUID/u);
    expect(() => assertBaseDayVersion(0)).toThrow(/baseVersion/u);
  });
});

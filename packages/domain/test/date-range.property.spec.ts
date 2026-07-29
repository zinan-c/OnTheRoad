import { describe, expect, test } from "vitest";
import fc from "fast-check";

import {
  generateDateRange,
  previewDateRangeChange,
} from "../src/trip/date-range.mjs";

const DAY_MS = 86_400_000;

function isoDay(epochDay: number): string {
  return new Date(epochDay * DAY_MS).toISOString().slice(0, 10);
}

describe("TC-B03-01 date range property suite", () => {
  test("generates inclusive, continuous Day 1..N ranges across months and years", () => {
    fc.assert(fc.property(
      fc.integer({ min: 10_000, max: 30_000 }),
      fc.integer({ min: 0, max: 365 }),
      (startDay, length) => {
        const days = generateDateRange(isoDay(startDay), isoDay(startDay + length));
        expect(days).toHaveLength(length + 1);
        expect(days.map(({ dayNumber }) => dayNumber)).toEqual(
          Array.from({ length: length + 1 }, (_, index) => index + 1),
        );
        expect(days[0]?.date).toBe(isoDay(startDay));
        expect(days.at(-1)?.date).toBe(isoDay(startDay + length));
      },
    ));
  });

  test("handles same-day and leap-day ranges deterministically", () => {
    expect(generateDateRange("2028-02-29", "2028-02-29")).toEqual([
      expect.objectContaining({ dayNumber: 1, date: "2028-02-29", dayOfWeek: 2 }),
    ]);
    expect(generateDateRange("2028-02-28", "2028-03-01").map(({ date }) => date)).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  test("preview reports every added, retained, removed, and blocked day", () => {
    const preview = previewDateRangeChange({
      current: generateDateRange("2026-10-01", "2026-10-05"),
      nextStartDate: "2026-10-02",
      nextEndDate: "2026-10-06",
      contentByDate: { "2026-10-01": [{ type: "item", id: "item-1" }] },
    });
    expect(preview.added.map(({ date }) => date)).toEqual(["2026-10-06"]);
    expect(preview.removed.map(({ date }) => date)).toEqual(["2026-10-01"]);
    expect(preview.retained).toHaveLength(4);
    expect(preview.blockers).toEqual([
      { date: "2026-10-01", content: [{ type: "item", id: "item-1" }] },
    ]);
  });
});

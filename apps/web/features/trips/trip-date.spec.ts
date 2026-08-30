import { expect, test } from "vitest";

import { formatTripDate } from "../../src/features/trips/trip-date";

test("formats Trip calendar dates independently of the host time zone", () => {
  expect(formatTripDate("2026-09-01")).toBe("9/1 · 周二");
  expect(formatTripDate("2026-08-14")).toBe("8/14 · 周五");
});

test("handles missing and invalid Trip dates", () => {
  expect(formatTripDate()).toBe("Date not set");
  expect(formatTripDate("not-a-date")).toBe("not-a-date");
});

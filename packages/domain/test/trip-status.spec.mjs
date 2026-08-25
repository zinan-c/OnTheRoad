import { describe, expect, test } from "vitest";

import { normalizeTripInput } from "../src/trip/index.mjs";

function tripInput(overrides = {}) {
  return {
    name: "Lifecycle trip",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    travelers: 2,
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    mapProfile: "cn_primary",
    destinations: [{ name: "Shanghai", countryCode: "CN" }],
    ...overrides,
  };
}

describe("Trip creation lifecycle status", () => {
  test("defaults to active and accepts an explicit draft", () => {
    expect(normalizeTripInput(tripInput()).status).toBe("active");
    expect(normalizeTripInput(tripInput({ status: "draft" })).status).toBe("draft");
  });

  test("rejects archived or deleted creation", () => {
    expect(() => normalizeTripInput(tripInput({ status: "archived" })))
      .toThrowError(expect.objectContaining({
        code: "TRIP_VALIDATION_FAILED",
        field: "status",
      }));
  });
});

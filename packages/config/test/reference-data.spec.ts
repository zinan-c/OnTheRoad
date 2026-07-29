import { describe, expect, test } from "vitest";

import {
  costCategories,
  currencies,
  normalizeCurrencyCode,
  transportModes,
  validateReferenceData,
} from "../src/reference-data.mjs";

const expectedCurrencies = [
  "CNY", "USD", "EUR", "JPY", "KRW", "PHP", "THB", "SGD",
  "MYR", "VND", "IDR", "HKD", "TWD", "AUD", "GBP",
];
const expectedCategories = [
  "TRANSPORT", "ACCOMMODATION", "DINING", "TICKET", "SHOPPING",
  "ENTERTAINMENT", "VISA", "INSURANCE", "OTHER",
];
const expectedModes = [
  "WALK", "BICYCLE", "MOTORCYCLE", "SELF_DRIVE", "TAXI", "RIDE_HAILING",
  "CHARTER_CAR", "BUS", "COACH", "PUBLIC_BUS", "METRO", "LIGHT_RAIL",
  "TRAIN", "HIGH_SPEED_RAIL", "FLIGHT", "SHIP", "PUBLIC_BOAT",
  "CHARTER_BOAT", "FERRY", "CABLE_CAR", "SHUTTLE", "OTHER",
];

describe("TC-B01-01 reference enum completeness", () => {
  test("contains the frozen design codes and complete visual metadata", () => {
    expect(currencies.map(({ code }) => code)).toEqual(expectedCurrencies);
    expect(costCategories.map(({ code }) => code)).toEqual(expectedCategories);
    expect(transportModes.map(({ code }) => code)).toEqual(expectedModes);
    expect(transportModes).toHaveLength(22);

    for (const entry of [...costCategories, ...transportModes]) {
      expect(entry.icon).toMatch(/^[a-z0-9-]+$/u);
      expect(entry.color).toMatch(/^#[0-9A-F]{6}$/u);
    }
    for (const mode of transportModes) {
      expect(["solid", "dashed", "dotted"]).toContain(mode.lineStyle);
      expect(mode.aliases.length).toBeGreaterThan(0);
    }
    expect(validateReferenceData()).toEqual({ valid: true, errors: [] });
    expect(normalizeCurrencyCode("RMB")).toBe("CNY");
    expect(normalizeCurrencyCode("cny")).toBe("CNY");
  });
});

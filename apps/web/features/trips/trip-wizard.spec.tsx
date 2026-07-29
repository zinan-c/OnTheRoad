import { describe, expect, test } from "vitest";

import { TripWizard } from "../../src/features/trips/trip-wizard.js";

describe("TC-B04-01 four-step trip wizard", () => {
  test("moves forward, returns for edits, and produces the normalized summary payload", () => {
    const wizard = new TripWizard();
    wizard.updateBasics({ name: "海岛五日", description: "上海到普陀山" });
    expect(wizard.next()).toBe(1);
    wizard.updateDates({ startDate: "2026-10-01", endDate: "2026-10-05", travelers: 2 });
    expect(wizard.next()).toBe(2);
    wizard.updateDestinations([
      { name: "上海", countryCode: "CN" },
      { name: "舟山", countryCode: "CN" },
    ]);
    expect(wizard.next()).toBe(3);
    wizard.updateBudget({
      defaultCurrency: "RMB",
      budget: "9000.00",
      timezone: "Asia/Shanghai",
      mapProfile: "cn_primary",
    });

    expect(wizard.summary()).toMatchObject({
      name: "海岛五日",
      dateLabel: "2026-10-01 → 2026-10-05",
      totalDays: 5,
      destinationLabel: "上海、舟山",
      defaultCurrency: "CNY",
    });
    wizard.back();
    wizard.updateDestinations([
      { name: "上海", countryCode: "CN" },
      { name: "普陀山", countryCode: "CN" },
    ]);
    wizard.next();
    expect(wizard.submission()).toMatchObject({
      name: "海岛五日",
      defaultCurrency: "CNY",
      destinations: [{ name: "上海", countryCode: "CN" }, { name: "普陀山", countryCode: "CN" }],
    });
  });

  test("supports keyboard navigation and rejects invalid dates before advancing", () => {
    const wizard = new TripWizard();
    wizard.updateBasics({ name: "键盘旅行" });
    expect(wizard.handleKey("Enter")).toBe(1);
    wizard.updateDates({ startDate: "2026-10-05", endDate: "2026-10-01", travelers: 1 });
    expect(() => wizard.handleKey("Enter")).toThrow(/end date/i);
    expect(wizard.handleKey("Escape")).toBe(0);
  });
});

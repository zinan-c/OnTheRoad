import { describe, expect, test } from "vitest";

import { summarizeExpenses } from "../../src/modules/expenses/summary.mjs";

describe("D05 expense summary dimensions", () => {
  test("keeps five independently checkable dimensions", () => {
    const result = summarizeExpenses([
      { tripDayId: "day-1", destinationId: "dest-1", categoryCode: "DINING", transportModeCode: "WALK", currency: "CNY", originalAmount: "10.0000", settledAmount: "10.0000", settlementCurrency: "CNY" },
      { tripDayId: "day-1", destinationId: "dest-1", categoryCode: "DINING", transportModeCode: "WALK", currency: "USD", originalAmount: "2.0000", settledAmount: null, settlementCurrency: "CNY" },
    ], "CNY");
    expect(result.breakdowns.day["day-1"]).toMatchObject({ originalTotal: "12.0000", settledTotal: "10.0000", unconverted: "1" });
    expect(result.breakdowns.destination["dest-1"].originalTotal).toBe("12.0000");
    expect(result.breakdowns.category.DINING.originalTotal).toBe("12.0000");
    expect(result.breakdowns.mode.WALK.originalTotal).toBe("12.0000");
    expect(result.breakdowns.currency.USD.unconverted).toBe("1");
  });
});

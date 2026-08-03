import { describe, expect, test } from "vitest";

import { dimensionRows, formatCost } from "../../src/features/expenses/cost-summary-model";

const summary = { settlementCurrency: "CNY", settledActualTotal: "80.0000", originalCurrencyTotals: { CNY: "80.0000" }, unconverted: [], breakdowns: { day: { "day-1": { originalTotal: "80.0000", settledTotal: "80.0000", unconverted: "0" } } } };

describe("TC-D05-01 five-dimension selectors", () => {
  test("formats and keeps dimensions auditable", () => {
    expect(formatCost("80.0000", "CNY")).toBe("80.0000 CNY");
    expect(dimensionRows(summary, "day")).toHaveLength(1);
  });
});

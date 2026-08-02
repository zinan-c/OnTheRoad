import { describe, expect, test } from "vitest";

import { budgetPresentation, dimensionRows, formatCost } from "./cost-summary.js";

const summary = { settlementCurrency: "CNY", settledActualTotal: "80.0000", originalCurrencyTotals: { CNY: "80.0000" }, unconverted: [], breakdowns: { day: { "day-1": { originalTotal: "80.0000", settledTotal: "80.0000", unconverted: "0" } } } };

describe("D05 cost selectors", () => {
  test("formats and keeps dimensions auditable", () => {
    expect(formatCost("80.0000", "CNY")).toBe("80.0000 CNY");
    expect(dimensionRows(summary, "day")).toHaveLength(1);
    expect(budgetPresentation(summary, "100.0000")).toMatchObject({ tone: "positive" });
  });

  test("does not claim a green remaining budget when an exchange rate is missing", () => {
    expect(budgetPresentation({ ...summary, unconverted: [{ currency: "USD", amount: "10.0000" }] }, "100.0000").tone).toBe("warning");
    expect(budgetPresentation(summary, null).tone).toBe("neutral");
  });
});

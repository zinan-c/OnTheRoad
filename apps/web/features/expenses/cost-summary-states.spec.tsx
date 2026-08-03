import { describe, expect, test } from "vitest";

import { budgetPresentation } from "../../src/features/expenses/cost-summary-model";

describe("TC-D05-02 missing-rate/budget UX", () => {
  test("distinguishes missing rates, unset budget, overspend, and zero cost", () => {
    expect(budgetPresentation({
      settledActualTotal: "80.0000",
      unconverted: [{ currency: "USD", amount: "10.0000" }],
    }, "100.0000")).toMatchObject({
      tone: "warning",
      label: expect.stringContaining("未折算"),
    });
    expect(budgetPresentation({
      settledActualTotal: "0.0000",
      unconverted: [],
    }, null)).toEqual({
      tone: "neutral",
      label: "预算未设置",
    });
    expect(budgetPresentation({
      settledActualTotal: "120.0000",
      unconverted: [],
    }, "100.0000")).toEqual({
      tone: "danger",
      label: "已超支 20.0000",
    });
    expect(budgetPresentation({
      settledActualTotal: "0.0000",
      unconverted: [],
    }, "100.0000")).toEqual({
      tone: "positive",
      label: "暂定剩余 100.0000",
    });
  });
});

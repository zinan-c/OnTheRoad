import { describe, expect, test } from "vitest";

import {
  canonicalColumn,
  normalizeCurrencyAlias,
  safeSpreadsheetText,
} from "../src/index.mjs";

describe("TC-E01-02 formula and input aliases", () => {
  test.each(["=1+1", "+SUM(A1:A2)", "-1+2", "@cmd"])(
    "neutralizes formula-like text %s",
    (value) => {
      expect(safeSpreadsheetText(value)).toBe(`'${value}`);
    },
  );

  test("normalizes RMB and duration aliases without guessing", () => {
    expect(normalizeCurrencyAlias("RMB")).toBe("CNY");
    expect(normalizeCurrencyAlias(" cny ")).toBe("CNY");
    expect(normalizeCurrencyAlias(" usd ")).toBe("USD");
    expect(normalizeCurrencyAlias("jPy")).toBe("JPY");
    expect(canonicalColumn("Dur")).toBe("Duration");
    expect(canonicalColumn("时长")).toBe("Duration");
    expect(normalizeCurrencyAlias("US$")).toBe("US$");
  });
});

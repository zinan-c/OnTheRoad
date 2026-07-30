import { describe, expect, test } from "vitest";
import fc from "fast-check";

import {
  convertMoney,
  normalizeMoney,
  normalizeRate,
} from "../src/expense/index.mjs";

describe("TC-D04-01 decimal and exchange-rate calculation", () => {
  test("multiplies integer-valued decimal strings exactly", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 10_000_000 }),
      fc.integer({ min: 1, max: 100_000 }),
      (amount, rate) => {
        expect(convertMoney(
          `${amount}.0000`,
          `${rate}.000000000000`,
        )).toBe(`${amount * rate}.0000`);
      },
    ));
  });

  test("uses fixed half-up rounding and never binary floating point", () => {
    expect(convertMoney("0.0001", "0.500000000000")).toBe("0.0001");
    expect(convertMoney("12.3456", "7.890123456789")).toBe("97.4083");
    expect(normalizeMoney("0001.2")).toBe("1.2000");
    expect(normalizeRate("7.8")).toBe("7.800000000000");
  });

  test("rejects negative, excessive precision and non-decimal values", () => {
    for (const value of ["-1", "1.00001", "NaN", "1e3", ""]) {
      expect(() => normalizeMoney(value)).toThrow();
    }
    expect(() => normalizeRate("0")).toThrow();
  });
});

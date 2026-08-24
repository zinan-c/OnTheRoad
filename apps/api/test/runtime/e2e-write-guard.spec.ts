import { describe, expect, test } from "vitest";

import { assertE2eWriteDatabase } from "../../src/runtime.js";

const token = "e2e-write-token-that-is-long-enough-for-tests-123456";

describe("E2E write database guard", () => {
  test("accepts the disposable Playwright database", () => {
    expect(assertE2eWriteDatabase(
      new URL("postgresql://postgres:secret@localhost/on_the_road_playwright_e2e"),
      { OTR_E2E_MODE: "1", OTR_E2E_WRITE_TOKEN: token },
    )).toEqual({
      token,
      databaseName: "on_the_road_playwright_e2e",
    });
  });

  test("accepts a run-scoped E2E database", () => {
    expect(assertE2eWriteDatabase(
      new URL("postgresql://postgres:secret@localhost/on_the_road_e2e_run-123"),
      { OTR_E2E_MODE: "1", OTR_E2E_WRITE_TOKEN: token },
    )?.databaseName).toBe("on_the_road_e2e_run-123");
  });

  test("rejects E2E mode against a normal database", () => {
    expect(() => assertE2eWriteDatabase(
      new URL("postgresql://postgres:secret@localhost/on_the_road"),
      { OTR_E2E_MODE: "1", OTR_E2E_WRITE_TOKEN: token },
    )).toThrow(/disposable database/u);
  });

  test("rejects E2E mode without an explicit write token", () => {
    expect(() => assertE2eWriteDatabase(
      new URL("postgresql://postgres:secret@localhost/on_the_road_playwright_e2e"),
      { OTR_E2E_MODE: "1" },
    )).toThrow(/OTR_E2E_WRITE_TOKEN/u);
  });

  test("does not constrain ordinary runtime mode", () => {
    expect(assertE2eWriteDatabase(
      new URL("postgresql://postgres:secret@localhost/on_the_road"),
      {},
    )).toBeUndefined();
  });
});

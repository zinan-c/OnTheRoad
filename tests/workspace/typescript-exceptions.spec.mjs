import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("REVIEW-P1-05 ts-nocheck is limited to owned third-party isolation files", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-typescript-exceptions.mjs"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(`${result.stdout}\n${result.stderr}`).toContain(
    "2 approved isolation files",
  );
  expect(result.status).toBe(0);
});

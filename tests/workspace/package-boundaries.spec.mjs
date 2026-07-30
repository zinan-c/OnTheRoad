import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("REVIEW-P1-05/P1-03 applications use package exports and generated API contracts", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-package-boundaries.mjs"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(`${result.stdout}\n${result.stderr}`).toContain(
    "Package boundaries verified",
  );
  expect(result.status).toBe(0);
});

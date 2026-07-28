import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);

test("TC-A01-03 every push runs the development test gate", async () => {
  const testWorkflow = await readFile(
    new URL(".github/workflows/all-tests.yml", root),
    "utf8",
  );
  const qualityWorkflow = await readFile(
    new URL(".github/workflows/ci.yml", root),
    "utf8",
  );
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );

  assert.match(
    testWorkflow,
    /^on:\n {2}push:\n {2}pull_request:\n {2}workflow_dispatch:$/m,
  );
  assert.match(testWorkflow, /^name: "CI: Test Cases"$/m);
  assert.match(testWorkflow, /run: pnpm run test:all:dev/);
  assert.doesNotMatch(testWorkflow, /RUN_COMPOSE_INTEGRATION/);
  assert.doesNotMatch(testWorkflow, /docker compose/);
  assert.match(qualityWorkflow, /^name: "CI: Quality Related"$/m);

  for (const command of [
    "pnpm run unit",
    "pnpm run test:integration",
    "pnpm run test:visual",
    "pnpm run ci:smoke",
  ]) {
    assert.ok(
      packageJson.scripts["test:all:dev"].includes(command),
      `test:all:dev must include ${command}`,
    );
  }
});

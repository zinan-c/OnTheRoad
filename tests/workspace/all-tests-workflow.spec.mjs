import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);

test("TC-A01-03 every push runs development and Compose test gates", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/all-tests.yml", root),
    "utf8",
  );
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );

  assert.match(
    workflow,
    /^on:\n {2}push:\n {2}pull_request:\n {2}workflow_dispatch:$/m,
  );
  assert.match(workflow, /name: all-tests \/ development/);
  assert.match(workflow, /run: pnpm run test:all:dev/);
  assert.match(workflow, /name: all-tests \/ A02 Compose integration/);
  assert.match(workflow, /RUN_COMPOSE_INTEGRATION: "1"/);
  assert.match(workflow, /tests\/infra\/compose-health\.spec\.mjs/);
  assert.match(workflow, /tests\/infra\/compose-recovery\.spec\.mjs/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /down --volumes --remove-orphans/);

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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);

test("TC-A01-03 every push runs the development test gate", async () => {
  const testWorkflow = await readFile(
    new URL(".github/workflows/ci_test_cases.yml", root),
    "utf8",
  );
  const qualityWorkflow = await readFile(
    new URL(".github/workflows/ci_quality_related.yml", root),
    "utf8",
  );
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );

  assert.match(
    testWorkflow,
    /^on:\n {2}push:\n {2}pull_request:\n {2}workflow_dispatch:$/m,
  );
  assert.match(testWorkflow, /^name: "CI-Test Cases"$/m);
  assert.match(testWorkflow, /run: \|[\s\S]*pnpm run test:cases:required/);
  assert.match(
    testWorkflow,
    /bash scripts\/install-native-minio\.sh "\$RUNNER_TEMP\/otr-native-minio"/,
  );
  assert.match(testWorkflow, /RUN_COMPOSE_INTEGRATION: "1"/);
  assert.match(testWorkflow, /bash scripts\/dev-up\.sh --track compose/);
  assert.match(testWorkflow, /OTR_REQUIRED_CASE_REPORT: test-results\/m0-m2-required\.json/);
  assert.match(testWorkflow, /uses: actions\/upload-artifact@v4/);
  assert.match(qualityWorkflow, /^name: "CI-Quality Related"$/m);
  assert.equal(
    qualityWorkflow.match(/bash scripts\/install-native-minio\.sh/g)?.length,
    2,
    "unit and clean-install paths both require native MinIO",
  );
  assert.equal(
    qualityWorkflow.match(/install --no-install-recommends --yes imagemagick poppler-utils/g)
      ?.length,
    2,
    "unit and clean-install paths both require ImageMagick and Poppler",
  );
  assert.match(
    testWorkflow,
    /install --no-install-recommends --yes imagemagick poppler-utils/,
  );

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
  assert.equal(packageJson.scripts["test:cases:required"], "node scripts/run-required-cases.mjs");
});

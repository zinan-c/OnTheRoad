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
  const releaseWorkflow = await readFile(
    new URL(".github/workflows/release_gates.yml", root),
    "utf8",
  );
  const localCi = await readFile(
    new URL("scripts/run-local-ci.sh", root),
    "utf8",
  );
  const playwrightConfig = await readFile(
    new URL("apps/web/playwright.config.ts", root),
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
  assert.doesNotMatch(testWorkflow, /RUN_COMPOSE_INTEGRATION/);
  assert.match(releaseWorkflow, /RUN_COMPOSE_INTEGRATION: "1"/);
  assert.match(
    releaseWorkflow,
    /cp infra\/local-stack\.env\.example infra\/local-stack\.env[\s\S]*docker compose --env-file infra\/local-stack\.env/,
  );
  assert.match(testWorkflow, /bash scripts\/dev-up\.sh --track compose/);
  assert.match(testWorkflow, /OTR_REQUIRED_CASE_REPORT: test-results\/m0-m2-required\.json/);
  assert.match(
    testWorkflow,
    /: "\$\{REDIS_URL:\?infra\/local-stack\.env must define REDIS_URL\}"/,
  );
  assert.match(testWorkflow, /export OTR_M1_REDIS_URL="\$REDIS_URL"/);
  assert.match(
    testWorkflow,
    /Initialize required-case diagnostic artifact[\s\S]*node scripts\/initialize-required-case-report\.mjs[\s\S]*Start real integration dependencies/,
  );
  assert.match(testWorkflow, /uses: actions\/upload-artifact@v6/);
  assert.doesNotMatch(
    `${testWorkflow}\n${qualityWorkflow}\n${releaseWorkflow}`,
    /uses: (?:actions\/(?:checkout|setup-node|upload-artifact)|pnpm\/action-setup)@v4(?:\s|$)/m,
  );
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
  assert.equal(packageJson.scripts["ci:local"], "bash scripts/run-local-ci.sh");
  for (const command of [
    "pnpm run toolchain:check",
    "pnpm install --frozen-lockfile",
    "docker compose version",
    "docker info",
    "pnpm run quality",
    "bash scripts/dev-up.sh --track compose",
    "pnpm run db:migrate",
    "pnpm run db:seed",
    "pnpm run test:cases:required",
    "pnpm run ci:smoke",
    "git diff --exit-code",
  ]) {
    assert.ok(localCi.includes(command), `local CI must include ${command}`);
  }
  assert.match(localCi, /trap cleanup EXIT/);
  assert.match(localCi, /export OTR_M1_REDIS_URL="\$\{REDIS_URL\}"/);
  assert.doesNotMatch(playwrightConfig, /start:dev/);
  assert.match(
    playwrightConfig,
    /@on-the-road\/web build && pnpm --filter @on-the-road\/web start/,
  );
});

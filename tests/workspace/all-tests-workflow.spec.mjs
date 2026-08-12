import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);

test("clean-checkout dev profile uses authenticated local-stack values", async () => {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "otr-profile-loader-"));
  try {
    await mkdir(resolve(fixtureRoot, "scripts"), { recursive: true });
    await mkdir(resolve(fixtureRoot, "infra"), { recursive: true });
    await writeFile(
      resolve(fixtureRoot, "scripts/run-profile.sh"),
      await readFile(new URL("../../scripts/run-profile.sh", import.meta.url), "utf8"),
    );
    await writeFile(resolve(fixtureRoot, ".env.example"), [
      "OTR_ENV_DATABASE_URL=postgresql://placeholder@localhost:5432/placeholder",
      "OTR_ENV_REDIS_URL=redis://localhost:6379",
      "OTR_ENV_OBJECT_STORAGE_ENDPOINT=http://localhost:9000",
      "OTR_ENV_OBJECT_STORAGE_ACCESS_KEY=placeholder-access",
      "OTR_ENV_OBJECT_STORAGE_SECRET_KEY=placeholder-secret",
      "OTR_ENV_OBJECT_STORAGE_BUCKET=placeholder-bucket",
      "OTR_ENV_OBJECT_STORAGE_REGION=placeholder-region",
      "OTR_ENV_CLAMAV_HOST=localhost",
      "OTR_ENV_CLAMAV_PORT=3310",
      "OTR_ENV_SESSION_SECRET=example-session-secret",
      "",
    ].join("\n"));
    await writeFile(resolve(fixtureRoot, "infra/local-stack.env"), [
      "DATABASE_URL=postgresql://stack-user:stack-password@127.0.0.1:15432/stack-db",
      "REDIS_URL=redis://default:stack-password@127.0.0.1:16379/0",
      "S3_ENDPOINT=http://127.0.0.1:19000",
      "S3_ACCESS_KEY=stack-access",
      "S3_SECRET_KEY=stack-secret",
      "MINIO_BUCKET=stack-bucket",
      "S3_REGION=stack-region",
      "CLAMAV_HOST=127.0.0.1",
      "CLAMAV_PORT=13310",
      "",
    ].join("\n"));

    const environmentProbe = `console.log(JSON.stringify({
      database: process.env.DATABASE_URL,
      redis: process.env.REDIS_URL,
      storageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      storageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY,
      storageSecretKey: process.env.OBJECT_STORAGE_SECRET_KEY,
      storageBucket: process.env.OBJECT_STORAGE_BUCKET,
      storageRegion: process.env.OBJECT_STORAGE_REGION,
      clamavHost: process.env.CLAMAV_HOST,
      clamavPort: process.env.CLAMAV_PORT,
      sessionSecret: process.env.SESSION_SECRET,
    }))`;
    const result = spawnSync("bash", [
      resolve(fixtureRoot, "scripts/run-profile.sh"),
      "dev",
      "--",
      process.execPath,
      "-e",
      environmentProbe,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      database: "postgresql://stack-user:stack-password@127.0.0.1:15432/stack-db",
      redis: "redis://default:stack-password@127.0.0.1:16379/0",
      storageEndpoint: "http://127.0.0.1:19000",
      storageAccessKey: "stack-access",
      storageSecretKey: "stack-secret",
      storageBucket: "stack-bucket",
      storageRegion: "stack-region",
      clamavHost: "127.0.0.1",
      clamavPort: "13310",
      sessionSecret: "example-session-secret",
    });

    const injected = {
      OTR_RUNTIME_PROFILE: "qa",
      OTR_ENV_DATABASE_URL: "postgresql://remote-user:remote-password@db.example:5432/remote-db",
      OTR_ENV_REDIS_URL: "rediss://:remote-password@redis.example:6380/0",
      OTR_ENV_OBJECT_STORAGE_ENDPOINT: "https://storage.example",
      OTR_ENV_OBJECT_STORAGE_ACCESS_KEY: "remote-access",
      OTR_ENV_OBJECT_STORAGE_SECRET_KEY: "remote-secret",
      OTR_ENV_OBJECT_STORAGE_BUCKET: "remote-bucket",
      OTR_ENV_OBJECT_STORAGE_REGION: "remote-region",
      OTR_ENV_CLAMAV_HOST: "clamav.example",
      OTR_ENV_CLAMAV_PORT: "3310",
      OTR_ENV_SESSION_SECRET: "remote-session-secret",
    };
    const qaResult = spawnSync("bash", [
      resolve(fixtureRoot, "scripts/run-profile.sh"),
      "qa",
      "--",
      process.execPath,
      "-e",
      environmentProbe,
    ], { encoding: "utf8", env: { ...process.env, ...injected } });

    assert.equal(qaResult.status, 0, qaResult.stderr);
    assert.deepEqual(JSON.parse(qaResult.stdout), {
      database: injected.OTR_ENV_DATABASE_URL,
      redis: injected.OTR_ENV_REDIS_URL,
      storageEndpoint: injected.OTR_ENV_OBJECT_STORAGE_ENDPOINT,
      storageAccessKey: injected.OTR_ENV_OBJECT_STORAGE_ACCESS_KEY,
      storageSecretKey: injected.OTR_ENV_OBJECT_STORAGE_SECRET_KEY,
      storageBucket: injected.OTR_ENV_OBJECT_STORAGE_BUCKET,
      storageRegion: injected.OTR_ENV_OBJECT_STORAGE_REGION,
      clamavHost: injected.OTR_ENV_CLAMAV_HOST,
      clamavPort: injected.OTR_ENV_CLAMAV_PORT,
      sessionSecret: injected.OTR_ENV_SESSION_SECRET,
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

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
  const runEnvironment = await readFile(
    new URL("scripts/run-environment.sh", root),
    "utf8",
  );
  const nativeMinioInstaller = await readFile(
    new URL("scripts/install-native-minio.sh", root),
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
  assert.match(testWorkflow, /OTR_REQUIRED_CASE_REPORT: test-results\/m0-m3-required\.json/);
  assert.match(
    testWorkflow,
    /: "\$\{REDIS_URL:\?infra\/local-stack\.env must define REDIS_URL\}"/,
  );
  assert.match(testWorkflow, /export OTR_M1_REDIS_URL="\$REDIS_URL"/);
  assert.match(testWorkflow, /export OTR_C07_DATABASE_URL="\$DATABASE_URL"/);
  assert.match(testWorkflow, /export OTR_E04_DATABASE_URL="\$DATABASE_URL"/);
  assert.match(
    testWorkflow,
    /export OTR_SCHEMA_IMMUTABILITY_DATABASE_URL="\$DATABASE_URL"/,
  );
  assert.match(
    testWorkflow,
    /pnpm exec turbo run build[\s\\]*--filter=@on-the-road\/api[\s\\]*--filter=@on-the-road\/worker/,
  );
  assert.match(
    testWorkflow,
    /profile:dev -- pnpm --filter @on-the-road\/api start[\s\\]*> test-results\/m3-api\.log 2>&1 &/,
  );
  assert.match(
    testWorkflow,
    /profile:dev -- pnpm --filter @on-the-road\/worker start[\s\\]*> test-results\/m3-worker\.log 2>&1 &/,
  );
  assert.match(
    testWorkflow,
    /health\/ready[\s\\]*> test-results\/m3-readiness\.json/,
  );
  assert.match(testWorkflow, /cat test-results\/m3-readiness\.json/);
  assert.match(
    testWorkflow,
    /Initialize required-case diagnostic artifact[\s\S]*node scripts\/initialize-required-case-report\.mjs[\s\S]*Start real integration dependencies/,
  );
  assert.match(testWorkflow, /uses: actions\/upload-artifact@v6/);
  assert.match(testWorkflow, /pnpm run test:cases:evidence/);
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
  assert.match(nativeMinioInstaller, /--retry-all-errors/);
  assert.match(nativeMinioInstaller, /--retry-delay 5/);
  assert.match(nativeMinioInstaller, /github\.com\/minio\/minio\/releases\/download/);
  assert.match(nativeMinioInstaller, /github\.com\/minio\/mc\/releases\/download/);
  assert.match(nativeMinioInstaller, /sha256sum --check/);
  assert.equal(
    qualityWorkflow.match(/install --no-install-recommends --yes imagemagick poppler-utils/g)
      ?.length,
    2,
    "unit and clean-install paths both require ImageMagick and Poppler",
  );
  assert.match(
    testWorkflow,
    /install --no-install-recommends --yes imagemagick poppler-utils redis-tools/,
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
    "pnpm run test:cases:evidence",
    "pnpm run ci:smoke",
    "git diff --exit-code",
  ]) {
    assert.ok(localCi.includes(command), `local CI must include ${command}`);
  }
  assert.match(localCi, /trap cleanup EXIT/);
  assert.match(localCi, /psql redis-cli magick/);
  assert.match(localCi, /export OTR_M1_REDIS_URL="\$\{REDIS_URL\}"/);
  assert.match(localCi, /export OTR_C07_DATABASE_URL="\$\{DATABASE_URL\}"/);
  assert.match(localCi, /export OTR_E04_DATABASE_URL="\$\{DATABASE_URL\}"/);
  assert.match(
    localCi,
    /export OTR_SCHEMA_IMMUTABILITY_DATABASE_URL="\$\{DATABASE_URL\}"/,
  );
  assert.match(
    localCi,
    /pnpm exec turbo run build[\s\\]*--filter=@on-the-road\/api[\s\\]*--filter=@on-the-road\/worker/,
  );
  assert.match(
    runEnvironment,
    /pnpm exec turbo run build[\s\\]*--filter=@on-the-road\/api[\s\\]*--filter=@on-the-road\/worker[\s\\]*--filter=@on-the-road\/web/,
  );
  assert.doesNotMatch(playwrightConfig, /start:dev/);
  assert.match(
    playwrightConfig,
    /@on-the-road\/web build && pnpm --filter @on-the-road\/web start/,
  );
});

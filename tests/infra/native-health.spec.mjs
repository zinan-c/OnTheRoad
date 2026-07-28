import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { describe, test } from "vitest";

import { combinedOutput } from "./compose-test-helpers.mjs";
import {
  createNativeHarness,
  createLiveNativeHarness,
  nativeIntegrationEnabled,
  runNative,
  temporaryNativeRoot,
} from "./native-test-helpers.mjs";

describe("TC-A02-01 native bootstrap and health", () => {
  test("preflight is deterministic and never installs missing software", async () => {
    const root = await temporaryNativeRoot("on-the-road-a02-native-preflight-");
    const harness = await createNativeHarness(root);
    const result = runNative(
      ["scripts/dev-up.sh", "--track", "native", "--dry-run"],
      harness.env,
    );
    assert.equal(result.status, 0, combinedOutput(result));
    assert.match(result.stdout, /PostgreSQL.*16\.9/);
    assert.match(result.stdout, /Redis server v=7\.2\.0/);
    assert.match(result.stdout, /preflight passed/);

    const start = await readFile(
      new URL("../../scripts/dev-up-native.sh", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(start, /\b(?:brew|apt|npm|pnpm)\s+(?:install|add)\b/);
  });

  test("missing binary fails actionably before any process starts", async () => {
    const root = await temporaryNativeRoot("on-the-road-a02-native-missing-");
    const harness = await createNativeHarness(root);
    await writeFile(
      harness.envFile,
      `${
        await readFile(harness.envFile, "utf8")
      }\nREDIS_SERVER_BIN=${root}/missing-redis-server\n`,
    );
    const result = runNative(
      ["scripts/dev-up.sh", "--track", "native", "--dry-run"],
      harness.env,
    );
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput(result), /REDIS_SERVER_BIN is not executable/);
  });

  test("shared contract is loopback-only and ClamAV is mandatory", async () => {
    const environment = await readFile(
      new URL("../../infra/local-stack.env.example", import.meta.url),
      "utf8",
    );
    for (const host of [
      "POSTGRES_HOST",
      "REDIS_HOST",
      "MINIO_HOST",
      "CLAMAV_HOST",
    ]) {
      assert.match(environment, new RegExp(`^${host}=127\\.0\\.0\\.1$`, "m"));
    }
    assert.match(environment, /^CLAMAV_REQUIRED=true$/m);
  });

  test("unsafe broad runtime targets are rejected before startup", async () => {
    const root = await temporaryNativeRoot("on-the-road-a02-native-unsafe-");
    const harness = await createNativeHarness(root);
    const result = runNative(
      ["scripts/dev-up.sh", "--track", "native", "--dry-run"],
      { ...harness.env, OTR_NATIVE_RUNTIME_DIR: "/" },
    );
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput(result), /runtime directory/);
  });

  test.skipIf(!nativeIntegrationEnabled)(
    "isolated native data directory starts idempotently and becomes ready",
    async () => {
      const root = await temporaryNativeRoot("on-the-road-a02-native-live-");
      const harness = await createLiveNativeHarness(root);
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const up = runNative(
            ["scripts/dev-up.sh", "--track", "native"],
            harness.env,
          );
          assert.equal(up.status, 0, combinedOutput(up));
        }
        const health = runNative(
          ["scripts/dev-up-health.sh", "--track", "native"],
          harness.env,
        );
        assert.equal(health.status, 0, combinedOutput(health));
        assert.match(health.stdout, /Local stack: Native Ready/);
      } finally {
        runNative(
          ["scripts/dev-down.sh", "--track", "native"],
          harness.env,
        );
      }
    },
    240_000,
  );
});

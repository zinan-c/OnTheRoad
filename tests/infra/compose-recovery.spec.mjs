import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";

import {
  combinedOutput,
  integrationEnabled,
  run,
} from "./compose-test-helpers.mjs";

describe("TC-A02-02 restart and degraded scanner", () => {
  test("persistent services restart and ClamAV is a fail-closed dependency", async () => {
    const compose = await readFile(
      new URL("../../infra/compose/docker-compose.yml", import.meta.url),
      "utf8",
    );
    for (const service of ["postgres", "redis", "minio", "clamav"]) {
      const block = compose.split(new RegExp(`^  ${service}:`, "m"))[1];
      assert.ok(block, `${service} block is missing`);
      assert.match(block.split(/^ {2}[a-z][a-z0-9-]*:/m)[0], /restart: unless-stopped/);
    }
    assert.match(compose, /CLAMAV_REQUIRED:\s*["']?true["']?/);

    const healthScript = await readFile(
      new URL("../../scripts/dev-up-compose-health.sh", import.meta.url),
      "utf8",
    );
    assert.match(healthScript, /clamdscan --ping/);
    assert.match(healthScript, /exit 1/);
  });

  test.skipIf(!integrationEnabled)(
    "data survives a service restart and scanner failure makes readiness non-zero",
    () => {
      const composeArgs = [
        "compose",
        "--env-file",
        "infra/local-stack.env",
        "-f",
        "infra/compose/docker-compose.yml",
      ];
      assert.equal(
        run("docker", [
          ...composeArgs,
          "exec",
          "-T",
          "redis",
          "redis-cli",
          "--no-auth-warning",
          "-a",
          process.env.REDIS_PASSWORD ?? "otr_local_redis_4d8b1e6c",
          "SET",
          "a02-probe",
          "kept",
        ]).status,
        0,
      );
      assert.equal(run("docker", [...composeArgs, "restart", "redis"]).status, 0);
      const retained = run("docker", [
        ...composeArgs,
        "exec",
        "-T",
        "redis",
        "redis-cli",
        "--no-auth-warning",
        "-a",
        process.env.REDIS_PASSWORD ?? "otr_local_redis_4d8b1e6c",
        "GET",
        "a02-probe",
      ]);
      assert.equal(retained.status, 0, combinedOutput(retained));
      assert.match(retained.stdout, /kept/);

      assert.equal(run("docker", [...composeArgs, "stop", "clamav"]).status, 0);
      try {
        const degraded = run("bash", [
          "scripts/dev-up-health.sh",
          "--track",
          "compose",
        ]);
        assert.notEqual(degraded.status, 0);
        assert.match(combinedOutput(degraded), /clamav.*not ready/is);
      } finally {
        const restored = run("docker", [...composeArgs, "start", "clamav"]);
        assert.equal(restored.status, 0, combinedOutput(restored));
      }
    },
    180_000,
  );
});

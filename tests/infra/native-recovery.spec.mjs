import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, test } from "vitest";

import { combinedOutput } from "./compose-test-helpers.mjs";
import {
  createLiveNativeHarness,
  createNativeHarness,
  nativeIntegrationEnabled,
  runNative,
  temporaryNativeRoot,
} from "./native-test-helpers.mjs";

describe("TC-A02-02 native recovery and scanner degradation", () => {
  test("stale PID ownership mismatch never terminates an unrelated process", async () => {
    const root = await temporaryNativeRoot("on-the-road-a02-native-stale-");
    const harness = await createNativeHarness(root);
    const sleeper = spawn("/bin/sleep", ["30"]);
    try {
      await mkdir(join(harness.runtime, "pids"), { recursive: true });
      await writeFile(
        join(harness.runtime, "pids/minio.pid"),
        `${sleeper.pid}\n${harness.runtime}/minio-data\ninvalid-start-time\n`,
      );
      const result = runNative(
        ["scripts/dev-down.sh", "--track", "native"],
        harness.env,
      );
      assert.equal(result.status, 0, combinedOutput(result));
      assert.match(combinedOutput(result), /ownership fingerprint does not match/);
      assert.equal(sleeper.exitCode, null);
    } finally {
      sleeper.kill("SIGTERM");
    }
  });

  test("native PID ownership uses untruncated commands and accepts path-shaped macOS comm", async () => {
    const { readFile } = await import("node:fs/promises");
    const common = await readFile(
      new URL("../../scripts/local-stack-common.sh", import.meta.url),
      "utf8",
    );
    assert.match(common, /ps -ww -p "\$\{pid\}" -o command=/u);
    assert.match(common, /LC_ALL=C ps -ww -axo pid=,comm=,args=/u);
    assert.match(common, /\| LC_ALL=C awk/u);
    assert.match(common, /sub\(\/\^\.\*\\\/\/, "", command\)/u);
    assert.match(common, /executable = \$3/u);
    assert.match(common, /command == name \|\| executable == name/u);
    assert.match(common, /END \{ if \(matched\) print matched \}/u);
    assert.doesNotMatch(common, /print \$1\s+exit/u);
    assert.match(
      common,
      /recorded_start=.*awk '\{\$1=\$1; print\}'/u,
    );
    assert.match(
      common,
      /start=.*ps -p "\$\{pid\}" -o lstart=.*awk '\{\$1=\$1; print\}'/u,
    );
  });

  test("health contract is fail-closed when any required probe fails", async () => {
    const { health, startup } = await import("node:fs/promises").then(
      async ({ readFile }) => ({
        health: await readFile(
        new URL("../../scripts/dev-up-native-health.sh", import.meta.url),
        "utf8",
        ),
        startup: await readFile(
          new URL("../../scripts/dev-up-native.sh", import.meta.url),
          "utf8",
        ),
      }),
    );
    assert.match(health, /check clamav clamav_ready/);
    assert.match(health, /media processing must remain fail-closed/);
    assert.match(health, /exit 1/);
    assert.match(
      startup,
      /"\$\{MC_CMD\}" version enable "otr-native\/\$\{MINIO_BUCKET\}"/u,
    );
  });

  test("environment readiness rejects a dead application child", async () => {
    const { readFile } = await import("node:fs/promises");
    const runner = await readFile(
      new URL("../../scripts/run-environment.sh", import.meta.url),
      "utf8",
    );
    assert.match(runner, /assert_children_running\(\)/u);
    assert.match(runner, /kill -0 "\$\{pids\[\$\{index\}\]\}"/u);
    assert.match(runner, /exited during startup/u);
    assert.match(
      runner,
      /if \[\[ "\$\{api_ok\}" == true[\s\S]*assert_children_running[\s\S]*environment ready/u,
    );
    assert.match(runner, /select_dev_ports\(\)/u);
    assert.match(runner, /OTR_DEV_WEB_PORT:-18100/u);
    assert.match(runner, /OTR_DEV_API_PORT:-18101/u);
    assert.match(runner, /port_is_available "\$\{candidate_web\}"/u);
    assert.match(runner, /NEXT_PUBLIC_API_ORIGIN=/u);
    assert.match(runner, /Development endpoints selected:/u);
    assert.match(runner, /application_environment=\(/u);
    assert.match(
      runner,
      /-- "\$\{application_environment\[@\]\}" pnpm run start:web/u,
    );
  });

  test.skipIf(!nativeIntegrationEnabled)(
    "preserved native data survives restart and scanner loss fails readiness",
    async () => {
      const root = await temporaryNativeRoot("on-the-road-a02-native-recovery-");
      const harness = await createLiveNativeHarness(root);
      try {
        const first = runNative(
          ["scripts/dev-up.sh", "--track", "native"],
          harness.env,
        );
        assert.equal(first.status, 0, combinedOutput(first));

        const redisSet = runNative(
          [
            "-c",
            `redis-cli -h 127.0.0.1 -p ${harness.ports.REDIS_PORT} --no-auth-warning SET a02-native kept`,
          ],
          harness.env,
        );
        assert.equal(redisSet.status, 0, combinedOutput(redisSet));
        assert.match(redisSet.stdout, /^OK$/m);
        const postgresSet = runNative(
          [
            "-c",
            `PGPASSWORD=otr_local_pg_7f3a9c2e psql -h 127.0.0.1 -p ${harness.ports.POSTGRES_PORT} -U otr_local_app -d on_the_road_local -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS a02_probe(value text); TRUNCATE a02_probe; INSERT INTO a02_probe VALUES ('kept')"`,
          ],
          harness.env,
        );
        assert.equal(postgresSet.status, 0, combinedOutput(postgresSet));
        const minioSet = runNative(
          [
            "-c",
            `mc alias set otr-native http://127.0.0.1:${harness.ports.MINIO_API_PORT} otr_local_admin otr_local_minio_6c2f9a4d >/dev/null && printf kept | mc pipe otr-native/on-the-road-local/a02-native`,
          ],
          harness.env,
        );
        assert.equal(minioSet.status, 0, combinedOutput(minioSet));
        const eicarPath = join(root, "eicar.com");
        await writeFile(
          eicarPath,
          "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
        );
        const eicar = runNative(
          [
            "-c",
            `clamdscan --config-file=${harness.runtime}/clamav/clamd.conf --no-summary ${eicarPath}`,
          ],
          harness.env,
        );
        assert.equal(eicar.status, 1, combinedOutput(eicar));
        assert.match(combinedOutput(eicar), /FOUND/);

        assert.equal(
          runNative(
            ["scripts/dev-down.sh", "--track", "native"],
            harness.env,
          ).status,
          0,
        );
        assert.equal(
          runNative(
            ["scripts/dev-up.sh", "--track", "native"],
            harness.env,
          ).status,
          0,
        );

        const redisGet = runNative(
          [
            "-c",
            `redis-cli -h 127.0.0.1 -p ${harness.ports.REDIS_PORT} --no-auth-warning GET a02-native`,
          ],
          harness.env,
        );
        assert.equal(redisGet.status, 0, combinedOutput(redisGet));
        assert.match(redisGet.stdout, /kept/);
        const postgresGet = runNative(
          [
            "-c",
            `PGPASSWORD=otr_local_pg_7f3a9c2e psql -h 127.0.0.1 -p ${harness.ports.POSTGRES_PORT} -U otr_local_app -d on_the_road_local -tAc "SELECT value FROM a02_probe"`,
          ],
          harness.env,
        );
        assert.equal(postgresGet.status, 0, combinedOutput(postgresGet));
        assert.match(postgresGet.stdout, /kept/);
        const minioGet = runNative(
          [
            "-c",
            `mc alias set otr-native http://127.0.0.1:${harness.ports.MINIO_API_PORT} otr_local_admin otr_local_minio_6c2f9a4d >/dev/null && mc cat otr-native/on-the-road-local/a02-native`,
          ],
          harness.env,
        );
        assert.equal(minioGet.status, 0, combinedOutput(minioGet));
        assert.match(minioGet.stdout, /kept/);

        const clamavPid = Number.parseInt(
          await import("node:fs/promises").then(({ readFile }) =>
            readFile(join(harness.runtime, "pids/clamav.pid"), "utf8"),
          ),
          10,
        );
        process.kill(clamavPid, "SIGTERM");
        let health;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          health = runNative(
            ["scripts/dev-up-health.sh", "--track", "native"],
            harness.env,
          );
          if (health.status !== 0) {
            break;
          }
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
        }
        assert.ok(health);
        assert.notEqual(health.status, 0);
        assert.match(combinedOutput(health), /clamav: not ready/);
      } finally {
        runNative(
          ["scripts/dev-down.sh", "--track", "native"],
          harness.env,
        );
      }
    },
    300_000,
  );
});

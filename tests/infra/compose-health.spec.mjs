import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";

import {
  combinedOutput,
  integrationEnabled,
  run,
} from "./compose-test-helpers.mjs";

describe("TC-A02-01 local stack health", () => {
  test("Compose declares four healthy, persisted, resource-bounded services", async () => {
    const compose = await readFile(
      new URL("../../infra/compose/docker-compose.yml", import.meta.url),
      "utf8",
    );
    for (const service of ["postgres", "redis", "minio", "clamav"]) {
      assert.match(compose, new RegExp(`^  ${service}:`, "m"));
    }
    assert.equal((compose.match(/healthcheck:/g) ?? []).length, 4);
    for (const volume of [
      "postgres-data",
      "redis-data",
      "minio-data",
      "clamav-signatures",
    ]) {
      assert.match(compose, new RegExp(`^  ${volume}:`, "m"));
    }
    assert.ok((compose.match(/mem_limit:/g) ?? []).length >= 4);
    assert.ok((compose.match(/cpus:/g) ?? []).length >= 4);
    assert.ok((compose.match(/no-new-privileges:true/g) ?? []).length >= 5);
    assert.match(compose, /minio-init:[\s\S]*?read_only:\s*true/u);
  });

  test("PostGIS and the object bucket are initialized idempotently", async () => {
    const sql = await readFile(
      new URL("../../infra/compose/init/postgres/001-postgis.sql", import.meta.url),
      "utf8",
    );
    const compose = await readFile(
      new URL("../../infra/compose/docker-compose.yml", import.meta.url),
      "utf8",
    );
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS postgis/i);
    assert.match(sql, /END;\s*\$\$;/i);
    assert.match(compose, /minio-init:/);
    assert.match(compose, /mb --ignore-existing/);
  });

  test("published ports are loopback-only and example credentials are non-default", async () => {
    const compose = await readFile(
      new URL("../../infra/compose/docker-compose.yml", import.meta.url),
      "utf8",
    );
    const environment = await readFile(
      new URL("../../infra/local-stack.env.example", import.meta.url),
      "utf8",
    );
    assert.equal((compose.match(/127\.0\.0\.1:/g) ?? []).length, 5);
    assert.doesNotMatch(
      environment,
      /=(?:admin|changeme|minioadmin|password|postgres|redis)$/im,
    );
    for (const variable of [
      "POSTGRES_PASSWORD",
      "REDIS_PASSWORD",
      "MINIO_ROOT_PASSWORD",
      "MINIO_BUCKET",
    ]) {
      assert.match(environment, new RegExp(`^${variable}=.+`, "m"));
    }
  });

  test("readiness checks verify PostGIS and authenticated Redis responses", async () => {
    const healthScript = await readFile(
      new URL("../../scripts/dev-up-compose-health.sh", import.meta.url),
      "utf8",
    );
    assert.match(healthScript, /grep -qx '\[\[:space:\]\]\*1/);
    assert.match(healthScript, /redis-cli --no-auth-warning -a/);
    assert.match(healthScript, /grep -qx 'PONG'/);
  });

  test.skipIf(!integrationEnabled)(
    "empty volumes expose PostGIS, Redis, MinIO bucket, and ClamAV readiness",
    () => {
      const bootstrap = run("bash", ["scripts/dev-up.sh", "--track", "compose"]);
      assert.equal(bootstrap.status, 0, combinedOutput(bootstrap));

      const health = run("bash", ["scripts/dev-up-health.sh", "--track", "compose"]);
      assert.equal(health.status, 0, combinedOutput(health));
      assert.match(health.stdout, /postgres.*ready/is);
      assert.match(health.stdout, /redis.*ready/is);
      assert.match(health.stdout, /minio.*ready/is);
      assert.match(health.stdout, /clamav.*ready/is);

      const composeArgs = [
        "compose",
        "--env-file",
        "infra/local-stack.env",
        "-f",
        "infra/compose/docker-compose.yml",
      ];
      const objectRoundTrip = run("docker", [
        ...composeArgs,
        "run",
        "--rm",
        "--no-deps",
        "minio-init",
        'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; printf a02-object | mc pipe "local/$MINIO_BUCKET/a02-probe"; test "$(mc cat "local/$MINIO_BUCKET/a02-probe")" = a02-object',
      ]);
      assert.equal(objectRoundTrip.status, 0, combinedOutput(objectRoundTrip));

      const eicar = run("docker", [
        ...composeArgs,
        "exec",
        "-T",
        "clamav",
        "sh",
        "-ec",
        "printf '%s' 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' >/tmp/a02-eicar.com; clamdscan --no-summary /tmp/a02-eicar.com",
      ]);
      assert.equal(eicar.status, 1, combinedOutput(eicar));
      assert.match(combinedOutput(eicar), /FOUND/);
    },
    180_000,
  );
});

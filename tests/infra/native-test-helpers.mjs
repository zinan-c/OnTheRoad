import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./compose-test-helpers.mjs";

export const nativeIntegrationEnabled =
  process.env.RUN_NATIVE_INTEGRATION === "1";

export async function createNativeHarness(root) {
  const bin = join(root, "bin");
  const shared = join(root, "postgres-share");
  const clamavDatabase = join(root, "clamav-database");
  const envFile = join(root, "local-stack.env");
  const runtime = join(root, "runtime");
  await mkdir(join(shared, "extension"), { recursive: true });
  await mkdir(clamavDatabase, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(shared, "extension/postgis.control"), "comment = 'test'\n");
  await writeFile(join(clamavDatabase, "daily.cvd"), "test signature fixture\n");

  const stubs = new Map([
    ["postgres", "printf 'postgres (PostgreSQL) 16.9\\n'"],
    ["redis-server", "printf 'Redis server v=7.2.0\\n'"],
    ["minio", "printf 'minio version RELEASE.2026-01-01T00-00-00Z\\n'"],
    ["clamd", "printf 'ClamAV 1.4.3\\n'"],
    ["pg_config", `printf '%s\\n' '${shared}'`],
    ["initdb", "exit 0"],
    ["pg_ctl", "exit 0"],
    ["createdb", "exit 0"],
    ["psql", "exit 0"],
    ["redis-cli", "exit 0"],
    ["mc", "printf 'mc version RELEASE.2026-01-01T00-00-00Z\\n'"],
    ["clamdscan", "exit 0"],
    ["clamscan", "printf 'ClamAV 1.4.3\\n'"],
  ]);
  for (const [name, body] of stubs) {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
  }

  const example = await readFile(
    new URL("../../infra/local-stack.env.example", import.meta.url),
    "utf8",
  );
  await writeFile(
    envFile,
    `${example}\nCLAMAV_DATABASE_DIR=${clamavDatabase}\n`,
  );
  return {
    bin,
    envFile,
    runtime,
    env: {
      ...process.env,
      OTR_LOCAL_STACK_ENV: envFile,
      OTR_NATIVE_RUNTIME_DIR: runtime,
      PATH: `${bin}:/usr/bin:/bin`,
    },
  };
}

export async function copyNativeEnv(target) {
  await copyFile(
    new URL("../../infra/local-stack.env.example", import.meta.url),
    target,
  );
}

export async function createLiveNativeHarness(root) {
  const envFile = join(root, "local-stack.env");
  const runtime = join(root, "runtime");
  let example = await readFile(
    new URL("../../infra/local-stack.env.example", import.meta.url),
    "utf8",
  );
  const ports = {
    POSTGRES_PORT: "15432",
    REDIS_PORT: "16379",
    MINIO_API_PORT: "19000",
    MINIO_CONSOLE_PORT: "19001",
    CLAMAV_PORT: "13310",
  };
  for (const [name, port] of Object.entries(ports)) {
    example = example.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${port}`);
  }
  example = example
    .replaceAll(":5432/", ":15432/")
    .replaceAll(":6379/", ":16379/")
    .replaceAll(":9000", ":19000");
  const signatureDirectory =
    process.env.NATIVE_TEST_CLAMAV_DATABASE_DIR ?? "";
  example += `\nCLAMAV_DATABASE_DIR=${signatureDirectory}\n`;
  await writeFile(envFile, example);
  return {
    envFile,
    runtime,
    env: {
      ...process.env,
      OTR_LOCAL_STACK_ENV: envFile,
      OTR_NATIVE_RUNTIME_DIR: runtime,
      MC_CONFIG_DIR: join(runtime, "mc"),
      REDISCLI_AUTH: "otr_local_redis_4d8b1e6c",
    },
    ports,
  };
}

export function runNative(args, env) {
  return run("bash", args, { env });
}

export async function temporaryNativeRoot(prefix) {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), prefix));
}

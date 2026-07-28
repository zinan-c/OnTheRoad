import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "vitest";

import {
  combinedOutput,
  integrationEnabled,
  run,
} from "./compose-test-helpers.mjs";

async function isolatedBootstrap() {
  const root = await mkdtemp(join(tmpdir(), "on-the-road-a02-"));
  await cp(new URL("../../scripts/dev-up.sh", import.meta.url), join(root, "scripts/dev-up.sh"), {
    recursive: true,
  });
  await cp(
    new URL("../../scripts/dev-up-compose.sh", import.meta.url),
    join(root, "scripts/dev-up-compose.sh"),
    { recursive: true },
  );
  await cp(
    new URL("../../scripts/local-stack-common.sh", import.meta.url),
    join(root, "scripts/local-stack-common.sh"),
    { recursive: true },
  );
  await cp(
    new URL("../../scripts/dev-up-health.sh", import.meta.url),
    join(root, "scripts/dev-up-health.sh"),
    { recursive: true },
  );
  await cp(
    new URL("../../infra/compose/", import.meta.url),
    join(root, "infra/compose"),
    { recursive: true },
  );
  await cp(
    new URL("../../infra/local-stack.env.example", import.meta.url),
    join(root, "infra/local-stack.env.example"),
  );
  return root;
}

describe("TC-A02-03 one-command bootstrap", () => {
  test("dry-run bootstraps local config and is idempotent", async () => {
    const root = await isolatedBootstrap();
    const first = run(
      "bash",
      ["scripts/dev-up.sh", "--track", "compose", "--dry-run"],
      { cwd: root },
    );
    assert.equal(first.status, 0, combinedOutput(first));
    assert.match(first.stdout, /Created infra\/local-stack\.env/);
    assert.match(first.stdout, /up -d --wait postgres redis minio clamav/);

    const envPath = join(root, "infra/local-stack.env");
    const firstEnv = await readFile(envPath, "utf8");
    assert.ok((await stat(envPath)).isFile());

    const second = run(
      "bash",
      ["scripts/dev-up.sh", "--track", "compose", "--dry-run"],
      { cwd: root },
    );
    assert.equal(second.status, 0, combinedOutput(second));
    assert.doesNotMatch(second.stdout, /Created infra\/compose\/\.env/);
    assert.equal(await readFile(envPath, "utf8"), firstEnv);
    assert.equal(
      second.stdout,
      first.stdout.replace("Created infra/local-stack.env from the local-only example.\n", ""),
    );
  });

  test("missing Compose reports an actionable failure", async () => {
    const root = await isolatedBootstrap();
    const fakeBin = join(root, "test-bin");
    await mkdir(fakeBin);
    await writeFile(join(fakeBin, "docker"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
    const result = run("bash", ["scripts/dev-up.sh", "--track", "compose"], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });
    assert.equal(result.status, 3, combinedOutput(result));
    assert.match(combinedOutput(result), /Docker CLI is missing|Compose v2 is required/);
  });

  test.skipIf(!integrationEnabled)(
    "running bootstrap twice preserves data and does not duplicate initialization",
    () => {
      const first = run("bash", ["scripts/dev-up.sh", "--track", "compose"]);
      assert.equal(first.status, 0, combinedOutput(first));
      const second = run("bash", ["scripts/dev-up.sh", "--track", "compose"]);
      assert.equal(second.status, 0, combinedOutput(second));
      assert.match(second.stdout, /Local stack: ready/);
    },
    240_000,
  );
});

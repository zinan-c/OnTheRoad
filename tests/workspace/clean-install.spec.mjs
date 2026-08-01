import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

const rootPath = new URL("../../", import.meta.url).pathname;
const ignored = new Set([
  ".git",
  ".cache",
  ".next",
  ".pnpm-store",
  ".turbo",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function isIgnoredPath(path, directory) {
  const repositoryPath = relative(directory, path);
  const parts = repositoryPath.split("/");
  if (parts.some((segment) => ignored.has(segment))) return true;
  if (repositoryPath.endsWith(".tsbuildinfo")) return true;
  return /^(apps|packages|spikes)\/[^/]+\/dist(?:\/|$)/.test(
    repositoryPath,
  );
}

async function sourceDigest(directory) {
  const snapshot = await sourceSnapshot(directory);
  const hash = createHash("sha256");
  for (const [path, digest] of snapshot) {
    hash.update(path);
    hash.update(digest);
  }
  return hash.digest("hex");
}

async function sourceSnapshot(directory) {
  const snapshot = new Map();
  async function visit(path) {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) {
        const child = join(path, entry);
        if (!isIgnoredPath(child, directory)) await visit(child);
      }
      return;
    }
    snapshot.set(
      relative(directory, path),
      createHash("sha256").update(await readFile(path)).digest("hex"),
    );
  }
  await visit(directory);
  return snapshot;
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

test("source digest ignores generated outputs but detects source changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "on-the-road-a01-digest-"));
  try {
    await mkdir(join(directory, "apps/web/src"), { recursive: true });
    await mkdir(join(directory, "apps/web/.next"), { recursive: true });
    await mkdir(join(directory, "apps/web/test-results"), { recursive: true });
    await writeFile(join(directory, "apps/web/src/page.tsx"), "export default 1;\n");
    await writeFile(join(directory, "apps/web/.next/trace"), "first build\n");
    await writeFile(join(directory, "apps/web/tsconfig.tsbuildinfo"), "first build\n");
    await writeFile(
      join(directory, "apps/web/test-results/results.json"),
      '{"status":"first"}\n',
    );

    const initial = await sourceDigest(directory);
    await writeFile(join(directory, "apps/web/.next/trace"), "second build\n");
    await writeFile(join(directory, "apps/web/tsconfig.tsbuildinfo"), "second build\n");
    await writeFile(
      join(directory, "apps/web/test-results/results.json"),
      '{"status":"second"}\n',
    );
    assert.equal(await sourceDigest(directory), initial);

    await writeFile(join(directory, "apps/web/src/page.tsx"), "export default 2;\n");
    assert.notEqual(await sourceDigest(directory), initial);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "TC-A01-03 clean checkout installs and runs every quality command",
  async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "on-the-road-a01-"));
    const checkout = join(temporaryRoot, "checkout");
    try {
      await cp(rootPath, checkout, {
        recursive: true,
        filter: (source) => !isIgnoredPath(source, rootPath),
      });
      const before = await sourceSnapshot(checkout);
      const environment = { ...process.env };

      const install = spawnSync(
        "pnpm",
        ["install", "--frozen-lockfile"],
        { cwd: checkout, encoding: "utf8", env: environment },
      );
      assert.equal(install.status, 0, `${install.stdout}${install.stderr}`);

      const quality = spawnSync("pnpm", ["run", "quality"], {
        cwd: checkout,
        encoding: "utf8",
        env: environment,
      });
      assert.equal(quality.status, 0, `${quality.stdout}${quality.stderr}`);
      const after = await sourceSnapshot(checkout);
      assert.deepEqual(
        changedPaths(before, after),
        [],
        "quality tasks changed source files",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
  240_000,
);

test("TC-A01-03 CI exposes stable required check names on Node 24", async () => {
  const workflow = await readFile(
    join(rootPath, ".github/workflows/ci_quality_related.yml"),
    "utf8",
  );
  assert.match(workflow, /node-version-file: \.nvmrc/);
  for (const check of ["lint", "typecheck", "unit", "build"]) {
    assert.match(workflow, new RegExp(`matrix:\\s*[\\s\\S]*${check}`));
  }
  assert.match(workflow, /name: "CI-Quality Related \/ clean-install"/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /git diff --exit-code/);
});

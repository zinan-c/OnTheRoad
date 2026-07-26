import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

const rootPath = new URL("../../", import.meta.url).pathname;
const ignored = new Set([
  ".git",
  ".pnpm-store",
  ".turbo",
  "coverage",
  "node_modules",
]);

function isIgnoredPath(path, directory) {
  const parts = relative(directory, path).split("/");
  if (parts.some((segment) => ignored.has(segment))) return true;
  return /^(apps|packages|spikes)\/[^/]+\/dist(?:\/|$)/.test(
    relative(directory, path),
  );
}

async function sourceDigest(directory) {
  const hash = createHash("sha256");
  async function visit(path) {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) {
        const child = join(path, entry);
        if (!isIgnoredPath(child, directory)) await visit(child);
      }
      return;
    }
    hash.update(relative(directory, path));
    hash.update(await readFile(path));
  }
  await visit(directory);
  return hash.digest("hex");
}

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
      const before = await sourceDigest(checkout);
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
      assert.equal(
        await sourceDigest(checkout),
        before,
        "quality tasks changed source files",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
  240_000,
);

test("TC-A01-03 CI exposes stable required check names on Node 24", async () => {
  const workflow = await readFile(join(rootPath, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /node-version-file: \.nvmrc/);
  for (const check of ["lint", "typecheck", "unit", "build"]) {
    assert.match(workflow, new RegExp(`matrix:\\s*[\\s\\S]*${check}`));
  }
  assert.match(workflow, /name: quality \/ clean-install/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /git diff --exit-code/);
});

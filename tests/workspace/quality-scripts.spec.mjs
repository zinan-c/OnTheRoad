import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);
const requiredTasks = ["lint", "typecheck", "unit", "build"];

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8"));
}

async function workspacePackages() {
  const packages = [];
  for (const group of ["apps", "packages", "spikes"]) {
    for (const entry of await readdir(new URL(`${group}/`, root), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${group}/${entry.name}/package.json`;
      try {
        packages.push({ relativePath, manifest: await readJson(relativePath) });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return packages;
}

test("TC-A01-01 workspace quality commands cover every package", async () => {
  const rootManifest = await readJson("package.json");
  for (const task of requiredTasks) {
    assert.equal(
      typeof rootManifest.scripts?.[task],
      "string",
      `root script ${task} is required`,
    );
  }

  const workspaces = await workspacePackages();
  assert.ok(workspaces.length >= 2, "at least one app and shared package are required");
  for (const workspace of workspaces) {
    const unitCommand =
      workspace.manifest.scripts?.unit;
    assert.equal(
      typeof unitCommand,
      "string",
      `${workspace.relativePath} must define a unit or test command`,
    );
    for (const task of requiredTasks) {
      const command = workspace.manifest.scripts?.[task];
      assert.equal(typeof command, "string", `${workspace.relativePath} needs ${task}`);
      assert.doesNotMatch(
        command,
        /\b(skip|noop|no tests?)\b/i,
        `${workspace.relativePath} cannot use an empty placeholder`,
      );
    }
  }
});

test(
  "TC-A01-01 a failed workspace makes the Turbo aggregate task fail",
  async () => {
    const intentionalError = new URL(
      "../../apps/api/src/tc-a01-aggregate-error.ts",
      import.meta.url,
    );
    await writeFile(intentionalError, 'export const count: number = "wrong";\n');
    try {
      const result = spawnSync("pnpm", ["run", "typecheck"], {
        cwd: root,
        encoding: "utf8",
        env: process.env,
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}${result.stderr}`, /@on-the-road\/api#typecheck/i);
      assert.match(`${result.stdout}${result.stderr}`, /not assignable to type 'number'/i);
    } finally {
      await rm(intentionalError, { force: true });
    }
  },
  30_000,
);

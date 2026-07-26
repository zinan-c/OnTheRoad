import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);

function guard(nodeVersion, pnpmVersion) {
  return spawnSync(process.execPath, ["scripts/check-toolchain.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TOOLCHAIN_NODE_VERSION_OVERRIDE: nodeVersion,
      TOOLCHAIN_PNPM_VERSION_OVERRIDE: pnpmVersion,
    },
  });
}

test("TC-A01-02 wrong Node version fails fast with an actionable error", () => {
  const result = guard("23.11.0", "9.15.4");
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Node 24.*received 23\.11\.0/i);
});

test("TC-A01-02 wrong pnpm version fails fast with an actionable error", () => {
  const result = guard("24.11.1", "8.15.0");
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /pnpm 9\.15\.4.*received 8\.15\.0/i);
});

test("TC-A01-02 a cached success cannot hide a later typecheck failure", () => {
  const clean = spawnSync(
    process.execPath,
    ["node_modules/turbo/bin/turbo", "run", "typecheck", "--filter=@on-the-road/api"],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    },
  );
  assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`);

  const intentionalError = new URL(
    "../../apps/api/src/tc-a01-intentional-error.ts",
    import.meta.url,
  );
  writeFileSync(
    intentionalError,
    'export const shouldBeNumber: number = "wrong";\n',
  );
  try {
    const broken = spawnSync(
      process.execPath,
      ["node_modules/turbo/bin/turbo", "run", "typecheck", "--filter=@on-the-road/api"],
      {
        cwd: root,
        encoding: "utf8",
        env: process.env,
      },
    );
    assert.notEqual(broken.status, 0);
    assert.match(`${broken.stdout}${broken.stderr}`, /not assignable to type 'number'/i);
  } finally {
    rmSync(intentionalError, { force: true });
  }
});

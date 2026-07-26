import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { test } from "vitest";

const root = new URL("../../", import.meta.url);
const packageName = process.env.npm_package_name;
const require = createRequire(import.meta.url);

function compatibilityEnvironment() {
  const environment = { ...process.env };
  if (packageName !== "@on-the-road/pdf-spike" || environment.OTR_A11_CHROMIUM_PATH) {
    return environment;
  }
  const { chromium } = require("@playwright/test");
  const expected = chromium.executablePath();
  if (existsSync(expected)) return environment;
  let expectedBrowserDir = dirname(expected);
  while (
    !basename(expectedBrowserDir).startsWith("chromium-") &&
    dirname(expectedBrowserDir) !== expectedBrowserDir
  ) {
    expectedBrowserDir = dirname(expectedBrowserDir);
  }
  const cacheRoot = dirname(expectedBrowserDir);
  const suffix = relative(expectedBrowserDir, expected);
  for (const directory of readdirSync(cacheRoot).filter((name) => name.startsWith("chromium-"))) {
    const candidate = join(cacheRoot, directory, suffix);
    if (existsSync(candidate)) {
      environment.OTR_A11_CHROMIUM_PATH = candidate;
      break;
    }
  }
  return environment;
}

function suiteArguments() {
  if (packageName === "@on-the-road/test-fixtures") {
    return [
      "--test",
      ...readdirSync(new URL("../../packages/test-fixtures/test/", import.meta.url))
        .filter((name) => name.endsWith(".spec.mjs"))
        .map((name) => `packages/test-fixtures/test/${name}`),
    ];
  }
  if (packageName === "@on-the-road/importer-spike") {
    return [
      "--test",
      ...readdirSync(new URL("../../spikes/importer/", import.meta.url))
        .filter((name) => name.endsWith(".spec.mjs"))
        .map((name) => `spikes/importer/${name}`),
    ];
  }
  if (packageName === "@on-the-road/pdf-spike") {
    return [
      "--experimental-strip-types",
      "--test",
      "spikes/pdf/cjk-pagination.spec.ts",
      "spikes/pdf/toc-and-resource.spec.ts",
    ];
  }
  throw new Error(`No node:test compatibility suite registered for ${packageName}`);
}

test(
  `legacy node:test cases execute under the real Vitest task for ${packageName}`,
  () => {
    const result = spawnSync(process.execPath, suiteArguments(), {
      cwd: root,
      encoding: "utf8",
      env: compatibilityEnvironment(),
      timeout: 180_000,
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /pass [1-9]|tests [1-9]/i);
  },
  190_000,
);

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertOfflineAssetReferences,
  FIXTURE_PACKAGE_PATH,
  generateFixtures,
  hashFixtureTree,
  loadAssetManifest,
} from "../src/index.mjs";

test("TC-A12-02 fixture assets are offline and deterministically generated", async () => {
  const firstDir = await mkdtemp(join(tmpdir(), "otr-fixture-a-"));
  const secondDir = await mkdtemp(join(tmpdir(), "otr-fixture-b-"));

  await generateFixtures(firstDir);
  await generateFixtures(secondDir);

  assert.equal(await hashFixtureTree(firstDir), await hashFixtureTree(secondDir));
  assert.deepEqual(
    JSON.parse(await readFile(join(firstDir, "manifest.json"), "utf8")),
    JSON.parse(await readFile(join(secondDir, "manifest.json"), "utf8")),
  );

  const manifest = await loadAssetManifest();
  assert.deepEqual(await assertOfflineAssetReferences(manifest), []);
  assert.match(manifest.treeSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.treeSha256, await hashFixtureTree(FIXTURE_PACKAGE_PATH));
  for (const [relativePath, expectedHash] of Object.entries(manifest.assets)) {
    const actualHash = createHash("sha256")
      .update(await readFile(join(FIXTURE_PACKAGE_PATH, relativePath)))
      .digest("hex");
    assert.equal(actualHash, expectedHash, `hash mismatch: ${relativePath}`);
  }
});

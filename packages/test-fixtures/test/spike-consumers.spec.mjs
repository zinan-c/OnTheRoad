import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeImporterFixture,
  consumeMapFixture,
  consumePdfTextFixture,
  consumeProviderFixture,
  FIXTURE_PACKAGE_PATH,
} from "../src/index.mjs";

test("TC-A12-03 Provider Map Importer and PDF consume one fixture version", async () => {
  const outputs = await Promise.all([
    consumeProviderFixture(FIXTURE_PACKAGE_PATH),
    consumeMapFixture(FIXTURE_PACKAGE_PATH),
    consumeImporterFixture(FIXTURE_PACKAGE_PATH),
    consumePdfTextFixture(FIXTURE_PACKAGE_PATH),
  ]);

  assert.deepEqual(
    outputs.map(({ consumer }) => consumer).sort(),
    ["importer", "map", "pdf", "provider"],
  );
  assert.deepEqual(new Set(outputs.map(({ fixtureVersion }) => fixtureVersion)), new Set(["minimal-five-day@1"]));

  const provider = outputs.find(({ consumer }) => consumer === "provider");
  const map = outputs.find(({ consumer }) => consumer === "map");
  const importer = outputs.find(({ consumer }) => consumer === "importer");
  const pdf = outputs.find(({ consumer }) => consumer === "pdf");

  assert.ok(provider.locations.length >= 5);
  assert.ok(provider.routes.length >= 4);
  assert.equal(map.featureCount, provider.locations.length + provider.routes.length);
  assert.deepEqual(new Set(Object.values(importer.formatVersions)), new Set(["minimal-five-day@1"]));
  assert.equal(pdf.pageCount, 50);
  assert.equal(pdf.containsChinese, true);
});

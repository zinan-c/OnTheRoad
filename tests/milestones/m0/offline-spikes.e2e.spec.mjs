import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

import providerReport from "../../../spikes/provider/reports/A08.json" with { type: "json" };
import mapReport from "../../../spikes/maplibre/reports/A09.json" with { type: "json" };
import importerReport from "../../../spikes/importer/reports/A10.json" with { type: "json" };
import pdfReport from "../../../spikes/pdf/reports/A11.json" with { type: "json" };
import fixture from "../../../packages/test-fixtures/src/trips/minimal-five-day.json" with { type: "json" };

const reports = [providerReport, mapReport, importerReport, pdfReport];
const root = new URL("../../../", import.meta.url);

async function sha256(relativePath) {
  return createHash("sha256")
    .update(await readFile(new URL(relativePath, root)))
    .digest("hex");
}

test("TC-M0-INT-01 shared fixture produces complete offline spike evidence", async () => {
  assert.equal(fixture.fixtureVersion, "minimal-five-day@1");
  assert.deepEqual(
    reports.map((report) => report.fixtureVersion),
    Array.from({ length: 4 }, () => fixture.fixtureVersion),
  );
  for (const report of reports) {
    assert.ok(
      Object.values(report.cases).every((result) => result === "passed"),
      `${report.taskId} contains an incomplete case`,
    );
  }

  assert.match(providerReport.evidenceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    await sha256("spikes/maplibre/evidence/map-styles.png"),
    mapReport.evidence.screenshotSha256,
  );
  assert.equal(importerReport.measurements.repetitions, 8);
  assert.equal(
    (await readFile(
      new URL("spikes/pdf/artifacts/a11-visual/per-page-evidence.json", root),
      "utf8",
    )).includes('"pageCount": 50'),
    true,
  );

  for (const report of reports) {
    assert.match(
      report.environment.network ?? report.environment.ciNetwork,
      /disabled/u,
      `${report.taskId} evidence must be offline-capable`,
    );
  }
});

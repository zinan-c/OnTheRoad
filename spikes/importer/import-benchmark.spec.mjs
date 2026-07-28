import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runBenchmark } from "./src/benchmark.mjs";

test("TC-A10-03 measures 5000-row parsing and preserves the fixed-environment decision", () => {
  const report = runBenchmark({ rowCount: 5_000, repetitions: 3 });
  assert.equal(report.rowCount, 5_000);
  assert.deepEqual(Object.keys(report.formats).sort(), ["csv", "xls", "xlsx"]);
  assert.ok(report.planB.includes("Apache POI"));
  for (const format of Object.values(report.formats)) {
    assert.equal(format.repetitions, 3);
    assert.ok(Number.isFinite(format.p95Ms));
  }
  assert.ok(Number.isFinite(report.maxRssBytes));
  const withinThresholds = Object.values(report.formats).every(
    ({ p95Ms }) => p95Ms <= report.thresholds.maxP95MsPerFormat,
  ) && report.maxRssBytes <= report.thresholds.maxRssBytes;
  assert.equal(report.conclusion, withinThresholds ? "GO" : "NO-GO");

  const candidateEvidence = JSON.parse(
    readFileSync(new URL("./reports/A10.json", import.meta.url), "utf8"),
  );
  assert.match(candidateEvidence.environment.node, /^v24\./u);
  assert.deepEqual(candidateEvidence.engine, {
    name: "SheetJS",
    version: "0.20.3",
    tarballSha256: "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
  });
  assert.deepEqual(candidateEvidence.thresholds, {
    maxRows: 5_000,
    maxP95MsPerFormat: 2_000,
    maxRssBytes: 384 * 1024 * 1024,
    workerHeapLimitMb: 256,
    workerTimeoutMs: 10_000,
  });
  assert.ok(candidateEvidence.measurements.maxRssBytes <= candidateEvidence.thresholds.maxRssBytes);
  assert.equal(candidateEvidence.conclusion, "GO for SheetJS 0.20.3 under the frozen M0 whitelist");
});

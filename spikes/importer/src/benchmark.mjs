import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { XLSX } from "./importer.mjs";

const COLUMNS = ["fixtureVersion", "day", "date", "title", "longitude", "latitude", "crs"];

function benchmarkRows(count) {
  return Array.from({ length: count }, (_, index) => [
    "benchmark-five-thousand@1",
    (index % 5) + 1,
    `2026-10-${String((index % 5) + 1).padStart(2, "0")}`,
    `Item ${String(index + 1).padStart(5, "0")}`,
    121.4 + (index % 997) / 100_000,
    30.9 + (index % 991) / 100_000,
    "WGS84",
  ]);
}

function workbookFixtures(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]), "Itinerary");
  workbook.Props = {
    Title: "A10 5000 row benchmark",
    Author: "On The Road",
    CreatedDate: new Date("2026-07-26T00:00:00.000Z"),
  };
  return {
    csv: XLSX.write(workbook, { type: "buffer", bookType: "csv" }),
    xls: XLSX.write(workbook, { type: "buffer", bookType: "biff8", bookSST: true }),
    xlsx: XLSX.write(workbook, { type: "buffer", bookType: "xlsx", bookSST: true, compression: true }),
  };
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

export function runBenchmark({ rowCount = 5_000, repetitions = 5 } = {}) {
  const rows = benchmarkRows(rowCount);
  const fixtures = workbookFixtures(rows);
  const formats = {};
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "otr-a10-benchmark-"));
  let maxRssBytes = 0;
  try {
    for (const [format, buffer] of Object.entries(fixtures)) {
      const fixturePath = join(fixtureDirectory, `benchmark.${format}`);
      writeFileSync(fixturePath, buffer);
      const child = spawnSync(process.execPath, [
        "--max-old-space-size=256",
        new URL("../scripts/benchmark-worker.mjs", import.meta.url).pathname,
        fixturePath,
        format,
        String(repetitions),
        String(rowCount),
      ], { encoding: "utf8", maxBuffer: 1024 * 1024 });
      if (child.status !== 0) throw new Error(child.stderr || child.stdout || `${format} benchmark worker failed`);
      const measurement = JSON.parse(child.stdout);
      maxRssBytes = Math.max(maxRssBytes, measurement.maxRssBytes);
      formats[format] = {
        bytes: buffer.length,
        repetitions,
        minMs: Number(Math.min(...measurement.timings).toFixed(3)),
        medianMs: Number(percentile(measurement.timings, 0.5).toFixed(3)),
        p95Ms: Number(percentile(measurement.timings, 0.95).toFixed(3)),
        maxMs: Number(Math.max(...measurement.timings).toFixed(3)),
      };
    }
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
  const thresholds = {
    maxP95MsPerFormat: 2_000,
    maxRssBytes: 384 * 1024 * 1024,
    maxRows: 5_000,
    workerHeapLimitMb: 256,
    workerTimeoutMs: 10_000,
  };
  const go = Object.values(formats).every(({ p95Ms }) => p95Ms <= thresholds.maxP95MsPerFormat)
    && maxRssBytes <= thresholds.maxRssBytes;
  return {
    caseId: "TC-A10-03",
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    rowCount,
    formats,
    maxRssBytes,
    thresholds,
    conclusion: go ? "GO" : "NO-GO",
    planB: "Use Apache POI in an isolated Spring Batch worker with the same row, byte and timeout limits.",
  };
}

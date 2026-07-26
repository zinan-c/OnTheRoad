import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { parseWorkbook } from "../src/importer.mjs";

const [fixturePath, format, repetitionsText, rowCountText] = process.argv.slice(2);
const repetitions = Number(repetitionsText);
const rowCount = Number(rowCountText);
const input = readFileSync(fixturePath);
const timings = [];
for (let iteration = 0; iteration < repetitions; iteration += 1) {
  const start = performance.now();
  const parsed = parseWorkbook(input, { fileName: `benchmark.${format}` });
  timings.push(performance.now() - start);
  if (parsed.sheets[0].rows.length !== rowCount) throw new Error(`${format} row count mismatch`);
}
process.stdout.write(JSON.stringify({
  timings,
  maxRssBytes: process.resourceUsage().maxRSS * 1024,
}));

import { runBenchmark } from "../src/benchmark.mjs";

const report = runBenchmark({ rowCount: 5_000, repetitions: 8 });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.conclusion !== "GO") process.exitCode = 1;

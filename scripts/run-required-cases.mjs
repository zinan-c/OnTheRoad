import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  summarizeVitestResult,
  verifyRequiredCases,
} from "./required-cases-lib.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const verification = await verifyRequiredCases(root);
if (!verification.valid) {
  console.error("Required-case consistency verification failed.");
  for (const caseId of verification.missingTestFiles) console.error(`not collected: ${caseId}`);
  process.exit(1);
}

const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "otr-required-cases-"));
const vitestOutput = resolve(temporaryDirectory, "vitest.json");
let vitestRun;
let nodeRun;
let vitestResult;
try {
  vitestRun = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "vitest",
      "run",
      ...verification.vitestTestFiles,
      "--root",
      ".",
      "--reporter=json",
      `--outputFile=${vitestOutput}`,
      "--no-file-parallelism",
      "--maxWorkers=1",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (vitestRun.error) throw vitestRun.error;
  if (vitestRun.stderr) process.stderr.write(vitestRun.stderr);
  vitestResult = JSON.parse(await readFile(vitestOutput, "utf8"));

  nodeRun = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "--test-reporter=tap",
      "--test-concurrency=1",
      ...verification.nodeTestFiles,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (nodeRun.error) throw nodeRun.error;
  if (nodeRun.stderr) process.stderr.write(nodeRun.stderr);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

vitestResult.testResults.push({
  assertionResults: parseNodeTestAssertions(nodeRun.stdout),
});
const summary = summarizeVitestResult(verification.requiredCaseIds, vitestResult);
const report = {
  schemaVersion: 1,
  scope: verification.manifest.scope,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? process.env.OTR_COMMIT_SHA ?? null,
  node: process.version,
  counts: {
    expected: summary.expected,
    collected: summary.collected,
    executed: summary.executed,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    notCollected: summary.notCollected,
  },
  cases: summary.cases,
};
console.log(JSON.stringify(report.counts));
for (const entry of summary.cases.filter(({ status }) => status !== "passed")) {
  console.error(`${entry.caseId}: ${entry.status} (${entry.assertions} assertions)`);
}

const reportPath = process.env.OTR_REQUIRED_CASE_REPORT;
if (reportPath) {
  const absoluteReportPath = resolve(root, reportPath);
  await mkdir(dirname(absoluteReportPath), { recursive: true });
  await writeFile(absoluteReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (
  vitestRun.status !== 0
  || nodeRun.status !== 0
  || summary.failed > 0
  || summary.skipped > 0
  || summary.notCollected > 0
  || summary.passed !== summary.expected
) {
  process.exitCode = 1;
}

function parseNodeTestAssertions(output) {
  const assertions = [];
  const pattern = /^(not )?ok \d+ - (TC-(?:[A-Z]\d{2}|M\d-INT)-\d{2})[^#\n]*(?: # (SKIP|TODO)[^\n]*)?$/gmu;
  for (const match of output.matchAll(pattern)) {
    assertions.push({
      fullName: match[0],
      status: match[3]
        ? match[3].toLowerCase() === "todo" ? "todo" : "pending"
        : match[1] ? "failed" : "passed",
    });
  }
  return assertions;
}

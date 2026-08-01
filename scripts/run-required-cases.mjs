import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  collectVitestFailureDiagnostics,
  summarizeVitestResult,
  verifyRequiredCases,
} from "./required-cases-lib.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const reportPath = process.env.OTR_REQUIRED_CASE_REPORT
  ? resolve(root, process.env.OTR_REQUIRED_CASE_REPORT)
  : undefined;
let temporaryDirectory;
let vitestRun;
let nodeRun;
let playwrightRun;
let report = baseReport("running", []);
try {
  await persistReport(report);
  const verification = await verifyRequiredCases(root);
  report = baseReport("running", verification.requiredCaseIds);
  if (!verification.valid) {
    console.error("Required-case consistency verification failed.");
    for (const caseId of verification.missingTestFiles) {
      console.error(`not collected: ${caseId}`);
    }
    report.status = "configuration-error";
    report.error = {
      name: "RequiredCaseConsistencyError",
      message: "Required-case documentation and executable tests are inconsistent.",
    };
    process.exitCode = 1;
    throw new Error(report.error.message);
  }

  const prerequisiteBuild = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["run", "build"],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (prerequisiteBuild.error) throw prerequisiteBuild.error;
  if (prerequisiteBuild.status !== 0) {
    process.stderr.write(`${prerequisiteBuild.stdout ?? ""}${prerequisiteBuild.stderr ?? ""}`);
    throw new Error(
      `Required-case prerequisite build failed with exit code ${prerequisiteBuild.status}.`,
    );
  }

  temporaryDirectory = await mkdtemp(resolve(tmpdir(), "otr-required-cases-"));
  const vitestOutput = resolve(temporaryDirectory, "vitest.json");
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
  const vitestResult = JSON.parse(await readFile(vitestOutput, "utf8"));

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

  playwrightRun = verification.playwrightTestFiles.length === 0
    ? { status: 0, stdout: "", stderr: "" }
    : spawnSync(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        [
          "exec",
          "playwright",
          "test",
          ...verification.playwrightTestFiles,
          "--config=apps/web/playwright.config.ts",
          "--reporter=line",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: process.env,
          maxBuffer: 64 * 1024 * 1024,
        },
      );
  if (playwrightRun.error) throw playwrightRun.error;

  vitestResult.testResults.push({
    assertionResults: parseNodeTestAssertions(nodeRun.stdout ?? ""),
  });
  const summary = summarizeVitestResult(verification.requiredCaseIds, vitestResult);
  const vitestFailures = collectVitestFailureDiagnostics(root, vitestResult);
  report = {
    ...baseReport("failed", verification.requiredCaseIds),
    scope: verification.manifest.scope,
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
    diagnostics: {
      vitest: {
        exitCode: vitestRun.status,
        failedFiles: vitestFailures,
      },
      nodeTest: {
        exitCode: nodeRun.status,
        ...(nodeRun.status === 0
          ? {}
          : { output: truncateOutput(`${nodeRun.stdout ?? ""}${nodeRun.stderr ?? ""}`) }),
      },
      playwright: {
        exitCode: playwrightRun.status,
        ...(playwrightRun.status === 0
          ? {}
          : {
              output: truncateOutput(
                `${playwrightRun.stdout ?? ""}${playwrightRun.stderr ?? ""}`,
              ),
            }),
      },
    },
  };
  const passed = vitestRun.status === 0
    && nodeRun.status === 0
    && playwrightRun.status === 0
    && summary.failed === 0
    && summary.skipped === 0
    && summary.notCollected === 0
    && summary.passed === summary.expected;
  report.status = passed ? "passed" : "failed";

  console.log(JSON.stringify(report.counts));
  for (const entry of summary.cases.filter(({ status }) => status !== "passed")) {
    console.error(`${entry.caseId}: ${entry.status} (${entry.assertions} assertions)`);
    for (const failure of entry.failures ?? []) console.error(failure);
  }
  for (const failure of vitestFailures.filter(({ messages }) => messages.length > 0)) {
    console.error(`Vitest file failure: ${failure.file}`);
    for (const message of failure.messages) console.error(message);
  }
  if (playwrightRun.status !== 0) {
    console.error("Playwright required-case failure:");
    console.error(truncateOutput(`${playwrightRun.stdout ?? ""}${playwrightRun.stderr ?? ""}`));
  }

  if (!passed) process.exitCode = 1;
} catch (error) {
  const normalizedError = normalizeError(error);
  if (report.status !== "configuration-error") {
    report.status = "execution-error";
    report.error = normalizedError;
  }
  console.error(`Required-case execution failed: ${normalizedError.message}`);
  process.exitCode = 1;
} finally {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  await persistReport(report);
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

function baseReport(status, requiredCaseIds) {
  return {
    schemaVersion: 1,
    status,
    scope: "M0-M2 required cases",
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? process.env.OTR_COMMIT_SHA ?? null,
    node: process.version,
    counts: {
      expected: requiredCaseIds.length,
      collected: 0,
      executed: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      notCollected: requiredCaseIds.length,
    },
    cases: requiredCaseIds.map((caseId) => ({
      caseId,
      status: "not-collected",
      assertions: 0,
    })),
  };
}

function normalizeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

async function persistReport(value) {
  if (!reportPath) return;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ...value,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function truncateOutput(output, maximumLength = 12_000) {
  if (output.length <= maximumLength) return output;
  return `...[truncated]\n${output.slice(-maximumLength)}`;
}

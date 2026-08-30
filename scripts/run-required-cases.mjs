import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";

import {
  collectVitestFailureDiagnostics,
  parsePlaywrightAssertions,
  summarizeVitestResult,
  verifyRequiredCases,
} from "./required-cases-lib.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const reportPath = process.env.OTR_REQUIRED_CASE_REPORT
  ? resolve(root, process.env.OTR_REQUIRED_CASE_REPORT)
  : undefined;
const schemaImmutabilityDatabaseUrl =
  process.env.OTR_SCHEMA_IMMUTABILITY_DATABASE_URL;
const precollectedVitestResultPath = process.env.OTR_REQUIRED_CASE_PRECOLLECTED_VITEST_RESULT
  ? resolve(root, process.env.OTR_REQUIRED_CASE_PRECOLLECTED_VITEST_RESULT)
  : undefined;
const precollectedVitestFiles = new Set(
  (process.env.OTR_REQUIRED_CASE_PRECOLLECTED_VITEST_FILES ?? "")
    .split(/[\n,]/u)
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter(Boolean),
);
let temporaryDirectory;
let vitestRuns = [];
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

  const unknownPrecollectedFiles = [...precollectedVitestFiles].filter(
    (file) => !verification.vitestTestFiles.includes(file),
  );
  if (unknownPrecollectedFiles.length > 0) {
    throw new Error(
      `Precollected required-case files are not required Vitest files: ${unknownPrecollectedFiles.join(", ")}`,
    );
  }
  if (precollectedVitestFiles.size > 0 && !precollectedVitestResultPath) {
    throw new Error(
      "OTR_REQUIRED_CASE_PRECOLLECTED_VITEST_RESULT is required when precollected files are configured.",
    );
  }
  if (precollectedVitestResultPath && precollectedVitestFiles.size === 0) {
    throw new Error(
      "OTR_REQUIRED_CASE_PRECOLLECTED_VITEST_FILES is required when a precollected result is configured.",
    );
  }

  const prerequisiteBuild = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["run", "build"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
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
  const vitestResult = { testResults: [] };
  if (precollectedVitestResultPath) {
    const precollectedResult = JSON.parse(
      await readFile(precollectedVitestResultPath, "utf8"),
    );
    if (!Array.isArray(precollectedResult.testResults)) {
      throw new Error("Precollected required-case Vitest result has no testResults array.");
    }
    const collectedFiles = new Set(
      precollectedResult.testResults.map(({ name }) =>
        relative(root, resolve(name)).replaceAll("\\", "/")),
    );
    const missingPrecollectedFiles = [...precollectedVitestFiles].filter(
      (file) => !collectedFiles.has(file),
    );
    if (missingPrecollectedFiles.length > 0) {
      throw new Error(
        `Precollected required-case Vitest result is missing files: ${missingPrecollectedFiles.join(", ")}`,
      );
    }
    vitestResult.testResults.push(...precollectedResult.testResults);
    vitestRuns.push({ groupRoot: "precollected", status: 0 });
  }
  const schemaBaseline = schemaImmutabilityDatabaseUrl
    ? schemaFingerprint(schemaImmutabilityDatabaseUrl)
    : undefined;
  const pendingVitestFiles = verification.vitestTestFiles.filter(
    (file) => !precollectedVitestFiles.has(file),
  );
  for (const [groupRoot, files] of groupVitestFiles(pendingVitestFiles)) {
    const outputName = groupRoot === "."
      ? "root"
      : groupRoot.replaceAll("/", "-");
    const vitestOutput = resolve(temporaryDirectory, `vitest-${outputName}.json`);
    const vitestRun = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      [
        "exec",
        "vitest",
        "run",
        ...files.map((file) => relative(groupRoot, file)),
        "--config",
        resolve(root, "vitest.required.config.mjs"),
        "--root",
        groupRoot,
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
    assertSchemaUnchanged(schemaBaseline, `Vitest group ${groupRoot}`);
    vitestRuns.push({ groupRoot, ...vitestRun });
    try {
      const groupResult = JSON.parse(await readFile(vitestOutput, "utf8"));
      vitestResult.testResults.push(...(groupResult.testResults ?? []));
    } catch (error) {
      if (vitestRun.status === 0) throw error;
      vitestResult.testResults.push({
        name: resolve(root, groupRoot),
        status: "failed",
        message: `Vitest ${groupRoot} group did not produce JSON results.`,
        assertionResults: [],
      });
    }
  }

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
  assertSchemaUnchanged(schemaBaseline, "Node test group");

  const playwrightBuild = verification.playwrightTestFiles.length === 0
    ? { status: 0, stdout: "", stderr: "" }
    : spawnSync(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["--filter", "@on-the-road/web", "run", "build"],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "production",
          },
          maxBuffer: 64 * 1024 * 1024,
        },
      );
  if (playwrightBuild.error) throw playwrightBuild.error;
  if (playwrightBuild.status !== 0) {
    process.stderr.write(
      `${playwrightBuild.stdout ?? ""}${playwrightBuild.stderr ?? ""}`,
    );
    throw new Error(
      `Required-case Playwright build failed with exit code ${playwrightBuild.status}.`,
    );
  }

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
          "--reporter=json",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "production",
            OTR_PLAYWRIGHT_PREBUILT: "1",
          },
          maxBuffer: 64 * 1024 * 1024,
        },
      );
  if (playwrightRun.error) throw playwrightRun.error;
  assertSchemaUnchanged(schemaBaseline, "Playwright test group");

  vitestResult.testResults.push({
    assertionResults: parseNodeTestAssertions(nodeRun.stdout ?? ""),
  });
  let playwrightResult;
  try {
    playwrightResult = verification.playwrightTestFiles.length === 0
      ? { suites: [] }
      : JSON.parse(playwrightRun.stdout ?? "");
  } catch {
    playwrightResult = { suites: [] };
  }
  vitestResult.testResults.push({
    assertionResults: parsePlaywrightAssertions(playwrightResult),
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
        exitCode: vitestRuns.every(({ status }) => status === 0) ? 0 : 1,
        groups: vitestRuns.map(({ groupRoot, status }) => ({
          root: groupRoot,
          exitCode: status,
        })),
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
  const passed = vitestRuns.every(({ status }) => status === 0)
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

function groupVitestFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const segments = file.split("/");
    const groupRoot = ["apps", "packages", "spikes"].includes(segments[0])
      ? `${segments[0]}/${segments[1]}`
      : ".";
    const grouped = groups.get(groupRoot) ?? [];
    grouped.push(file);
    groups.set(groupRoot, grouped);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function schemaFingerprint(databaseUrl) {
  const result = spawnSync(
    process.env.PSQL_BIN || "psql",
    [
      databaseUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-f",
      resolve(root, "scripts/schema-fingerprint.sql"),
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Managed database schema fingerprint failed: ${truncateOutput(
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
      )}`,
    );
  }
  const fingerprint = result.stdout.trim();
  if (!/^[0-9a-f]{32}\|\d+$/u.test(fingerprint)) {
    throw new Error(`Managed database schema fingerprint is invalid: ${fingerprint}`);
  }
  return fingerprint;
}

function assertSchemaUnchanged(baseline, stage) {
  if (!baseline || !schemaImmutabilityDatabaseUrl) return;
  const current = schemaFingerprint(schemaImmutabilityDatabaseUrl);
  if (current !== baseline) {
    throw new Error(
      `Required-case ${stage} changed the managed database schema `
      + `(${baseline} -> ${current}).`,
    );
  }
}

function baseReport(status, requiredCaseIds) {
  return {
    schemaVersion: 1,
    status,
    scope: "M0-M4 required cases",
    generatedAt: new Date().toISOString(),
    commit: resolveCommit(),
    worktreeClean: repositoryIsClean(),
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

function resolveCommit() {
  const configured = process.env.GITHUB_SHA ?? process.env.OTR_COMMIT_SHA;
  if (configured) return configured;
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function repositoryIsClean() {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim().length === 0;
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

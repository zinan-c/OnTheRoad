import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, test } from "vitest";

import {
  collectVitestFailureDiagnostics,
  parsePlaywrightAssertions,
  summarizeVitestResult,
  verifyRequiredCases,
} from "../../scripts/required-cases-lib.mjs";

const root = resolve(new URL("../..", import.meta.url).pathname);

describe("M0-M4 required-case gate", () => {
  test("resolves every active documented Case ID to an executable test", async () => {
    const result = await verifyRequiredCases(root);
    assert.equal(result.requiredCaseIds.length, 156);
    assert.deepEqual(result.missingFromDocumentation, []);
    assert.deepEqual(result.missingTestFiles, []);
    assert.deepEqual(result.deprecatedRequired, []);
    assert.equal(result.valid, true);
    assert.ok(result.nodeTestFiles.length > 0);
    assert.deepEqual(result.playwrightTestFiles, [
      "apps/web/browser/trip-session.spec.ts",
      "apps/web/e2e/attachments-gallery.spec.ts",
      "apps/web/e2e/cost-summary.spec.ts",
      "apps/web/e2e/import-batch-geocode.spec.ts",
      "apps/web/e2e/import-confirm.spec.ts",
      "apps/web/e2e/import-mapping.spec.ts",
      "apps/web/e2e/import-media-lifecycle.spec.ts",
      "apps/web/e2e/import-preview.spec.ts",
      "apps/web/e2e/import-unresolved-locations.spec.ts",
      "apps/web/e2e/import-upload-chain.spec.ts",
      "apps/web/e2e/map-timeline-link.spec.ts",
      "apps/web/e2e/routes-visual.spec.ts",
    ]);
    assert.ok(
      !result.vitestTestFiles.includes("apps/web/browser/trip-session.spec.ts"),
    );
    assert.ok(result.vitestTestFiles.length > 0);
  });

  test("treats skipped and uncollected required cases as failures", () => {
    const summary = summarizeVitestResult(
      ["TC-A01-01", "TC-A01-02", "TC-A01-03"],
      {
        testResults: [{
          assertionResults: [
            { fullName: "TC-A01-01 passes", status: "passed" },
            { fullName: "TC-A01-02 is conditional", status: "skipped" },
          ],
        }],
      },
    );
    assert.deepEqual(
      {
        expected: summary.expected,
        collected: summary.collected,
        executed: summary.executed,
        passed: summary.passed,
        failed: summary.failed,
        skipped: summary.skipped,
        notCollected: summary.notCollected,
      },
      {
        expected: 3,
        collected: 2,
        executed: 1,
        passed: 1,
        failed: 0,
        skipped: 1,
        notCollected: 1,
      },
    );
  });

  test("preserves failed assertion and file diagnostics for CI reports", () => {
    const result = {
      testResults: [{
        name: resolve(root, "apps/api/test/example.spec.ts"),
        status: "failed",
        message: "suite setup failed",
        assertionResults: [{
          fullName: "TC-A01-02 example failure",
          status: "failed",
          failureMessages: ["expected true to be false"],
        }],
      }],
    };
    const summary = summarizeVitestResult(["TC-A01-02"], result);
    assert.deepEqual(summary.cases[0].failures, ["expected true to be false"]);
    assert.deepEqual(collectVitestFailureDiagnostics(root, result), [{
      file: "apps/api/test/example.spec.ts",
      messages: ["suite setup failed", "expected true to be false"],
    }]);
  });

  test("folds every Playwright project result into required-case counts", () => {
    assert.deepEqual(parsePlaywrightAssertions({
      suites: [{
        specs: [{
          title: "TC-C08-03 route visual E2E",
          tests: [
            { projectName: "desktop-chromium", results: [{ status: "passed" }] },
            {
              projectName: "mobile-chromium",
              results: [{
                status: "failed",
                errors: [{ message: "mobile assertion failed" }],
              }],
            },
          ],
        }],
      }],
    }), [
      {
        fullName: "TC-C08-03 route visual E2E [desktop-chromium]",
        status: "passed",
        failureMessages: [],
      },
      {
        fullName: "TC-C08-03 route visual E2E [mobile-chromium]",
        status: "failed",
        failureMessages: ["mobile assertion failed"],
      },
    ]);
  });

  test("persists a diagnostic report when the test command cannot start", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "otr-required-report-"));
    const reportPath = join(temporaryDirectory, "required.json");
    try {
      const result = spawnSync(
        process.execPath,
        [resolve(root, "scripts/run-required-cases.mjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: temporaryDirectory,
            OTR_REQUIRED_CASE_REPORT: reportPath,
          },
        },
      );
      assert.equal(result.status, 1);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.status, "execution-error");
      assert.equal(report.counts.expected, 156);
      assert.match(report.error.message, /pnpm/u);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("builds workspace package exports before starting required cases", async () => {
    const runner = await readFile(
      resolve(root, "scripts/run-required-cases.mjs"),
      "utf8",
    );
    const buildPosition = runner.indexOf('["run", "build"]');
    const vitestPosition = runner.indexOf('"vitest",');
    assert.ok(buildPosition >= 0, "required-case runner must build package exports");
    assert.ok(vitestPosition >= 0, "required-case runner must invoke Vitest");
    assert.ok(
      buildPosition < vitestPosition,
      "workspace build must finish before Vitest resolves package exports",
    );
  });

  test("accepts only clean exact-commit passing evidence", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "otr-required-verify-"));
    const reportPath = join(temporaryDirectory, "required.json");
    const commit = "1111111111111111111111111111111111111111";
    const node = `v${(await readFile(resolve(root, ".nvmrc"), "utf8")).trim()}`;
    try {
      await writeFile(reportPath, JSON.stringify({
        status: "passed",
        commit,
        worktreeClean: true,
        node,
        counts: {
          expected: 156,
          collected: 156,
          executed: 156,
          passed: 156,
          failed: 0,
          skipped: 0,
          notCollected: 0,
        },
      }));
      const valid = spawnSync(
        process.execPath,
        [resolve(root, "scripts/verify-required-case-report.mjs"), reportPath, commit],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(valid.status, 0, valid.stderr);

      const wrongCommit = spawnSync(
        process.execPath,
        [
          resolve(root, "scripts/verify-required-case-report.mjs"),
          reportPath,
          "0000000000000000000000000000000000000000",
        ],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(wrongCommit.status, 1);
      assert.match(wrongCommit.stderr, /does not match/u);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("initializes an uploadable report before integration dependencies start", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "otr-required-initial-"));
    const reportPath = join(temporaryDirectory, "required.json");
    try {
      const result = spawnSync(
        process.execPath,
        [resolve(root, "scripts/initialize-required-case-report.mjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            OTR_REQUIRED_CASE_REPORT: reportPath,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.status, "not-started");
      assert.equal(report.counts.expected, 156);
      assert.equal(report.counts.notCollected, 156);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

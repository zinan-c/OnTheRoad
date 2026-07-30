import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, test } from "vitest";

import {
  summarizeVitestResult,
  verifyRequiredCases,
} from "../../scripts/required-cases-lib.mjs";

const root = resolve(new URL("../..", import.meta.url).pathname);

describe("M0-M2 required-case gate", () => {
  test("resolves every active documented Case ID to an executable test", async () => {
    const result = await verifyRequiredCases(root);
    assert.equal(result.requiredCaseIds.length, 103);
    assert.deepEqual(result.missingFromDocumentation, []);
    assert.deepEqual(result.missingTestFiles, []);
    assert.deepEqual(result.deprecatedRequired, []);
    assert.equal(result.valid, true);
    assert.ok(result.nodeTestFiles.length > 0);
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
});

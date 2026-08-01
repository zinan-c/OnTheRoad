import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadRequiredCaseManifest } from "./required-cases-lib.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const configuredPath = process.env.OTR_REQUIRED_CASE_REPORT;
if (!configuredPath) {
  throw new Error("OTR_REQUIRED_CASE_REPORT is required.");
}

const { manifest, requiredCaseIds } = await loadRequiredCaseManifest(root);
const reportPath = resolve(root, configuredPath);
const report = {
  schemaVersion: 1,
  status: "not-started",
  scope: manifest.scope,
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

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Initialized required-case report: ${configuredPath}`);

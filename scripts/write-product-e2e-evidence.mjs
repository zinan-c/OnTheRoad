import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const resultPath = resolve(root, process.env.OTR_PRODUCT_E2E_JSON ?? "test-results/product-e2e-results.json");
const evidencePath = resolve(root, process.env.OTR_PRODUCT_E2E_EVIDENCE ?? "test-results/product-e2e-evidence.json");
const manifest = JSON.parse(await readFile(resolve(root, "test-manifests/product-e2e.required.json"), "utf8"));
const requiredIds = manifest.requiredCaseIds;
const expectedCommit = process.env.GITHUB_SHA ?? process.env.OTR_COMMIT_SHA ?? gitHead();
const report = await readJsonIfPresent(resultPath);
const observed = collectCases(report);
const cases = requiredIds.map((id) => observed.get(id) ?? {
  id,
  title: `${id} — ${manifest.cases.find(({ id: caseId }) => caseId === id)?.title ?? ""}`,
  status: "not-collected",
  projects: [],
  files: [],
  attempts: [],
});
const counts = {
  expected: requiredIds.length,
  collected: cases.filter(({ status }) => status !== "not-collected").length,
  executed: cases.filter(({ status }) => ["passed", "failed", "skipped"].includes(status)).length,
  passed: cases.filter(({ status }) => status === "passed").length,
  failed: cases.filter(({ status }) => status === "failed").length,
  skipped: cases.filter(({ status }) => status === "skipped").length,
  notCollected: cases.filter(({ status }) => status === "not-collected").length,
};
const evidence = {
  schemaVersion: 1,
  suite: "product-e2e-required",
  status: counts.expected === 22
    && counts.collected === 22
    && counts.executed === 22
    && counts.passed === 22
    && counts.failed === 0
    && counts.skipped === 0
    && counts.notCollected === 0
    ? "passed"
    : "failed",
  generatedAt: new Date().toISOString(),
  commit: expectedCommit,
  manifest: "test-manifests/product-e2e.required.json",
  playwrightJson: relativeToRoot(resultPath),
  counts,
  cases,
};

await mkdir(resolve(evidencePath, ".."), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Product E2E evidence written: ${relativeToRoot(evidencePath)} (${counts.passed}/${counts.expected} passed).`);

if (process.argv.includes("--verify")) verify(evidence);

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function collectCases(playwrightReport) {
  const cases = new Map();
  if (!playwrightReport || !Array.isArray(playwrightReport.suites)) return cases;
  for (const suite of playwrightReport.suites) collectSuite(suite, cases, []);
  return cases;
}

function collectSuite(suite, cases, parents) {
  const suitePath = [...parents, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? []) {
    const match = /^(E2E-\d{3})\s+—\s+(.+)$/u.exec(spec.title ?? "");
    if (!match) continue;
    const id = match[1];
    const title = `${id} — ${match[2]}`;
    const tests = spec.tests ?? [];
    const status = combineStatuses(tests.map(testStatus));
    const attempts = tests.flatMap((test) => (test.results ?? []).map((result) => ({
      project: test.projectName ?? "unknown",
      status: result.status ?? "unknown",
      durationMs: result.duration ?? 0,
    })));
    const current = cases.get(id);
    if (current) {
      current.status = combineStatuses([current.status, status]);
      current.projects = [...new Set([...current.projects, ...tests.map(({ projectName }) => projectName).filter(Boolean)])];
      current.files = [...new Set([...current.files, spec.file ?? suitePath.join("/")])];
      current.attempts.push(...attempts);
    } else {
      cases.set(id, {
        id,
        title,
        status,
        projects: [...new Set(tests.map(({ projectName }) => projectName).filter(Boolean))],
        files: [spec.file ?? suitePath.join("/")],
        attempts,
      });
    }
  }
  for (const child of suite.suites ?? []) collectSuite(child, cases, suitePath);
}

function testStatus(test) {
  const resultStatuses = (test.results ?? []).map(({ status }) => status);
  if (resultStatuses.some((status) => ["failed", "timedOut", "interrupted"].includes(status))) return "failed";
  if (test.status === "skipped" || test.expectedStatus === "skipped" || resultStatuses.includes("skipped")) return "skipped";
  if (resultStatuses.includes("passed")) return "passed";
  return "not-collected";
}

function combineStatuses(statuses) {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("skipped")) return "skipped";
  if (statuses.length > 0 && statuses.every((status) => status === "passed")) return "passed";
  return "not-collected";
}

function verify(report) {
  const errors = [];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.suite !== "product-e2e-required") errors.push("suite must be product-e2e-required");
  if (!/^[0-9a-f]{40}$/u.test(report.commit ?? "")) errors.push("commit must be a full Git SHA");
  if (report.commit !== expectedCommit) errors.push(`commit ${report.commit} does not match ${expectedCommit}`);
  if (JSON.stringify(report.cases.map(({ id }) => id)) !== JSON.stringify(requiredIds)) errors.push("case IDs are not exactly E2E-001..022 in manifest order");
  for (const [field, expected] of Object.entries({ expected: 22, collected: 22, executed: 22, passed: 22, failed: 0, skipped: 0, notCollected: 0 })) {
    if (report.counts?.[field] !== expected) errors.push(`counts.${field} is ${report.counts?.[field]}, expected ${expected}`);
  }
  for (const entry of report.cases) {
    const manifestCase = manifest.cases.find(({ id }) => id === entry.id);
    const expectedTitle = `${entry.id} — ${manifestCase?.title ?? ""}`;
    if (entry.title !== expectedTitle) errors.push(`${entry.id} title does not match the manifest`);
    if (entry.status !== "passed") errors.push(`${entry.id} status is ${entry.status}`);
    for (const project of manifest.rules?.requiredDeviceProjects ?? []) {
      if (!entry.projects?.includes(project)) errors.push(`${entry.id} did not execute required project ${project}`);
    }
  }
  if (errors.length > 0) throw new Error(`Product E2E evidence is not closure-grade:\n- ${errors.join("\n- ")}`);
  console.log(`Commit-bound product E2E evidence verified: ${report.commit} (22/22 passed, 0 failed, 0 skipped).`);
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to resolve the current Git commit.");
  return result.stdout.trim();
}

function relativeToRoot(path) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

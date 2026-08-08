import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const reportPath = resolve(
  root,
  process.argv[2]
    ?? process.env.OTR_REQUIRED_CASE_REPORT
    ?? "test-results/local-m0-m3-required.json",
);
const expectedCommit = process.argv[3]
  ?? process.env.GITHUB_SHA
  ?? process.env.OTR_COMMIT_SHA
  ?? gitHead();
const report = JSON.parse(await readFile(reportPath, "utf8"));
const expectedNode = `v${(await readFile(resolve(root, ".nvmrc"), "utf8")).trim()}`;

const failures = [];
if (report.status !== "passed") failures.push(`status is ${report.status}`);
if (!/^[0-9a-f]{40}$/u.test(report.commit ?? "")) {
  failures.push("commit is missing or is not a full Git SHA");
} else if (report.commit !== expectedCommit) {
  failures.push(`commit ${report.commit} does not match ${expectedCommit}`);
}
if (report.worktreeClean !== true) failures.push("worktree was not clean during the Gate");
if (report.node !== expectedNode) {
  failures.push(`Node ${report.node} does not match pinned ${expectedNode}`);
}
const counts = report.counts ?? {};
for (const field of ["expected", "collected", "executed", "passed"]) {
  if (!Number.isInteger(counts[field]) || counts[field] <= 0) {
    failures.push(`${field} is not a positive integer`);
  }
}
if (!(counts.expected === counts.collected
  && counts.expected === counts.executed
  && counts.expected === counts.passed)) {
  failures.push("expected/collected/executed/passed counts differ");
}
for (const field of ["failed", "skipped", "notCollected"]) {
  if (counts[field] !== 0) failures.push(`${field} is ${counts[field]}`);
}
if (failures.length > 0) {
  throw new Error(`Required-case report is not closure-grade:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Commit-bound required-case evidence verified: ${report.commit} (${counts.passed}/${counts.expected} passed).`,
);

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Unable to resolve the current Git commit.");
  return result.stdout.trim();
}

import { resolve } from "node:path";

import { verifyRequiredCases } from "./required-cases-lib.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const verification = await verifyRequiredCases(root);

console.log(
  `Required cases: expected=${verification.requiredCaseIds.length} resolved=${verification.caseFiles.size} files=${verification.testFiles.length}`,
);
for (const [label, values] of [
  ["missing from docs/TEST_CASES.md", verification.missingFromDocumentation],
  ["missing executable test", verification.missingTestFiles],
  ["deprecated but required", verification.deprecatedRequired],
]) {
  if (values.length > 0) console.error(`${label}: ${values.join(", ")}`);
}
if (!verification.valid) process.exitCode = 1;

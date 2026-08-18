import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const CASE_ID = /^E2E-(\d{3})$/u;
const TEST_NAME = /(?:^|\n)\s*test\(\s*["'`]((E2E-\d{3})\s+—\s+[^"'`]+)["'`]/gu;
const SKIPPED_TEST = /\b(?:test|describe)\.(?:skip|fixme|fail)\s*\(/u;
const REVERSE_ACCEPTANCE = /temporarily hidden|without settings UI|入口不存在/iu;
const REVERSE_ABSENCE_ASSERTION = /(?:gallery|image workspace|upload image|import product|upload itinerary file)[\s\S]{0,180}toHaveCount\(0\)/iu;

export async function verifyProductE2eManifest(root = resolve(new URL("..", import.meta.url).pathname)) {
  const manifestPath = resolve(root, "test-manifests/product-e2e.required.json");
  const documentPath = resolve(root, "docs/E2E_AUTOMATION_CASES.md");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const document = await readFile(documentPath, "utf8");
  const errors = [];
  const expectedIds = Array.from({ length: 22 }, (_, index) => `E2E-${String(index + 1).padStart(3, "0")}`);

  if (manifest.rules?.exactCaseCount !== 22) errors.push("rules.exactCaseCount must be 22");
  if (manifest.rules?.allowSkipped !== false) errors.push("rules.allowSkipped must be false");
  if (JSON.stringify(manifest.requiredCaseIds) !== JSON.stringify(expectedIds)) {
    errors.push("requiredCaseIds must contain E2E-001 through E2E-022 in order");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 22) {
    errors.push("cases must contain exactly 22 records");
  }

  const manifestCases = new Map();
  for (const entry of manifest.cases ?? []) {
    if (!entry || typeof entry !== "object") {
      errors.push("manifest contains a non-object case record");
      continue;
    }
    if (manifestCases.has(entry.id)) errors.push(`duplicate manifest case ${entry.id}`);
    manifestCases.set(entry.id, entry);
    if (!CASE_ID.test(entry.id ?? "")) errors.push(`invalid manifest case id ${entry.id}`);
    if (typeof entry.title !== "string" || entry.title.length === 0) errors.push(`${entry.id} has no title`);
    if (!Array.isArray(entry.uiActions) || entry.uiActions.length === 0) errors.push(`${entry.id} has no UI actions`);
    if (!Array.isArray(entry.readOnlyApiVerification)) errors.push(`${entry.id} has no read-only verification boundary`);
    if (!entry.dataMatrix || typeof entry.dataMatrix !== "object") errors.push(`${entry.id} has no data matrix`);
    if (!Array.isArray(entry.finalBusinessFacts) || entry.finalBusinessFacts.length === 0) errors.push(`${entry.id} has no final business facts`);
    if (!Array.isArray(entry.deviceProjects) || entry.deviceProjects.length === 0) errors.push(`${entry.id} has no device project`);
  }
  for (const id of expectedIds) if (!manifestCases.has(id)) errors.push(`missing manifest case ${id}`);
  for (const id of manifestCases.keys()) if (!expectedIds.includes(id)) errors.push(`unexpected manifest case ${id}`);

  const documentCases = parseDocumentCases(document);
  for (const id of expectedIds) {
    const entry = manifestCases.get(id);
    const docCase = documentCases.get(id);
    if (!docCase) {
      errors.push(`${id} is missing from ${manifest.sourceDocument}`);
      continue;
    }
    if (entry?.title !== docCase.title) errors.push(`${id} manifest title does not match the document title`);
    for (const action of entry?.uiActions ?? []) {
      if (typeof action.documentPhrase !== "string" || !containsNormalized(docCase.section, action.documentPhrase)) {
        errors.push(`${id} UI action is not present in the document: ${action.documentPhrase}`);
      }
    }
  }

  const testFiles = await collectTestFiles(resolve(root, "tests/e2e"));
  const executableCases = new Map();
  for (const file of testFiles) {
    const source = await readFile(file, "utf8");
    if (SKIPPED_TEST.test(source)) errors.push(`${file} contains a skipped/fixme/fail test`);
    for (const match of source.matchAll(TEST_NAME)) {
      const fullName = match[1];
      const id = match[2];
      const start = match.index ?? 0;
      const nextTest = source.indexOf("\ntest(", start + fullName.length);
      const body = source.slice(start, nextTest < 0 ? source.length : nextTest);
      if (executableCases.has(id)) errors.push(`duplicate executable test ${id}`);
      executableCases.set(id, { file, fullName, body, fileSource: source });
    }
  }
  for (const id of expectedIds) {
    const entry = manifestCases.get(id);
    const executable = executableCases.get(id);
    if (!executable) {
      errors.push(`missing executable test ${id}`);
      continue;
    }
    const expectedName = `${id} — ${entry.title}`;
    if (executable.fullName !== expectedName) errors.push(`${id} test title does not match the document: ${executable.fullName}`);
    for (const action of entry.uiActions ?? []) {
      for (const marker of action.sourceMarkers ?? []) {
        if (!executable.fileSource.includes(marker)) errors.push(`${id} executable test is missing UI action marker: ${marker}`);
      }
    }
    if (REVERSE_ACCEPTANCE.test(executable.fullName)
      || (["E2E-013", "E2E-018", "E2E-020"].includes(id) && REVERSE_ABSENCE_ASSERTION.test(executable.body))) {
      errors.push(`${id} uses an absence assertion or reverse-acceptance title for a positive product path`);
    }
  }
  for (const id of executableCases.keys()) if (!expectedIds.includes(id)) errors.push(`unexpected executable E2E test ${id}`);

  return { valid: errors.length === 0, errors, manifest, documentCases, executableCases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const verification = await verifyProductE2eManifest();
  if (!verification.valid) {
    console.error("Product E2E manifest verification failed:");
    for (const error of verification.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Product E2E manifest verified: E2E-001..022, unique, titled, actionable, and not skipped.");
  }
}

function parseDocumentCases(document) {
  const cases = new Map();
  const headings = [...document.matchAll(/^## (E2E-\d{3}) — (.+)$/gmu)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? document.length;
    cases.set(heading[1], { title: heading[2], section: document.slice(start, end) });
  }
  return cases;
}

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTestFiles(path));
    else if (/\.spec\.ts$/u.test(entry.name)) files.push(path);
  }
  return files.sort();
}

function containsNormalized(haystack, needle) {
  return normalize(haystack).includes(normalize(needle));
}

function normalize(value) {
  return String(value).replaceAll(/\s+/gu, " ").trim();
}

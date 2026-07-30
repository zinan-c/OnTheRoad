import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const CASE_PATTERN = /TC-(?:[A-Z]\d{2}|M\d-INT)-\d{2}/gu;
const TEST_FILE_PATTERN = /\.(?:spec|test)\.(?:[cm]?[jt]sx?)$/u;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "test-results",
  "vendor",
]);
const TEST_ROOTS = ["apps", "packages", "spikes", "tests"];

export async function loadRequiredCaseManifest(root, manifestPath = "test-manifests/m0-m2.required.json") {
  const absolutePath = resolve(root, manifestPath);
  const manifest = JSON.parse(await readFile(absolutePath, "utf8"));
  return {
    absolutePath,
    manifest,
    requiredCaseIds: expandRequiredCaseIds(manifest),
  };
}

export function expandRequiredCaseIds(manifest) {
  const cases = [];
  for (const taskIds of Object.values(manifest.tasks)) {
    for (const taskId of taskIds) {
      for (const suffix of manifest.caseSuffixes) {
        cases.push(`TC-${taskId}-${suffix}`);
      }
    }
  }
  for (const [milestone, suffixes] of Object.entries(manifest.milestoneIntegrationCases)) {
    for (const suffix of suffixes) cases.push(`TC-${milestone}-INT-${suffix}`);
  }
  return [...new Set(cases)].sort();
}

export async function resolveRequiredCaseFiles(root, manifest) {
  const excluded = new Set(manifest.excludedTestFiles);
  const testFiles = [];
  for (const testRoot of TEST_ROOTS) {
    await walk(resolve(root, testRoot), testFiles);
  }

  const caseFiles = new Map();
  const frameworkByFile = new Map();
  for (const absoluteFile of testFiles) {
    const repositoryPath = normalizePath(relative(root, absoluteFile));
    if (excluded.has(repositoryPath)) continue;
    const source = await sourceWithLocalImports(absoluteFile, new Set());
    frameworkByFile.set(
      repositoryPath,
      /from\s+["']node:test["']/u.test(source) ? "node-test" : "vitest",
    );
    for (const caseId of new Set(source.match(CASE_PATTERN) ?? [])) {
      const files = caseFiles.get(caseId) ?? [];
      files.push(repositoryPath);
      caseFiles.set(caseId, files);
    }
  }
  const requiredTestFiles = [...new Set([...caseFiles.values()].flat())].sort();
  return {
    caseFiles,
    testFiles: requiredTestFiles,
    nodeTestFiles: requiredTestFiles.filter((file) => frameworkByFile.get(file) === "node-test"),
    vitestTestFiles: requiredTestFiles.filter((file) => frameworkByFile.get(file) === "vitest"),
  };
}

export async function verifyRequiredCases(root, manifestPath) {
  const loaded = await loadRequiredCaseManifest(root, manifestPath);
  const {
    caseFiles,
    testFiles,
    nodeTestFiles,
    vitestTestFiles,
  } = await resolveRequiredCaseFiles(root, loaded.manifest);
  const documentation = await readFile(resolve(root, "docs/TEST_CASES.md"), "utf8");
  const documentedCases = new Set(documentation.match(CASE_PATTERN) ?? []);
  const missingFromDocumentation = loaded.requiredCaseIds.filter((caseId) => !documentedCases.has(caseId));
  const missingTestFiles = loaded.requiredCaseIds.filter((caseId) => !caseFiles.has(caseId));
  const deprecatedRequired = loaded.requiredCaseIds.filter((caseId) =>
    loaded.manifest.deprecatedCases.includes(caseId));
  return {
    ...loaded,
    caseFiles,
    testFiles,
    nodeTestFiles,
    vitestTestFiles,
    missingFromDocumentation,
    missingTestFiles,
    deprecatedRequired,
    valid:
      missingFromDocumentation.length === 0
      && missingTestFiles.length === 0
      && deprecatedRequired.length === 0,
  };
}

export function summarizeVitestResult(requiredCaseIds, result) {
  const assertions = result.testResults.flatMap((testFile) => testFile.assertionResults ?? []);
  const cases = requiredCaseIds.map((caseId) => {
    const matches = assertions.filter((assertion) => assertion.fullName?.includes(caseId));
    const statuses = matches.map((assertion) => assertion.status);
    let status = "not-collected";
    if (statuses.some((value) => value === "failed")) status = "failed";
    else if (statuses.some((value) =>
      value === "pending" || value === "skipped" || value === "todo")) status = "skipped";
    else if (statuses.length > 0 && statuses.every((value) => value === "passed")) status = "passed";
    else if (statuses.length > 0) status = "failed";
    return { caseId, status, assertions: matches.length };
  });
  const count = (status) => cases.filter((entry) => entry.status === status).length;
  return {
    expected: requiredCaseIds.length,
    collected: cases.filter((entry) => entry.assertions > 0).length,
    executed: cases.filter((entry) => !["not-collected", "skipped"].includes(entry.status)).length,
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    notCollected: count("not-collected"),
    cases,
  };
}

async function walk(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      await walk(join(directory, entry.name), files);
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }
}

async function sourceWithLocalImports(file, visited) {
  if (visited.has(file)) return "";
  visited.add(file);
  const source = await readFile(file, "utf8");
  const imports = [...source.matchAll(/(?:import|export)\s+(?:[^"']+\s+from\s+)?["'](\.[^"']+)["']/gu)];
  const importedSources = [];
  for (const match of imports) {
    const imported = await resolveLocalImport(dirname(file), match[1]);
    if (imported) importedSources.push(await sourceWithLocalImports(imported, visited));
  }
  return `${source}\n${importedSources.join("\n")}`;
}

async function resolveLocalImport(directory, specifier) {
  const candidate = resolve(directory, specifier);
  const extensions = extname(candidate)
    ? [candidate, candidate.replace(/\.(?:m?js)$/u, ".ts"), candidate.replace(/\.js$/u, ".tsx")]
    : [`${candidate}.ts`, `${candidate}.tsx`, `${candidate}.mjs`, `${candidate}.js`];
  for (const path of extensions) {
    try {
      await readFile(path);
      return path;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function normalizePath(path) {
  return path.split("\\").join("/");
}

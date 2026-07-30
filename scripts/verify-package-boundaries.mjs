import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const DIRECT_SOURCE_IMPORT = /(?:from\s+|import\s*\()\s*["'][^"']*packages\/[^"']*\/src(?:\/[^"']*)?["']/g;
const WORKSPACE_IMPORT = /(?:from\s+|import\s*\()\s*["'](@on-the-road\/[^/"']+)/g;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
const appEntries = await readdir(join(ROOT, "apps"), { withFileTypes: true });
for (const app of appEntries.filter((entry) => entry.isDirectory())) {
  const appRoot = join(ROOT, "apps", app.name);
  const manifest = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  for (const file of await sourceFiles(appRoot)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(DIRECT_SOURCE_IMPORT)) {
      violations.push(`${relative(ROOT, file)}: ${match[0]}`);
    }
    for (const match of source.matchAll(WORKSPACE_IMPORT)) {
      const dependency = match[1];
      if (dependency && !declared.has(dependency)) {
        violations.push(
          `${relative(ROOT, file)}: undeclared dependency ${dependency}`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Direct imports from packages/*/src are forbidden:");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Package boundaries verified: apps use declared package exports.");
}

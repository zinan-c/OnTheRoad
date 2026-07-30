import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const allowlist = JSON.parse(
  await readFile(join(ROOT, "config/ts-nocheck-allowlist.json"), "utf8"),
);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (
      ["dist", "node_modules"].includes(entry.name)
      || relative(ROOT, path) === "packages/importer/vendor"
    ) {
      continue;
    }
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const discovered = new Set();
for (const scope of ["apps", "packages"]) {
  for (const file of await sourceFiles(join(ROOT, scope))) {
    const firstLine = (await readFile(file, "utf8")).split(/\r?\n/u, 1)[0];
    if (firstLine?.startsWith("// @ts-nocheck")) {
      discovered.add(relative(ROOT, file));
    }
  }
}

const errors = [];
for (const path of discovered) {
  if (!allowlist[path]) errors.push(`Unapproved @ts-nocheck: ${path}`);
}
for (const [path, approval] of Object.entries(allowlist)) {
  if (!discovered.has(path)) errors.push(`Stale @ts-nocheck allowlist entry: ${path}`);
  for (const field of ["owner", "reason", "removalCondition"]) {
    if (typeof approval?.[field] !== "string" || !approval[field].trim()) {
      errors.push(`Allowlist entry ${path} is missing ${field}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`TypeScript exceptions verified: ${discovered.size} approved isolation files.`);
}

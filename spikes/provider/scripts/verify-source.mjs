import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const roots = ["src", "fixtures"];
const files = [];
for (const root of roots) {
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && extname(entry.name) === ".ts") files.push(join(entry.parentPath, entry.name));
  }
}
for (const file of files) {
  const source = readFileSync(file, "utf8");
  assert.equal(/\t/u.test(source), false, `${file}: tabs are forbidden`);
  assert.equal(/[ \t]+$/mu.test(source), false, `${file}: trailing whitespace`);
  assert.equal(/from\s+["'][^"']+\.ts["']/u.test(source), false, `${file}: emitted imports must use .js`);
}
assert.ok(files.length >= 4, "provider source inventory is unexpectedly empty");

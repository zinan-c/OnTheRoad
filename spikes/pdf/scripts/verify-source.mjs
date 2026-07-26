import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const spikeRoot = path.resolve(import.meta.dirname, "..");
const required = [
  "src/spike.ts",
  "src/cli.ts",
  "cjk-pagination.spec.ts",
  "toc-and-resource.spec.ts",
  "pdf-visual.e2e.spec.ts",
];

for (const relative of required) {
  await access(path.join(spikeRoot, relative));
}

const source = await readFile(path.join(spikeRoot, "src/spike.ts"), "utf8");
assert.match(source, /A11_FIXED_FONT_MISSING/);
assert.match(source, /A11_FIXED_FONT_CHECKSUM_MISMATCH/);
assert.match(source, /verifyExactToc/);
assert.match(source, /document\.fonts\.ready/);

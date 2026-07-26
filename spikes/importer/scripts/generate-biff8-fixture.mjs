import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XLSX } from "../src/importer.mjs";

const spikeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = resolve(spikeRoot, "../../packages/test-fixtures/imports/minimal-five-day.xlsx");
const outputPath = resolve(spikeRoot, "fixtures/minimal-five-day-biff8.xls");

const source = XLSX.read(await readFile(sourcePath), { type: "buffer", raw: true, UTC: true });
source.Props = {
  Title: "minimal-five-day@1 BIFF8 fixture",
  Subject: "A10 SheetJS contract",
  Author: "On The Road",
  CreatedDate: new Date("2026-07-26T00:00:00.000Z"),
};
const output = XLSX.write(source, {
  type: "buffer",
  bookType: "biff8",
  bookSST: true,
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);
process.stdout.write(`${outputPath} ${output.length} bytes\n`);

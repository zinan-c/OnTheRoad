import assert from "node:assert/strict";
import test from "node:test";

import { ImportSecurityError, parseWorkbook } from "./src/importer.mjs";
import { createZip, workbookXlsx } from "./test-support.mjs";

function assertSecurityCode(action, code) {
  assert.throws(action, (error) => error instanceof ImportSecurityError && error.code === code);
}

test("TC-A10-02 rejects malformed and resource attacks without executing formulae", () => {
  assertSecurityCode(
    () => parseWorkbook(Buffer.from("PK malformed"), { fileName: "broken.xlsx" }),
    "IMPORT_CORRUPT_ARCHIVE",
  );

  const bomb = createZip(
    { "xl/workbook.xml": "<workbook/>" },
    { declaredSizes: { "xl/workbook.xml": 50_000_000 } },
  );
  assertSecurityCode(
    () => parseWorkbook(bomb, { fileName: "bomb.xlsx", limits: { maxUncompressedBytes: 1_000_000 } }),
    "IMPORT_RESOURCE_LIMIT",
  );

  const sharedStrings = createZip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": "<workbook/>",
    "xl/sharedStrings.xml": `<sst><si><t>${"x".repeat(20_000)}</t></si></sst>`,
  });
  assertSecurityCode(
    () => parseWorkbook(sharedStrings, { fileName: "strings.xlsx", limits: { maxSharedStringsBytes: 1_000 } }),
    "IMPORT_RESOURCE_LIMIT",
  );

  globalThis.__A10_FORMULA_EXECUTED__ = false;
  assertSecurityCode(
    () => parseWorkbook(workbookXlsx({ formula: true }), { fileName: "formula.xlsx" }),
    "IMPORT_FORMULA_FORBIDDEN",
  );
  assert.equal(globalThis.__A10_FORMULA_EXECUTED__, false);

  assertSecurityCode(
    () => parseWorkbook(createZip({
      "xl/workbook.xml": "<workbook/>",
      "xl/vbaProject.bin": Buffer.from([0, 1, 2]),
    }), { fileName: "macro.xlsx" }),
    "IMPORT_MACRO_FORBIDDEN",
  );

  assertSecurityCode(
    () => parseWorkbook(createZip({ "../escape.xml": "<x/>" }), { fileName: "path.xlsx" }),
    "IMPORT_UNSAFE_ARCHIVE_PATH",
  );

  assertSecurityCode(
    () => parseWorkbook(createZip(
      { "xl/workbook.xml": "<workbook/>" },
      { entryFlags: { "xl/workbook.xml": 1 } },
    ), { fileName: "encrypted.xlsx" }),
    "IMPORT_ENCRYPTED_FILE",
  );
});

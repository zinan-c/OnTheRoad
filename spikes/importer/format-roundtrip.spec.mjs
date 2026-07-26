import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseWorkbook, XLSX } from "./src/importer.mjs";
import { workbookXlsx } from "./test-support.mjs";

const fixtureRoot = new URL("../../packages/test-fixtures/imports/", import.meta.url);
const biff8Fixture = fileURLToPath(
  new URL("./fixtures/minimal-five-day-biff8.xls", import.meta.url),
);

test("TC-A10-01 parses xlsx xls csv and both Excel date systems", async () => {
  const parsed = {};
  for (const extension of ["xlsx", "xls", "csv"]) {
    const fileName = `minimal-five-day.${extension}`;
    parsed[extension] = parseWorkbook(
      await readFile(new URL(fileName, fixtureRoot)),
      { fileName },
    );
  }

  assert.equal(parsed.csv.sheets[0].rows.length, 15);
  assert.equal(parsed.xls.sheets[0].rows.length, 15);
  assert.equal(parsed.xlsx.sheets[0].rows.length, 15);
  for (const value of Object.values(parsed)) {
    assert.deepEqual(value.engine, { name: "SheetJS", version: "0.20.3" });
    assert.equal(value.sheets[0].rows[0].fixtureVersion, "minimal-five-day@1");
    assert.equal(value.sheets[0].rows[0].day, 1);
    assert.equal(value.sheets[0].rows[0].longitude, 121.8052);
  }

  const parsedBiff8 = parseWorkbook(await readFile(biff8Fixture), { fileName: "minimal-five-day-biff8.xls" });
  assert.deepEqual(parsedBiff8.engine, { name: "SheetJS", version: "0.20.3" });
  assert.equal(parsedBiff8.sheets[0].rows.length, 15);
  assert.equal(parsedBiff8.sheets[0].rows[0].fixtureVersion, "minimal-five-day@1");

  const system1900 = parseWorkbook(workbookXlsx(), { fileName: "1900.xlsx" });
  const system1904 = parseWorkbook(workbookXlsx({ date1904: true }), { fileName: "1904.xlsx" });
  assert.equal(system1900.sheets[0].rows[0].date, "1900-01-02");
  assert.equal(system1904.sheets[0].rows[0].date, "1904-01-02");

  const multipleSheets = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(multipleSheets, XLSX.utils.aoa_to_sheet([["value"], [1]]), "First");
  XLSX.utils.book_append_sheet(multipleSheets, XLSX.utils.aoa_to_sheet([["value"], [2]]), "Second");
  const parsedMultipleSheets = parseWorkbook(
    XLSX.write(multipleSheets, { type: "buffer", bookType: "xlsx" }),
    { fileName: "multiple.xlsx" },
  );
  assert.deepEqual(parsedMultipleSheets.sheets.map(({ name }) => name), ["First", "Second"]);
  assert.deepEqual(parsedMultipleSheets.sheets.map(({ rows }) => rows[0].value), [1, 2]);
});
